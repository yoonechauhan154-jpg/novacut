import type { TimelineClip } from '../types/editor';
import { stretchClipAudio } from '../export/audioStretch';

/** HTMLMediaElement has no negative playback rate; reversed audio uses the same worker as export. */
class ReversePreviewAudio {
  private context?: AudioContext;
  private voices = new Map<string, { key: string; buffer?: AudioBuffer; node?: AudioBufferSourceNode; gain?: GainNode; started?: number; offset?: number; failed?: boolean }>();
  private desired = new Map<string, { clip: TimelineClip; time: number }>();
  stop() {
    this.desired.clear();
    for (const voice of this.voices.values()) { try { voice.node?.stop(); } catch {} voice.node = undefined; voice.gain?.disconnect(); }
  }
  sync(time: number, clips: TimelineClip[], playing: boolean, error: (message: string) => void) {
    if (!playing) { this.stop(); return; }
    this.desired.clear();
    for (const clip of clips) {
      if (!clip.reversed || clip.frozen || clip.muted || !clip.mediaUrl || !['audio', 'video', 'overlay'].includes(clip.trackType)
        || time < clip.startTime || time >= clip.startTime + clip.duration) continue;
      this.desired.set(clip.id, { clip, time });
      const key = [clip.mediaUrl, clip.sourceStart, clip.duration, clip.speed, clip.keepPitch].join('|');
      let voice = this.voices.get(clip.id);
      if (voice?.key !== key) {
        try { voice?.node?.stop(); } catch {} voice?.gain?.disconnect();
        voice = { key }; this.voices.set(clip.id, voice);
        const owned = voice;
        this.context ||= new AudioContext();
        const context = this.context;
        void (async () => {
          try {
            const response = await fetch(clip.mediaUrl!); if (!response.ok) throw new Error('Cannot read reverse audio');
            const decoded = await context.decodeAudioData(await response.arrayBuffer());
            if (decoded.length * decoded.numberOfChannels * 4 > 96 * 1024 * 1024) throw new Error('Reverse preview audio is too large');
            const processed = await stretchClipAudio(decoded, clip, context);
            if (this.voices.get(clip.id) === owned) owned.buffer = processed;
          } catch (e) { owned.failed = true; error('Reverse audio: ' + String(e)); }
        })();
      }
      if (!voice.buffer || !this.context) continue;
      const ctx = this.context, offset = time - clip.startTime;
      if (ctx.state === 'suspended') void ctx.resume();
      const expected = (voice.offset || 0) + ctx.currentTime - (voice.started || 0);
      if (!voice.node || Math.abs(expected - offset) > .2) {
        try { voice.node?.stop(); } catch {} voice.gain?.disconnect();
        voice.node = ctx.createBufferSource(); voice.node.buffer = voice.buffer;
        voice.gain = ctx.createGain(); voice.node.connect(voice.gain); voice.gain.connect(ctx.destination);
        voice.started = ctx.currentTime; voice.offset = offset; voice.node.start(0, offset);
      }
      const fade = Math.min(1, clip.fadeIn > 0 ? offset / clip.fadeIn : 1,
        clip.fadeOut > 0 ? (clip.duration - offset) / clip.fadeOut : 1);
      voice.gain!.gain.value = Math.max(0, clip.volume / 100 * fade);
    }
    for (const [id, voice] of this.voices) if (!this.desired.has(id)) {
      try { voice.node?.stop(); } catch {} voice.gain?.disconnect(); this.voices.delete(id);
    }
  }
}
export const reversePreviewAudio = new ReversePreviewAudio();
