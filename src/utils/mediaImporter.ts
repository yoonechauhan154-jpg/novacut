import { ImportedMediaItem } from '../types/editor';
import { saveMediaBlobToIdb } from './projectStorage';

export interface MediaImportFeedback {
  onStepToast: (msgEn: string, msgHi: string) => void;
}

function createPlaceholderThumbnail(label: string, color: string = '#F59E0B'): string {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 284;
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    const grad = ctx.createLinearGradient(0, 0, 160, 284);
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(1, '#1E293B');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 160, 284);
    ctx.fillStyle = color;
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(label.slice(0, 14), 80, 142);
    return canvas.toDataURL('image/jpeg', 0.65);
  } catch {
    return '';
  }
}

export async function inspectAndImportMediaFile(
  file: File,
  feedback: MediaImportFeedback
): Promise<ImportedMediaItem> {
  const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
  const cleanName = file.name.replace(/\.[^/.]+$/, '') || 'Media Clip';
  const mime = (file.type || '').toLowerCase();
  const ext = (file.name.split('.').pop() || '').toLowerCase();

  feedback.onStepToast(
    `File selected: ${file.name} (${sizeMb} MB)`,
    `फ़ाइल चुनी गई: ${file.name} (${sizeMb} MB)`
  );

  const objectUrl = URL.createObjectURL(file);
  const blobId = `blob-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  await saveMediaBlobToIdb(blobId, file);

  const isVideo =
    mime.startsWith('video/') ||
    ['mp4', 'webm', 'mov', 'mkv', '3gp', 'avi'].includes(ext);
  const isImage =
    mime.startsWith('image/') ||
    ['jpg', 'jpeg', 'png', 'webp', 'gif', 'heic', 'bmp'].includes(ext);
  const isAudio =
    mime.startsWith('audio/') ||
    ['mp3', 'wav', 'aac', 'm4a', 'ogg', 'flac'].includes(ext);

  // 1. VIDEO IMPORT (with hidden DOM <video>, 5-second timeout, and 0.1s seek thumbnail)
  if (isVideo) {
    return new Promise<ImportedMediaItem>((resolve) => {
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.preload = 'metadata';
      video.style.position = 'fixed';
      video.style.left = '-9999px';
      video.style.width = '1px';
      video.style.height = '1px';
      video.style.opacity = '0';
      video.style.pointerEvents = 'none';
      document.body.appendChild(video);

      let settled = false;
      let realDuration = 5.0;

      const finish = (thumbUrl: string, warningText?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          if (video.parentNode) video.parentNode.removeChild(video);
        } catch {
          // ignore
        }

        if (warningText) {
          feedback.onStepToast(warningText, warningText);
        } else {
          feedback.onStepToast(
            `Metadata loaded: ${file.name} (${realDuration.toFixed(1)}s)`,
            `मेटाडेटा लोड हुआ: ${file.name} (${realDuration.toFixed(1)}s)`
          );
        }

        resolve({
          id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: cleanName,
          kind: 'video',
          mediaUrl: objectUrl,
          mediaBlobId: blobId,
          thumbnailUrl: thumbUrl || createPlaceholderThumbnail(cleanName, '#38BDF8'),
          duration: Number(Math.max(0.5, realDuration).toFixed(2)),
          createdAt: new Date().toISOString(),
        });
      };

      const timeoutId = setTimeout(() => {
        finish(
          createPlaceholderThumbnail(cleanName, '#F59E0B'),
          `Warning: Metadata timeout (>5s) for ${file.name}. Added with 5.0s fallback duration.`
        );
      }, 5000);

      video.onerror = () => {
        const errCode = video.error ? `Code ${video.error.code}: ${video.error.message || 'Decode issue'}` : 'Unknown WebView video error';
        finish(
          createPlaceholderThumbnail(cleanName, '#F43F5E'),
          `Warning (${file.name}): ${errCode}. Added clip with 5.0s fallback.`
        );
      };

      video.onloadedmetadata = () => {
        if (Number.isFinite(video.duration) && video.duration > 0.1) {
          realDuration = Math.min(300, video.duration);
        }
        try {
          video.currentTime = Math.min(0.1, realDuration * 0.1);
        } catch {
          finish(createPlaceholderThumbnail(cleanName, '#38BDF8'));
        }
      };

      video.onseeked = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 284;
          const ctx = canvas.getContext('2d');
          if (ctx && video.videoWidth > 0 && video.videoHeight > 0) {
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.65);
            finish(dataUrl);
            return;
          }
        } catch {
          // ignore canvas security/draw error
        }
        finish(createPlaceholderThumbnail(cleanName, '#38BDF8'));
      };

      video.src = objectUrl;
      video.load();
    });
  }

  // 2. IMAGE IMPORT (with <img> onload, 5s timeout, and 3.0s default duration)
  if (isImage) {
    return new Promise<ImportedMediaItem>((resolve) => {
      const img = new Image();
      let settled = false;

      const finish = (thumbUrl: string, warn?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        if (warn) {
          feedback.onStepToast(warn, warn);
        } else {
          feedback.onStepToast(
            `Photo loaded: ${file.name} (3.0s clip)`,
            `फ़ोटो लोड हुई: ${file.name} (3.0s क्लिप)`
          );
        }
        resolve({
          id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: cleanName,
          kind: 'image',
          mediaUrl: objectUrl,
          mediaBlobId: blobId,
          thumbnailUrl: thumbUrl || objectUrl,
          duration: 3.0,
          createdAt: new Date().toISOString(),
        });
      };

      const timeoutId = setTimeout(() => {
        finish(objectUrl, `Warning: Image load timeout for ${file.name}. Added with 3.0s duration.`);
      }, 5000);

      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 160;
          canvas.height = 284;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = '#090D14';
            ctx.fillRect(0, 0, 160, 284);
            ctx.drawImage(img, 0, 0, 160, 284);
            finish(canvas.toDataURL('image/jpeg', 0.7));
            return;
          }
        } catch {
          // fallback
        }
        finish(objectUrl);
      };

      img.onerror = () => {
        finish(
          createPlaceholderThumbnail(cleanName, '#F43F5E'),
          `Error loading image ${file.name} — added placeholder clip.`
        );
      };

      img.src = objectUrl;
    });
  }

  // 3. AUDIO IMPORT (with <audio> duration reader & 5s timeout)
  if (isAudio) {
    return new Promise<ImportedMediaItem>((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'metadata';
      audio.style.display = 'none';
      document.body.appendChild(audio);

      let settled = false;
      let dur = 6.0;

      const finish = (warn?: string) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeoutId);
        try {
          if (audio.parentNode) audio.parentNode.removeChild(audio);
        } catch {
          // ignore
        }
        if (warn) {
          feedback.onStepToast(warn, warn);
        } else {
          feedback.onStepToast(
            `Audio metadata loaded: ${file.name} (${dur.toFixed(1)}s)`,
            `ऑडियो लोड हुआ: ${file.name} (${dur.toFixed(1)}s)`
          );
        }
        resolve({
          id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: cleanName,
          kind: 'audio',
          mediaUrl: objectUrl,
          mediaBlobId: blobId,
          thumbnailUrl: createPlaceholderThumbnail(`🎵 ${cleanName}`, '#10B981'),
          duration: Number(Math.max(1.0, dur).toFixed(2)),
          createdAt: new Date().toISOString(),
        });
      };

      const timeoutId = setTimeout(() => {
        finish(`Warning: Audio metadata timeout for ${file.name}. Using 6.0s fallback.`);
      }, 5000);

      audio.onloadedmetadata = () => {
        if (Number.isFinite(audio.duration) && audio.duration > 0.2) {
          dur = Math.min(300, audio.duration);
        }
        finish();
      };

      audio.onerror = () => {
        finish(`Warning: Could not decode audio metadata for ${file.name}. Using 6.0s fallback.`);
      };

      audio.src = objectUrl;
      audio.load();
    });
  }

  // Fallback for unrecognized MIME on Android Content URI
  feedback.onStepToast(
    `Added file ${file.name} with fallback video metadata (5.0s).`,
    `फ़ाइल ${file.name} को 5.0s डिफ़ॉल्ट अवधि के साथ जोड़ा गया।`
  );
  return {
    id: `media-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: cleanName,
    kind: 'video',
    mediaUrl: objectUrl,
    mediaBlobId: blobId,
    thumbnailUrl: createPlaceholderThumbnail(cleanName, '#F59E0B'),
    duration: 5.0,
    createdAt: new Date().toISOString(),
  };
}
