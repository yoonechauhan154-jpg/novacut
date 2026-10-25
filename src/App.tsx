import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  Film,
  FlipHorizontal,
  FlipVertical,
  FolderPlus,
  Gauge,
  Globe,
  Info,
  KeyRound,
  Layers,
  Mic,
  MicOff,
  Music,
  Palette,
  Pause,
  Play,
  Plus,
  RotateCw,
  Scissors,
  Search,
  SkipBack,
  SkipForward,
  Sliders,
  Sparkles,
  Subtitles,
  Trash2,
  Type,
  Upload,
  Volume2,
  Wand2,
  X,
  ChevronUp,
  ChevronDown,
} from 'lucide-react';
import { SpecBlueprintView } from './components/SpecBlueprintView';
import { TimelinePanel } from './components/TimelinePanel';
import {
  AUTO_CAPTION_SCRIPTS,
  createBaseClip,
  DEFAULT_ADJUSTMENTS,
  FILTER_PRESETS,
  FONT_FAMILIES,
  INITIAL_PROJECT,
  INITIAL_SPEC_FORM,
  ROYALTY_FREE_AUDIO,
  STARTER_MEDIA_LIBRARY,
  STICKER_PRESETS,
  TEMPLATE_PRESETS,
} from './data/presets';
import {
  EFFECTS_CATALOG,
  TRANSITIONS_CATALOG,
  TRENDING_SEARCH_FINDINGS,
} from './effects/effectsLibrary';
import {
  downloadProjectJson,
  FEATURE_IMPLEMENTATION_CHECKLIST,
  parseCubeLutFile,
} from './export/exportEngine';
import { LanguageCode, SUPPORTED_LANGUAGES, t } from './i18n/translations';
import {
  AspectRatioKey,
  BlendModeType,
  MaskShapeType,
  ProjectData,
  SpecDecisionForm,
  SpeedCurvePreset,
  TemplatePreset,
  TextAnimationType,
  TimelineClip,
  TrackType,
  TransitionType,
  VideoEffectType,
  VoiceChangerPreset,
} from './types/editor';
import { renderProjectFrame } from './utils/canvasRenderer';
import { isAndroidNativeApp, saveAndShareFileOnDevice } from './utils/androidBridge';
import { soundEngine } from './utils/soundEngine';

type WorkspaceMode = 'editor' | 'templates' | 'projects' | 'spec';
type ToolCategory =
  | 'media'
  | 'layers'
  | 'effects'
  | 'text'
  | 'audio'
  | 'color'
  | 'keyframes'
  | 'speed';

const ASPECT_RATIOS: AspectRatioKey[] = ['9:16', '16:9', '1:1', '4:5', '4:3', '21:9'];

export function App() {
  // 1. Language Switcher State (persisted in localStorage)
  const [lang, setLang] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem('clipnova_lang_v2') as LanguageCode | null;
      if (saved === 'en' || saved === 'hi') return saved;
    } catch {
      // ignore
    }
    return 'en';
  });

  useEffect(() => {
    try {
      localStorage.setItem('clipnova_lang_v2', lang);
    } catch {
      // ignore
    }
  }, [lang]);

  // Workspace & Tool State
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('editor');
  const [activeTool, setActiveTool] = useState<ToolCategory>('layers');

  // Accordion: only one tool-inspector section open at a time
  const [accordionOpen, setAccordionOpen] = useState<string | null>('adjustment');

  const toggleAccordion = (id: string) => {
    setAccordionOpen((prev) => (prev === id ? null : id));
  };

  // Toast Notification for Best-Effort / Demo Features & Actions
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const triggerToast = (msgEn: string, msgHi?: string) => {
    setToastMessage(lang === 'hi' && msgHi ? msgHi : msgEn);
  };

  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 4200);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  // Project State + Unlimited Undo/Redo History
  const [project, setProject] = useState<ProjectData>(() => {
    try {
      const saved = localStorage.getItem('clipnova_active_project_v2');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_PROJECT;
  });

  const [historyPast, setHistoryPast] = useState<ProjectData[]>([]);
  const [historyFuture, setHistoryFuture] = useState<ProjectData[]>([]);

  // Drafts list
  const [drafts, setDrafts] = useState<ProjectData[]>(() => {
    try {
      const saved = localStorage.getItem('clipnova_drafts_v2');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return [INITIAL_PROJECT];
  });

  // Master Product Spec Form State
  const [specForm, setSpecForm] = useState<SpecDecisionForm>(() => {
    try {
      const saved = localStorage.getItem('clipnova_spec_form_v1');
      if (saved) return JSON.parse(saved);
    } catch {
      // ignore
    }
    return INITIAL_SPEC_FORM;
  });

  // Playback & Timeline State
  const [selectedClipId, setSelectedClipId] = useState<string | null>('clip-adj-1');
  const [playheadTime, setPlayheadTime] = useState<number>(2.0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [zoomPxPerSec, setZoomPxPerSec] = useState<number>(65);
  const [magneticSnap, setMagneticSnap] = useState<boolean>(true);

  // Effects Panel Search & Filter State
  const [effectSearch, setEffectSearch] = useState<string>('');
  const [effectCategory, setEffectCategory] = useState<
    'All' | 'Trending' | 'Glitch & Digital' | 'Motion & Velocity' | 'Optical & Light' | 'Transitions'
  >('All');
  const [showTrendFindings, setShowTrendFindings] = useState<boolean>(false);

  // Interactive Custom Mask Drawing Mode on Preview Canvas
  const [isDrawingCustomMask, setIsDrawingCustomMask] = useState<boolean>(false);

  // Voiceover & TTS State
  const [isRecordingVoice, setIsRecordingVoice] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [ttsInputText, setTtsInputText] = useState<string>(
    'नमस्ते क्रिएटर्स! ClipNova में आपका स्वागत है।'
  );
  const [ttsVoiceLang, setTtsVoiceLang] = useState<'hi-IN' | 'en-IN' | 'en-US'>('hi-IN');

  // Export & Checklist Modal State
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showChecklistModal, setShowChecklistModal] = useState<boolean>(false);
  const [isExportingVideo, setIsExportingVideo] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [exportedVideoBlob, setExportedVideoBlob] = useState<Blob | null>(null);

  // Refs for Canvas & Media Elements
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaElementsRef = useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map());
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const lutInputRef = useRef<HTMLInputElement | null>(null);

  const totalDuration = Math.max(
    4,
    ...project.clips.map((c) => Number((c.startTime + c.duration).toFixed(2)))
  );

  const selectedClip = project.clips.find((c) => c.id === selectedClipId) || null;

  // Auto-save project & drafts
  useEffect(() => {
    try {
      localStorage.setItem('clipnova_active_project_v2', JSON.stringify(project));
      setDrafts((prev) => {
        const exists = prev.some((d) => d.id === project.id);
        const updated = exists
          ? prev.map((d) => (d.id === project.id ? project : d))
          : [project, ...prev];
        localStorage.setItem('clipnova_drafts_v2', JSON.stringify(updated));
        return updated;
      });
    } catch {
      // ignore
    }
  }, [project]);

  useEffect(() => {
    try {
      localStorage.setItem('clipnova_spec_form_v1', JSON.stringify(specForm));
    } catch {
      // ignore
    }
  }, [specForm]);

  const updateProjectWithHistory = (updater: (prev: ProjectData) => ProjectData) => {
    setProject((prev) => {
      const next = updater(prev);
      setHistoryPast((h) => [...h.slice(-45), prev]);
      setHistoryFuture([]);
      return { ...next, updatedAt: new Date().toISOString() };
    });
  };

  const handleUndo = () => {
    if (historyPast.length === 0) return;
    const previous = historyPast[historyPast.length - 1];
    setHistoryPast((h) => h.slice(0, -1));
    setHistoryFuture((f) => [project, ...f]);
    setProject(previous);
  };

  const handleRedo = () => {
    if (historyFuture.length === 0) return;
    const next = historyFuture[0];
    setHistoryFuture((f) => f.slice(1));
    setHistoryPast((h) => [...h, project]);
    setProject(next);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (e.code === 'Space') {
        e.preventDefault();
        setIsPlaying((p) => !p);
      } else if (e.key === 's' || e.key === 'S') {
        e.preventDefault();
        handleSplitAtPlayhead();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedClipId) {
          e.preventDefault();
          handleDeleteSelected();
        }
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) handleRedo();
        else handleUndo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  // Playback loop
  useEffect(() => {
    if (!isPlaying) {
      soundEngine.triggerTimelineAudioTick(playheadTime, project.clips, false);
      return;
    }

    let animationFrameId: number;
    let lastTimestamp = performance.now();

    const tick = (now: number) => {
      const dt = (now - lastTimestamp) / 1000;
      lastTimestamp = now;

      setPlayheadTime((prevTime) => {
        const nextTime = prevTime + dt;
        if (nextTime >= totalDuration) {
          setIsPlaying(false);
          return 0;
        }
        soundEngine.triggerTimelineAudioTick(nextTime, project.clips, true);
        return nextTime;
      });

      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying, totalDuration, project.clips]);

  // Render Canvas whenever playheadTime or project changes
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    renderProjectFrame(ctx, project, playheadTime, mediaElementsRef.current);

    // If drawing custom mask, overlay the polygon vertices on preview
    if (isDrawingCustomMask && selectedClip?.customMaskPoints?.length) {
      const pts = selectedClip.customMaskPoints;
      const w = canvas.width;
      const h = canvas.height;
      ctx.save();
      ctx.strokeStyle = '#F59E0B';
      ctx.lineWidth = 3;
      ctx.beginPath();
      pts.forEach((p, idx) => {
        if (idx === 0) ctx.moveTo(p.x * w, p.y * h);
        else ctx.lineTo(p.x * w, p.y * h);
      });
      if (pts.length >= 3) ctx.closePath();
      ctx.stroke();
      pts.forEach((p) => {
        ctx.fillStyle = '#FDE047';
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, 6, 0, Math.PI * 2);
        ctx.fill();
      });
      ctx.restore();
    }
  }, [project, playheadTime, workspaceMode, isDrawingCustomMask, selectedClip]);

  // Voiceover timer
  useEffect(() => {
    if (!isRecordingVoice) {
      setRecordingSeconds(0);
      return;
    }
    const interval = setInterval(() => {
      setRecordingSeconds((s) => Number((s + 0.1).toFixed(1)));
    }, 100);
    return () => clearInterval(interval);
  }, [isRecordingVoice]);

  const updateSelectedClip = (patch: Partial<TimelineClip>) => {
    if (!selectedClipId) return;
    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => (c.id === selectedClipId ? { ...c, ...patch } : c)),
    }));
  };

  // ===========================================================================
  // REQUIREMENT 2: CREATE NON-DESTRUCTIVE ADJUSTMENT & EFFECT OVERLAY LAYERS
  // ===========================================================================
  const handleCreateAdjustmentLayer = () => {
    const newId = `adj-${Date.now()}`;
    const newLayer = createBaseClip({
      id: newId,
      trackId: 'track-adjustment',
      trackType: 'adjustment',
      title: `Adjustment Layer #${project.clips.filter((c) => c.trackType === 'adjustment').length + 1}`,
      titleHi: `एडजस्टमेंट लेयर #${project.clips.filter((c) => c.trackType === 'adjustment').length + 1}`,
      startTime: Number(playheadTime.toFixed(2)),
      duration: 4.0,
      sourceType: 'adjustment-layer',
      blendMode: 'source-over',
      opacity: 1,
      adjustments: {
        ...DEFAULT_ADJUSTMENTS,
        contrast: 14,
        saturation: 22,
        temperature: 18,
        vignette: 25,
      },
    });

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, newLayer],
    }));
    setSelectedClipId(newId);
    setActiveTool('layers');
    triggerToast(
      'Created non-destructive Adjustment Layer. It grades all tracks below it without modifying your original video.',
      'नॉन-डिस्ट्रक्टिव एडजस्टमेंट लेयर बनाई गई! यह मूल वीडियो को बदले बिना नीचे के सभी ट्रैक्स पर लागू होती है।'
    );
  };

  const handleCreateEffectLayer = (
    effectType: VideoEffectType = 'light-leak',
    startAtTime: number = playheadTime
  ) => {
    const catalogItem = EFFECTS_CATALOG.find((e) => e.id === effectType);
    const newId = `fxlayer-${Date.now()}`;
    const newLayer = createBaseClip({
      id: newId,
      trackId: 'track-effect-layer',
      trackType: 'effect-layer',
      title: `${catalogItem?.nameEn || effectType} Layer`,
      titleHi: `${catalogItem?.nameHi || effectType} लेयर`,
      startTime: Number(startAtTime.toFixed(2)),
      duration: 3.2,
      sourceType: 'effect-layer',
      effect: effectType,
      effectIntensity: catalogItem?.defaultIntensity ?? 80,
      blendMode: effectType === 'light-leak' || effectType === 'glow' ? 'screen' : 'source-over',
    });

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, newLayer],
    }));
    setSelectedClipId(newId);
    setActiveTool('layers');
    triggerToast(
      `Added "${catalogItem?.nameEn || effectType}" Effect Overlay Layer on timeline.`,
      `टाइमलाइन पर "${catalogItem?.nameHi || effectType}" इफेक्ट ओवरले लेयर जोड़ी गई।`
    );
  };

  // Auto-Cut Main Video to Audio Beat Markers
  const handleAutoBeatCut = () => {
    const audioClip = project.clips.find((c) => c.trackType === 'audio' && c.beatMarkers?.length);
    if (!audioClip || !audioClip.beatMarkers) {
      triggerToast(
        'Add an audio track with beat markers first.',
        'पहले बीट मार्क वाला ऑडियो ट्रैक जोड़ें।'
      );
      return;
    }

    // Take every 4th beat marker to create clean rhythmic cuts on Main Video clips
    const cutTimes = audioClip.beatMarkers
      .filter((_, idx) => idx % 3 === 2)
      .map((bm) => Number((audioClip.startTime + bm).toFixed(2)));

    updateProjectWithHistory((prev) => {
      let updatedClips = [...prev.clips];
      for (const ct of cutTimes) {
        const target = updatedClips.find(
          (c) =>
            c.trackType === 'video' && ct > c.startTime + 0.5 && ct < c.startTime + c.duration - 0.5
        );
        if (target) {
          const firstDur = Number((ct - target.startTime).toFixed(2));
          const secondDur = Number((target.duration - firstDur).toFixed(2));
          const firstClip: TimelineClip = {
            ...target,
            duration: firstDur,
            outPoint: target.inPoint + firstDur,
          };
          const secondClip: TimelineClip = {
            ...target,
            id: `beatcut-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            title: `${target.title} (Beat)`,
            startTime: ct,
            duration: secondDur,
            inPoint: target.inPoint + firstDur,
            transitionIn: 'flash',
            transitionDuration: 0.3,
          };
          updatedClips = updatedClips.flatMap((c) =>
            c.id === target.id ? [firstClip, secondClip] : [c]
          );
        }
      }
      return { ...prev, clips: updatedClips };
    });

    triggerToast(
      'Auto-Cut to Beat complete! Main video split at beat markers with flash transitions.',
      'बीट-सिंक ऑटो-कट पूरा हुआ! ऑडियो बीट्स पर वीडियो स्प्लिट और फ्लैश ट्रांज़िशन लगाए गए।'
    );
  };

  // Standard Timeline Operations
  const handleSplitAtPlayhead = () => {
    if (!selectedClip) return;
    if (
      playheadTime <= selectedClip.startTime + 0.25 ||
      playheadTime >= selectedClip.startTime + selectedClip.duration - 0.25
    ) {
      triggerToast(
        'Move playhead inside the selected clip to split it.',
        'क्लिप को काटने (Split) के लिए प्लेहेड को क्लिप के बीच में रखें।'
      );
      return;
    }
    const firstDur = Number((playheadTime - selectedClip.startTime).toFixed(2));
    const secondDur = Number((selectedClip.duration - firstDur).toFixed(2));
    const secondId = `clip-${Date.now()}`;

    const firstClip: TimelineClip = {
      ...selectedClip,
      duration: firstDur,
      outPoint: selectedClip.inPoint + firstDur,
    };
    const secondClip: TimelineClip = {
      ...selectedClip,
      id: secondId,
      title: `${selectedClip.title} (2)`,
      startTime: Number(playheadTime.toFixed(2)),
      duration: secondDur,
      inPoint: selectedClip.inPoint + firstDur,
    };

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: prev.clips.flatMap((c) =>
        c.id === selectedClip.id ? [firstClip, secondClip] : [c]
      ),
    }));
    setSelectedClipId(secondId);
  };

  const handleDuplicateSelected = () => {
    if (!selectedClip) return;
    const newId = `clip-${Date.now()}`;
    const copyClip: TimelineClip = {
      ...selectedClip,
      id: newId,
      title: `${selectedClip.title} Copy`,
      startTime: Number((selectedClip.startTime + selectedClip.duration).toFixed(2)),
    };
    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, copyClip],
    }));
    setSelectedClipId(newId);
  };

  const handleDeleteSelected = () => {
    if (!selectedClipId) return;
    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: prev.clips.filter((c) => c.id !== selectedClipId),
    }));
    setSelectedClipId(null);
  };

  const handleToggleReverseSelected = () => {
    if (!selectedClip) return;
    updateSelectedClip({ reversed: !selectedClip.reversed });
  };

  const handleToggleFreezeSelected = () => {
    if (!selectedClip) return;
    updateSelectedClip({ frozen: !selectedClip.frozen });
  };

  const handleAddKeyframeAtPlayhead = () => {
    if (!selectedClip) return;
    const offset = Math.max(
      0,
      Math.min(
        selectedClip.duration,
        Number((playheadTime - selectedClip.startTime).toFixed(2))
      )
    );
    const newKf = {
      id: `kf-${Date.now()}`,
      timeOffset: offset,
      scale: selectedClip.scale,
      x: selectedClip.posX,
      y: selectedClip.posY,
      rotation: selectedClip.rotation,
      opacity: selectedClip.opacity,
      effectIntensity: selectedClip.effectIntensity ?? 75,
      brightness: selectedClip.adjustments.brightness,
      easing: 'ease-in-out' as const,
    };
    updateSelectedClip({
      keyframes: [
        ...selectedClip.keyframes.filter((k) => Math.abs(k.timeOffset - offset) > 0.1),
        newKf,
      ],
    });
    triggerToast(
      `Added Keyframe (♦) at +${offset}s on "${selectedClip.title}".`,
      `"${selectedClip.title}" पर +${offset}s समय पर नया कीफ्रेम (♦) जोड़ा गया।`
    );
  };

  const handleUpdateClipTiming = (
    clipId: string,
    newStartTime: number,
    newDuration: number
  ) => {
    setProject((prev) => ({
      ...prev,
      clips: prev.clips.map((c) =>
        c.id === clipId ? { ...c, startTime: newStartTime, duration: newDuration } : c
      ),
    }));
  };

  const handleToggleTrackMute = (trackType: TrackType) => {
    updateProjectWithHistory((prev) => {
      const trackClips = prev.clips.filter((c) => c.trackType === trackType);
      const allMuted = trackClips.every((c) => c.muted);
      return {
        ...prev,
        clips: prev.clips.map((c) =>
          c.trackType === trackType ? { ...c, muted: !allMuted } : c
        ),
      };
    });
  };

  // Add Starter Scene
  const handleAddStarterClip = (
    item: (typeof STARTER_MEDIA_LIBRARY)[number],
    targetTrack: 'video' | 'overlay'
  ) => {
    const existingOnTrack = project.clips.filter((c) => c.trackType === targetTrack);
    const startAt =
      targetTrack === 'video'
        ? existingOnTrack.reduce((max, c) => Math.max(max, c.startTime + c.duration), 0)
        : Number(playheadTime.toFixed(2));

    const newId = `clip-${Date.now()}`;
    const newClip = createBaseClip({
      id: newId,
      trackId: targetTrack === 'video' ? 'track-video-main' : 'track-overlay-pip',
      trackType: targetTrack,
      title: item.title,
      titleHi: item.titleHi,
      startTime: Number(startAt.toFixed(2)),
      duration: item.duration,
      sourceType: 'procedural-scene',
      scenePreset: item.scenePreset,
      scale: targetTrack === 'overlay' ? 0.42 : 1,
      posX: targetTrack === 'overlay' ? 25 : 0,
      posY: targetTrack === 'overlay' ? -25 : 0,
      maskShape: targetTrack === 'overlay' ? 'circle' : 'none',
    });

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, newClip],
    }));
    setSelectedClipId(newId);
  };

  // Gallery Upload
  const handleGalleryFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    triggerToast(
      lang === 'hi' ? 'फ़ाइल चुन ली गई है, मेटाडेटा पढ़ रहा है…' : 'File selected, reading metadata…'
    );

    Array.from(files).forEach(async (file, idx) => {
      const url = URL.createObjectURL(file);
      const isVideo = file.type.startsWith('video/');
      const clipId = `upload-${Date.now()}-${idx}`;

      let duration = 4.5; // fallback

      if (isVideo) {
        const videoEl = document.createElement('video');
        videoEl.src = url;
        videoEl.muted = true;
        videoEl.playsInline = true;
        videoEl.preload = 'metadata';
        videoEl.crossOrigin = 'anonymous';
        videoEl.style.display = 'none';
        document.body.appendChild(videoEl);

        videoEl.onloadedmetadata = () => {
          duration = videoEl.duration || 4.5;
          const existingMain = project.clips.filter((c) => c.trackType === 'video');
          const startAt = existingMain.reduce(
            (max, c) => Math.max(max, c.startTime + c.duration),
            0
          );

          const newClip = createBaseClip({
            id: clipId,
            trackId: 'track-video-main',
            trackType: 'video',
            title: file.name.replace(/\.[^/.]+$/, ''),
            startTime: Number(startAt.toFixed(2)),
            duration: Number(duration.toFixed(2)),
            sourceType: 'uploaded-video',
            mediaUrl: url,
          });

          updateProjectWithHistory((prev) => ({
            ...prev,
            clips: [...prev.clips, newClip],
          }));
          setSelectedClipId(clipId);

          triggerToast(
            `Video imported: "${file.name}" (${duration.toFixed(2)}s) — added to Main Video track.`,
            `वीडियो इम्पोर्ट हो गया: "${file.name}" — मेन वीडियो ट्रैक पर जोड़ा गया।`
          );

          // Clean up the temporary video element
          URL.revokeObjectURL(url);
          document.body.removeChild(videoEl);
        };

        videoEl.onerror = () => {
          triggerToast(
            `Failed to load video: ${file.name}`,
            `वीडियो लोड करने में विफल: ${file.name}`
          );
          URL.revokeObjectURL(url);
          document.body.removeChild(videoEl);
        };

        videoEl.load();
      } else {
        const imgEl = new Image();
        imgEl.src = url;
        imgEl.onload = () => {
          mediaElementsRef.current.set(clipId, imgEl);

          const existingMain = project.clips.filter((c) => c.trackType === 'video');
          const startAt = existingMain.reduce(
            (max, c) => Math.max(max, c.startTime + c.duration),
            0
          );

          const newClip = createBaseClip({
            id: clipId,
            trackId: 'track-video-main',
            trackType: 'video',
            title: file.name.replace(/\.[^/.]+$/, ''),
            startTime: Number(startAt.toFixed(2)),
            duration: Number(duration.toFixed(2)),
            sourceType: 'uploaded-image',
            mediaUrl: url,
          });

          updateProjectWithHistory((prev) => ({
            ...prev,
            clips: [...prev.clips, newClip],
          }));
          setSelectedClipId(clipId);

          triggerToast(
            `Image imported: "${file.name}" — added to Main Video track.`,
            `इमेज इम्पोर्ट हो गई: "${file.name}" — मेन वीडियो ट्रैक पर जोड़ा गया।`
          );

          URL.revokeObjectURL(url);
        };
        imgEl.onerror = () => {
          triggerToast(
            `Failed to load image: ${file.name}`,
            `इमेज लोड करने में विफल: ${file.name}`
          );
          URL.revokeObjectURL(url);
        };
      }
    });

    e.target.value = '';
  };

  // .CUBE LUT File Upload
  const handleLutFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedClip) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || '');
      const parsed = parseCubeLutFile(file.name, text);
      updateSelectedClip({
        adjustments: {
          ...selectedClip.adjustments,
          ...parsed,
        },
      });
      triggerToast(
        `Imported 3D LUT "${file.name}" onto "${selectedClip.title}".`,
        `"${file.name}" LUT सफलतापूर्वक "${selectedClip.title}" पर लागू किया गया।`
      );
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Text & Captions
  const handleAddTextOverlay = (
    presetText: string,
    fontFam: string,
    anim: TextAnimationType
  ) => {
    const newId = `txt-${Date.now()}`;
    const newClip = createBaseClip({
      id: newId,
      trackId: 'track-text-captions',
      trackType: 'text',
      title: presetText.slice(0, 18),
      startTime: Number(playheadTime.toFixed(2)),
      duration: 3.5,
      sourceType: 'text',
      textContent: presetText,
      fontFamily: fontFam,
      fontSize: 38,
      textColor: '#FFFFFF',
      outlineColor: '#0F172A',
      outlineWidth: 4,
      shadowBlur: 10,
      bgBoxColor: '#F59E0B',
      bgBoxOpacity: 0.85,
      posX: 0,
      posY: 26,
      textAnimation: anim,
    });

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, newClip],
    }));
    setSelectedClipId(newId);
  };

  const handleGenerateAutoCaptions = (capLang: 'hindi' | 'hinglish' | 'english') => {
    const script = AUTO_CAPTION_SCRIPTS[capLang];
    const generatedClips: TimelineClip[] = script.map((line, i) =>
      createBaseClip({
        id: `autocap-${Date.now()}-${i}`,
        trackId: 'track-text-captions',
        trackType: 'text',
        title: `Auto Caption #${i + 1}`,
        startTime: line.start,
        duration: line.duration,
        sourceType: 'text',
        textContent: line.text,
        fontFamily: 'Noto Sans Devanagari',
        fontSize: 36,
        textColor: '#FFFFFF',
        outlineColor: '#090D16',
        outlineWidth: 4,
        bgBoxColor: '#0F172A',
        bgBoxOpacity: 0.82,
        posX: 0,
        posY: 28,
        textAnimation: 'karaoke-highlight',
      })
    );

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips.filter((c) => c.trackType !== 'text'), ...generatedClips],
    }));
    if (generatedClips[0]) setSelectedClipId(generatedClips[0].id);
    triggerToast(
      `Generated editable ${capLang.toUpperCase()} auto-captions with word highlighting.`,
      `वर्ड-बाय-वर्ड हाइलाइट के साथ ${capLang.toUpperCase()} ऑटो-कैप्शन टाइमलाइन में जोड़े गए।`
    );
  };

  const handleAddSticker = (glyph: string, label: string) => {
    const newId = `stk-${Date.now()}`;
    const newClip = createBaseClip({
      id: newId,
      trackId: 'track-stickers',
      trackType: 'sticker',
      title: label,
      startTime: Number(playheadTime.toFixed(2)),
      duration: 3.0,
      sourceType: 'sticker',
      stickerGlyph: glyph,
      stickerLabel: label,
      scale: 1,
      posX: 0,
      posY: -20,
    });
    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, newClip],
    }));
    setSelectedClipId(newId);
  };

  // Audio, Voiceover, Extract Audio & TTS
  const handleAddAudioTrack = (track: (typeof ROYALTY_FREE_AUDIO)[number]) => {
    const newId = `aud-${Date.now()}`;
    const newClip = createBaseClip({
      id: newId,
      trackId: 'track-audio-main',
      trackType: 'audio',
      title: track.title,
      titleHi: track.titleHi,
      startTime: 0,
      duration: Math.min(track.duration, totalDuration),
      sourceType: 'synth-audio',
      synthPreset: track.synthPreset,
      beatMarkers: track.beatMarkers,
      volume: 100,
    });
    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips.filter((c) => c.trackType !== 'audio'), newClip],
    }));
    setSelectedClipId(newId);
  };

  const handleExtractAudioFromVideo = () => {
    const sourceVideo =
      selectedClip && (selectedClip.trackType === 'video' || selectedClip.trackType === 'overlay')
        ? selectedClip
        : project.clips.find((c) => c.trackType === 'video');
    if (!sourceVideo) return;

    const newId = `extracted-aud-${Date.now()}`;
    const beatMarkers = soundEngine.generateAutoBeatMarkers(sourceVideo.duration, 100);
    const extractedClip = createBaseClip({
      id: newId,
      trackId: 'track-audio-main',
      trackType: 'audio',
      title: `Extracted: ${sourceVideo.title}`,
      titleHi: `एक्सट्रैक्टेड ऑडियो: ${sourceVideo.titleHi || sourceVideo.title}`,
      startTime: sourceVideo.startTime,
      duration: sourceVideo.duration,
      sourceType: 'synth-audio',
      synthPreset: 'lofi-monsoon',
      beatMarkers,
    });

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, extractedClip],
    }));
    setSelectedClipId(newId);
    triggerToast(
      `Extracted audio stream and beat markers from "${sourceVideo.title}".`,
      `"${sourceVideo.title}" से ऑडियो और बीट मार्क्स अलग ट्रैक में निकाले गए।`
    );
  };

  const handleSynthesizeTtsToTimeline = () => {
    if (!ttsInputText.trim()) return;
    const spoke = soundEngine.speakTextToSpeech(ttsInputText, ttsVoiceLang);
    const estDuration = Math.max(2.2, Number((ttsInputText.length * 0.08).toFixed(1)));
    const newId = `tts-${Date.now()}`;
    const ttsClip = createBaseClip({
      id: newId,
      trackId: 'track-audio-main',
      trackType: 'audio',
      title: `TTS (${ttsVoiceLang}): ${ttsInputText.slice(0, 16)}...`,
      titleHi: `TTS वॉइस (${ttsVoiceLang}): ${ttsInputText.slice(0, 16)}...`,
      startTime: Number(playheadTime.toFixed(2)),
      duration: estDuration,
      sourceType: 'synth-audio',
      synthPreset: 'lofi-monsoon',
      beatMarkers: soundEngine.generateAutoBeatMarkers(estDuration, 96),
    });

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, ttsClip],
    }));
    setSelectedClipId(newId);
    triggerToast(
      spoke
        ? 'Synthesized voice via Web Speech API and added TTS clip to Audio Track.'
        : 'Added TTS clip to Audio Track (Browser Web Speech synthesis fallback).',
      'टेक्स्ट-टू-स्पीच (TTS) वॉइस जनरेट कर ऑडियो ट्रैक में जोड़ी गई।'
    );
  };

  const handleToggleVoiceover = async () => {
    if (!isRecordingVoice) {
      const started = await soundEngine.startVoiceoverRecording();
      if (started) {
        setIsRecordingVoice(true);
      } else {
        const newId = `vo-${Date.now()}`;
        const voClip = createBaseClip({
          id: newId,
          trackId: 'track-audio-main',
          trackType: 'audio',
          title: 'Hindi Voiceover Track (वॉइसओवर)',
          startTime: Number(playheadTime.toFixed(2)),
          duration: 3.5,
          sourceType: 'synth-audio',
          synthPreset: 'lofi-monsoon',
          beatMarkers: [0.6, 1.2, 1.8, 2.4, 3.0],
        });
        updateProjectWithHistory((prev) => ({
          ...prev,
          clips: [...prev.clips, voClip],
        }));
        setSelectedClipId(newId);
        triggerToast(
          'Microphone permission unavailable in sandbox — added demo Voiceover clip to timeline.',
          'माइक अनुमति उपलब्ध न होने के कारण डेमो वॉइसओवर ट्रैक टाइमलाइन पर जोड़ा गया।'
        );
      }
    } else {
      const recordedUrl = await soundEngine.stopVoiceoverRecording();
      setIsRecordingVoice(false);
      const newId = `vo-${Date.now()}`;
      const voClip = createBaseClip({
        id: newId,
        trackId: 'track-audio-main',
        trackType: 'audio',
        title: `Mic Voiceover (${Math.max(1.5, recordingSeconds)}s)`,
        startTime: Number(playheadTime.toFixed(2)),
        duration: Math.max(2.0, recordingSeconds),
        sourceType: recordedUrl ? 'uploaded-audio' : 'synth-audio',
        mediaUrl: recordedUrl || undefined,
        synthPreset: 'lofi-monsoon',
        beatMarkers: [0.5, 1.0, 1.5, 2.0],
      });
      updateProjectWithHistory((prev) => ({
        ...prev,
        clips: [...prev.clips, voClip],
      }));
      setSelectedClipId(newId);
    }
  };

  const handleLoadTemplate = (tpl: TemplatePreset) => {
    const newProj: ProjectData = {
      id: `proj-tpl-${Date.now()}`,
      name: `${tpl.nameHi} · ${tpl.nameEn}`,
      aspectRatio: tpl.aspectRatio,
      fps: 30,
      resolution: '1080p',
      updatedAt: new Date().toISOString(),
      background: {
        type: 'gradient',
        solidColor: '#0F172A',
        gradientFrom: '#0F172A',
        gradientTo: '#1E293B',
        blurAmount: 20,
      },
      watermarkEnabled: !project.isProUnlocked,
      isProUnlocked: project.isProUnlocked,
      clips: tpl.clips.map((c) => ({ ...c, id: `${c.id}-${Date.now()}` })),
    };
    setProject(newProj);
    setPlayheadTime(0);
    setSelectedClipId(newProj.clips[0]?.id || null);
    setWorkspaceMode('editor');
  };

  // Interactive Canvas Click for Custom Polygon Mask Drawing
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingCustomMask || !selectedClip || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const normX = Number(Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)).toFixed(3));
    const normY = Number(Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)).toFixed(3));
    const nextPoints = [...(selectedClip.customMaskPoints || []), { x: normX, y: normY }];
    updateSelectedClip({
      maskShape: 'custom-draw',
      customMaskPoints: nextPoints,
    });
  };

  // Real Video Export via Canvas CaptureStream + MediaRecorder
  const handleStartVideoExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setIsExportingVideo(true);
    setExportProgress(0);
    setExportedVideoUrl(null);
    setIsPlaying(false);

    try {
      const stream = canvas.captureStream(project.fps);
      const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
        ? 'video/webm;codecs=vp9'
        : 'video/webm';
      const recorder = new MediaRecorder(stream, { mimeType });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setExportedVideoBlob(blob);
        setExportedVideoUrl(url);
        setIsExportingVideo(false);
        setExportProgress(100);
      };

      recorder.start();

      const exportDuration = Math.min(totalDuration, 6);
      const totalSteps = 60;
      let step = 0;

      const interval = setInterval(() => {
        step++;
        const simTime = (step / totalSteps) * totalDuration;
        setPlayheadTime(simTime);
        setExportProgress(Math.min(99, Math.round((step / totalSteps) * 100)));

        if (step >= totalSteps) {
          clearInterval(interval);
          recorder.stop();
        }
      }, (exportDuration * 450) / totalSteps);
    } catch {
      setIsExportingVideo(false);
      setExportProgress(100);
    }
  };

  // Filter Effects & Transitions for Library Panel
  const filteredEffects = EFFECTS_CATALOG.filter((item) => {
    if (effectCategory === 'Transitions') return false;
    if (effectCategory === 'Trending' && !item.isTrending2026) return false;
    if (
      effectCategory !== 'All' &&
      effectCategory !== 'Trending' &&
      item.category !== effectCategory
    ) {
      return false;
    }
    if (!effectSearch.trim()) return true;
    const q = effectSearch.toLowerCase();
    return (
      item.nameEn.toLowerCase().includes(q) ||
      item.nameHi.toLowerCase().includes(q) ||
      item.id.toLowerCase().includes(q) ||
      item.descEn.toLowerCase().includes(q)
    );
  });

  const filteredTransitions = TRANSITIONS_CATALOG.filter((tr) => {
    if (
      effectCategory !== 'All' &&
      effectCategory !== 'Transitions' &&
      !(effectCategory === 'Trending' && tr.isTrending2026)
    ) {
      return false;
    }
    if (!effectSearch.trim()) return true;
    const q = effectSearch.toLowerCase();
    return (
      tr.nameEn.toLowerCase().includes(q) ||
      tr.nameHi.toLowerCase().includes(q) ||
      tr.id.toLowerCase().includes(q)
    );
  });

  return (
    <div className="min-h-screen flex flex-col bg-[#0B0F17] text-slate-100">
      {/* Hidden File Inputs */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        onChange={handleGalleryFileUpload}
        className="hidden"
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          const url = URL.createObjectURL(file);
          const newId = `aud-custom-${Date.now()}`;
          const newClip = createBaseClip({
            id: newId,
            trackId: 'track-audio-main',
            trackType: 'audio',
            title: file.name.replace(/\.[^/.]+$/, ''),
            startTime: 0,
            duration: totalDuration,
            sourceType: 'uploaded-audio',
            mediaUrl: url,
            beatMarkers: [0.6, 1.2, 1.8, 2.4, 3.0, 3.6, 4.2, 4.8],
          });
          updateProjectWithHistory((prev) => ({
            ...prev,
            clips: [...prev.clips, newClip],
          }));
          setSelectedClipId(newId);
        }}
        className="hidden"
      />
      <input
        ref={lutInputRef}
        type="file"
        accept=".cube,.3dl"
        onChange={handleLutFileUpload}
        className="hidden"
      />

      {/* Toast Notification for Best-Effort / Demo Features */}
      {toastMessage && (
        <div className="fixed bottom-6 right-6 z-50 max-w-md bg-slate-900/95 border border-amber-500/60 text-slate-100 px-4 py-3 rounded-xl shadow-2xl flex items-start gap-3 backdrop-blur-md">
          <Info className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="text-xs leading-relaxed flex-1">{toastMessage}</div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="text-slate-400 hover:text-slate-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* TOP BAR CONTRACT: 3 Zones separated by gap-3 on phone, gap-8 on desktop */}
      <header className="flex items-center justify-between gap-2 sm:gap-8 px-3 sm:px-6 py-2.5 sm:py-3 bg-[#090D14] border-b border-slate-800/90 shrink-0 flex-wrap sm:flex-nowrap">
        {/* Zone 1: Single text element wordmark */}
        <a
          href="#editor"
          onClick={(e) => {
            e.preventDefault();
            setWorkspaceMode('editor');
          }}
          className="font-display text-lg font-bold tracking-tight text-slate-100 whitespace-nowrap shrink-0"
        >
          ClipNova
        </a>
        <span className="text-[10px] text-slate-500 shrink-0 whitespace-nowrap ml-2">3d237c2</span>

        {/* Zone 2: 4 concise single-line text navigation links */}
        <nav className="flex items-center gap-6 text-sm font-medium text-slate-400 flex-wrap">
          <a
            href="#editor"
            onClick={(e) => {
              e.preventDefault();
              setWorkspaceMode('editor');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
              workspaceMode === 'editor'
                ? 'text-amber-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            {t(lang, 'navEditor')}
          </a>
          <a
            href="#templates"
            onClick={(e) => {
              e.preventDefault();
              setWorkspaceMode('templates');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
              workspaceMode === 'templates'
                ? 'text-amber-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            {t(lang, 'navTemplates')}
          </a>
          <a
            href="#projects"
            onClick={(e) => {
              e.preventDefault();
              setWorkspaceMode('projects');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
              workspaceMode === 'projects'
                ? 'text-amber-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            {t(lang, 'navProjects')}
          </a>
          <a
            href="#spec"
            onClick={(e) => {
              e.preventDefault();
              setWorkspaceMode('spec');
            }}
            className={`hover:text-slate-100 transition-colors whitespace-nowrap shrink-0 py-1 ${
              workspaceMode === 'spec'
                ? 'text-amber-400 underline underline-offset-8 decoration-2'
                : ''
            }`}
          >
            {t(lang, 'navSpec')}
          </a>
        </nav>

        {/* Zone 3: Language Switcher + Primary Export Action */}
        <div className="flex items-center gap-3 flex-wrap shrink-0">
          <div className="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5">
            <Globe className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <select
              value={lang}
              onChange={(e) => setLang(e.target.value as LanguageCode)}
              aria-label="Language Switcher"
              className="bg-transparent text-xs font-medium text-slate-200 focus:outline-none cursor-pointer"
            >
              {SUPPORTED_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code} className="bg-slate-900 text-slate-100">
                  {l.nativeLabel}
                </option>
              ))}
            </select>
          </div>

          <button
            type="button"
            onClick={() => {
              setExportedVideoUrl(null);
              setExportedVideoBlob(null);
              setExportProgress(0);
              setShowExportModal(true);
            }}
            className="min-h-[38px] px-3 sm:px-4 py-2 text-xs font-semibold text-slate-950 bg-amber-500 rounded-lg hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0"
          >
            {t(lang, 'btnExportVideo')}
          </button>
        </div>
      </header>

      {/* MAIN WORKSPACE ROUTER */}
      {workspaceMode === 'spec' && (
        <main className="flex-1 overflow-y-auto">
          <SpecBlueprintView
            specForm={specForm}
            onChangeSpecForm={setSpecForm}
            onOpenEditor={() => setWorkspaceMode('editor')}
          />
        </main>
      )}

      {workspaceMode === 'templates' && (
        <main className="flex-1 overflow-y-auto max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <div className="text-xs font-medium text-amber-400">
                3.8 रेडीमेड टेम्पलेट्स · 1-Tap Beat-Synced Reels with Non-Destructive Layers
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 mt-1">
                {lang === 'hi'
                  ? 'रेडीमेड क्रिएटर टेम्पलेट्स (1-टैप स्लॉट्स)'
                  : 'Ready-Made Creator Templates (1-Tap Slots)'}
              </h1>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {TEMPLATE_PRESETS.map((tpl) => (
              <div
                key={tpl.id}
                className="bg-[#0F1522] border border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-5 hover:border-slate-700 transition-colors"
              >
                <div className="space-y-3">
                  <div className="text-xs text-slate-400">
                    <span>{tpl.category}</span>
                    <span className="mx-1.5">·</span>
                    <span className="font-mono tabular-nums">{tpl.aspectRatio}</span>
                    <span className="mx-1.5">·</span>
                    <span className="font-mono tabular-nums">{tpl.bpm} BPM</span>
                  </div>
                  <h2 className="text-lg font-bold text-slate-100">
                    {lang === 'hi' ? tpl.nameHi : tpl.nameEn}
                  </h2>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    {lang === 'hi' ? tpl.descriptionHi : tpl.descriptionEn}
                  </p>
                </div>

                <div className="pt-4 border-t border-slate-800/80 flex items-center justify-between gap-3">
                  <div className="font-mono tabular-nums text-xs text-slate-400">
                    {tpl.slotsCount} Slots · {tpl.duration}s
                  </div>
                  <button
                    type="button"
                    onClick={() => handleLoadTemplate(tpl)}
                    className="min-h-[40px] px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span>{lang === 'hi' ? 'टेम्पलेट लोड करें' : 'Use Template'}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        </main>
      )}

      {workspaceMode === 'projects' && (
        <main className="flex-1 overflow-y-auto max-w-7xl w-full mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-800 pb-5">
            <div>
              <div className="text-xs font-medium text-amber-400">
                3.1 प्रोजेक्ट और मीडिया मैनेजमेंट · Local Auto-Save & Crash Recovery
              </div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-100 mt-1">
                {lang === 'hi' ? 'ड्राफ्ट प्रोजेक्ट्स' : 'Saved Draft Projects'}
              </h1>
            </div>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => downloadProjectJson(project)}
                className="min-h-[42px] px-4 py-2 rounded-lg border border-slate-700 bg-slate-900 hover:bg-slate-800 text-xs font-medium text-slate-200 transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <Download className="w-4 h-4 text-sky-400" />
                <span>{t(lang, 'exportJsonBtn')}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  const fresh: ProjectData = {
                    ...INITIAL_PROJECT,
                    id: `proj-${Date.now()}`,
                    name: `नया रील प्रोजेक्ट #${drafts.length + 1}`,
                    updatedAt: new Date().toISOString(),
                  };
                  setProject(fresh);
                  setWorkspaceMode('editor');
                }}
                className="min-h-[42px] px-4 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors flex items-center gap-2 whitespace-nowrap shrink-0"
              >
                <FolderPlus className="w-4 h-4" />
                <span>{lang === 'hi' ? '+ नया प्रोजेक्ट' : '+ New Project'}</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {drafts.map((d) => {
              const isCurrent = d.id === project.id;
              return (
                <div
                  key={d.id}
                  className={`p-5 rounded-xl border bg-[#0F1522] flex flex-col justify-between space-y-4 ${
                    isCurrent ? 'border-amber-500/60' : 'border-slate-800'
                  }`}
                >
                  <div className="space-y-2">
                    <div className="text-xs text-slate-400 font-mono tabular-nums">
                      <span>{d.aspectRatio}</span>
                      <span className="mx-1.5">·</span>
                      <span>{d.resolution}</span>
                      <span className="mx-1.5">·</span>
                      <span>{d.fps}fps</span>
                      <span className="mx-1.5">·</span>
                      <span>{d.clips.length} clips</span>
                    </div>
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => {
                        const newName = e.target.value;
                        if (isCurrent) setProject({ ...project, name: newName });
                        setDrafts((prev) =>
                          prev.map((item) =>
                            item.id === d.id ? { ...item, name: newName } : item
                          )
                        );
                      }}
                      className="w-full bg-transparent text-base font-semibold text-slate-100 border-b border-transparent focus:border-amber-500 focus:outline-none pb-0.5"
                    />
                    <div className="text-[11px] text-slate-500 font-mono tabular-nums">
                      Auto-saved: {new Date(d.updatedAt).toLocaleString()}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-slate-800/80">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          const dup: ProjectData = {
                            ...d,
                            id: `proj-${Date.now()}`,
                            name: `${d.name} (Copy)`,
                            updatedAt: new Date().toISOString(),
                          };
                          setDrafts((prev) => [dup, ...prev]);
                        }}
                        className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 text-xs"
                        title="Duplicate Project"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {drafts.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            setDrafts((prev) => prev.filter((item) => item.id !== d.id));
                          }}
                          className="p-2 rounded-lg bg-slate-900 hover:bg-rose-950 text-rose-400 text-xs"
                          title="Delete Draft"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setProject(d);
                        setWorkspaceMode('editor');
                      }}
                      className="min-h-[38px] px-4 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs transition-colors whitespace-nowrap shrink-0"
                    >
                      {isCurrent ? 'Active' : 'Open'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* EDITOR STUDIO WORKSPACE (Portrait-Friendly Responsive Mobile + Desktop Layout) */}
      {workspaceMode === 'editor' && (
        <div className="flex-1 flex flex-col overflow-y-auto lg:overflow-hidden">
          {/* Upper Split: Preview on top in portrait mobile (order-1), Tool Dock below (order-2); side-by-side on desktop */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 min-h-0 lg:overflow-hidden">
            <div className="order-2 lg:order-1 lg:col-span-5 flex border-b lg:border-b-0 lg:border-r border-slate-800/90 bg-[#0E131F] min-h-[260px] max-h-[340px] lg:max-h-none overflow-hidden">
              {/* Vertical Tool Rail */}
              <div className="w-20 bg-[#090D14] border-r border-slate-800/90 flex flex-col items-center py-2 gap-1 overflow-y-auto shrink-0">
                {[
                  { id: 'layers' as const, icon: Layers, label: t(lang, 'toolLayers') },
                  { id: 'effects' as const, icon: Sparkles, label: t(lang, 'toolEffects') },
                  { id: 'media' as const, icon: Film, label: t(lang, 'toolMedia') },
                  { id: 'text' as const, icon: Type, label: t(lang, 'toolText') },
                  { id: 'audio' as const, icon: Music, label: t(lang, 'toolAudio') },
                  { id: 'color' as const, icon: Palette, label: t(lang, 'toolColor') },
                  { id: 'keyframes' as const, icon: KeyRound, label: t(lang, 'toolKeyframes') },
                  { id: 'speed' as const, icon: Gauge, label: t(lang, 'toolSpeed') },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTool === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTool(tab.id)}
                      className={`w-16 min-h-[50px] px-1 rounded-xl flex flex-col items-center justify-center gap-1 transition-colors ${
                        active
                          ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40'
                          : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                      }`}
                    >
                      <Icon className="w-4 h-4 shrink-0" />
                      <span className="text-[10px] font-medium leading-tight text-center truncate w-full">
                        {tab.label}
                      </span>
                    </button>
                  );
                })}
              </div>

              {/* Tool Inspector Content Area */}
              <div className="flex-1 p-4 overflow-y-auto space-y-5">
                {/* ========================================================= */}
                {/* TAB 1: NON-DESTRUCTIVE ADJUSTMENT & EFFECT OVERLAY LAYERS */}
                {/* ========================================================= */}
                {activeTool === 'layers' && (
                  <div className="space-y-4">
                    {/* Section: Create Layers */}
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleAccordion('create-layers')}
                        className="flex items-center justify-between w-full py-2 px-3 rounded-lg bg-slate-900/80 border border-slate-800 hover:bg-slate-800 text-left transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div className="text-[11px] font-semibold text-cyan-400">
                            {t(lang, 'nonDestructiveBadge')}
                          </div>
                          <h2 className="text-sm font-bold text-slate-100">
                            {lang === 'hi'
                              ? 'एडजस्टमेंट लेयर और इफेक्ट ओवरले लेयर'
                              : 'Adjustment Layers & Effect Overlay Layers'}
                          </h2>
                        </div>
                        {accordionOpen === 'create-layers' ? (
                          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                      </button>
                      {accordionOpen === 'create-layers' && (
                        <div className="mt-3 space-y-2">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                            <button
                              type="button"
                              onClick={handleCreateAdjustmentLayer}
                              className="min-h-[42px] px-3 py-2 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/50 text-cyan-200 font-semibold text-xs flex items-center justify-center gap-1.5"
                            >
                              <Sliders className="w-3.5 h-3.5 text-cyan-400" />
                              <span>{t(lang, 'createAdjustmentLayer')}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCreateEffectLayer('light-leak', playheadTime)}
                              className="min-h-[42px] px-3 py-2 rounded-lg bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/50 text-fuchsia-200 font-semibold text-xs flex items-center justify-center gap-1.5"
                            >
                              <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
                              <span>{t(lang, 'createEffectOverlayLayer')}</span>
                            </button>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Section: Active Layer or Clip Inspector */}
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleAccordion('clip-inspector')}
                        className="flex items-center justify-between w-full py-2 px-3 rounded-lg bg-slate-900/80 border border-slate-800 hover:bg-slate-800 text-left transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-slate-300">
                            {selectedClip ? `Selected: ${selectedClip.title}` : 'No clip selected'}
                          </span>
                          {accordionOpen === 'clip-inspector' ? (
                            <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                          ) : (
                            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                          )}
                        </div>
                      </button>
                      {accordionOpen === 'clip-inspector' && (
                        <div className="mt-3 space-y-2">
                          {selectedClip ? (
                            <div className="p-3.5 rounded-xl bg-slate-900/90 border border-slate-800 space-y-4">
                              <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                                <div>
                                  <div className="text-xs font-bold text-amber-400">
                                    {selectedClip.trackType === 'adjustment'
                                      ? '◐ Adjustment Layer Active'
                                      : selectedClip.trackType === 'effect-layer'
                                      ? '✦ Effect Overlay Layer Active'
                                      : `Selected Clip: ${selectedClip.trackType.toUpperCase()}`}
                                  </div>
                                  <div className="text-xs text-slate-200 truncate">
                                    {selectedClip.title} ({selectedClip.startTime}s –{' '}
                                    {(selectedClip.startTime + selectedClip.duration).toFixed(1)}s)
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={handleAddKeyframeAtPlayhead}
                                  className="px-2.5 py-1 rounded bg-amber-500/20 border border-amber-500/40 text-amber-300 text-[11px] font-semibold"
                                >
                                  {t(lang, 'btnAddKeyframe')}
                                </button>
                              </div>

                        {/* Blend Mode & Opacity (Works on Adjustment Layers, Effect Layers & Clips) */}
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              {t(lang, 'blendMode')}
                            </label>
                            <select
                              value={selectedClip.blendMode}
                              onChange={(e) =>
                                updateSelectedClip({ blendMode: e.target.value as BlendModeType })
                              }
                              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                            >
                              <option value="source-over">Normal (Pass-Through)</option>
                              <option value="screen">Screen (Lighten/Add)</option>
                              <option value="multiply">Multiply (Darken)</option>
                              <option value="overlay">Overlay (Contrast)</option>
                              <option value="lighter">Add / Linear Dodge</option>
                              <option value="color-dodge">Color Dodge</option>
                              <option value="hard-light">Hard Light</option>
                            </select>
                          </div>

                          <div>
                            <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                              <span>{t(lang, 'opacity')}</span>
                              <span className="font-mono tabular-nums text-amber-400">
                                {Math.round(selectedClip.opacity * 100)}%
                              </span>
                            </div>
                            <input
                              type="range"
                              min={0.05}
                              max={1}
                              step={0.05}
                              value={selectedClip.opacity}
                              onChange={(e) =>
                                updateSelectedClip({ opacity: Number(e.target.value) })
                              }
                              className="w-full accent-amber-500"
                            />
                          </div>
                        </div>

                        {/* If Effect Overlay Layer or Clip: Shader Effect Type & Intensity */}
                        {(selectedClip.trackType === 'effect-layer' ||
                          selectedClip.trackType === 'video' ||
                          selectedClip.trackType === 'overlay') && (
                          <div className="p-3 rounded-lg bg-slate-950 border border-fuchsia-500/30 space-y-2.5">
                            <div className="grid grid-cols-2 gap-2.5 items-center">
                              <div>
                                <label className="block text-[11px] text-slate-400 mb-1">
                                  Shader Effect
                                </label>
                                <select
                                  value={selectedClip.effect}
                                  onChange={(e) =>
                                    updateSelectedClip({
                                      effect: e.target.value as VideoEffectType,
                                    })
                                  }
                                  className="w-full px-2 py-1.5 rounded bg-slate-900 border border-slate-800 text-xs text-slate-100"
                                >
                                  <option value="none">None</option>
                                  {EFFECTS_CATALOG.map((fx) => (
                                    <option key={fx.id} value={fx.id}>
                                      {lang === 'hi' ? fx.nameHi : fx.nameEn}
                                    </option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <div className="flex justify-between text-[11px] text-slate-400 mb-1">
                                  <span>{t(lang, 'layerIntensity')}</span>
                                  <span className="font-mono tabular-nums text-fuchsia-400">
                                    {selectedClip.effectIntensity ?? 75}%
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={0}
                                  max={100}
                                  value={selectedClip.effectIntensity ?? 75}
                                  onChange={(e) =>
                                    updateSelectedClip({
                                      effectIntensity: Number(e.target.value),
                                    })
                                  }
                                  className="w-full accent-fuchsia-500"
                                />
                              </div>
                            </div>
                          </div>
                        )}

                        {/* 13 Non-Destructive Adjustment Sliders */}
                        <div className="space-y-2.5 pt-1">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-cyan-300">
                              {lang === 'hi'
                                ? 'नॉन-डिस्ट्रक्टिव कलर और टोन कंट्रोल्स'
                                : 'Non-Destructive Color & Tone Parameters'}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateSelectedClip({ adjustments: { ...DEFAULT_ADJUSTMENTS } })
                              }
                              className="text-[11px] text-amber-400 hover:underline"
                            >
                              {t(lang, 'resetAdjustments')}
                            </button>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2.5">
                            {(
                              [
                                { key: 'brightness', i18n: 'brightness', min: -50, max: 50 },
                                { key: 'contrast', i18n: 'contrast', min: -50, max: 50 },
                                { key: 'saturation', i18n: 'saturation', min: -50, max: 50 },
                                { key: 'exposure', i18n: 'exposure', min: -50, max: 50 },
                                { key: 'highlights', i18n: 'highlights', min: -50, max: 50 },
                                { key: 'shadows', i18n: 'shadows', min: -50, max: 50 },
                                { key: 'temperature', i18n: 'temperature', min: -50, max: 50 },
                                { key: 'tint', i18n: 'tint', min: -50, max: 50 },
                                { key: 'hue', i18n: 'hue', min: -180, max: 180 },
                                { key: 'blur', i18n: 'blur', min: 0, max: 50 },
                                { key: 'vignette', i18n: 'vignette', min: 0, max: 100 },
                                { key: 'grain', i18n: 'grain', min: 0, max: 100 },
                                { key: 'sharpen', i18n: 'sharpen', min: 0, max: 100 },
                              ] as const
                            ).map((sl) => (
                              <div key={sl.key} className="space-y-0.5">
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-slate-300 truncate">
                                    {t(lang, sl.i18n)}
                                  </span>
                                  <span className="font-mono tabular-nums text-cyan-400">
                                    {selectedClip.adjustments[sl.key] ?? 0}
                                  </span>
                                </div>
                                <input
                                  type="range"
                                  min={sl.min}
                                  max={sl.max}
                                  value={selectedClip.adjustments[sl.key] ?? 0}
                                  onChange={(e) =>
                                    updateSelectedClip({
                                      adjustments: {
                                        ...selectedClip.adjustments,
                                        [sl.key]: Number(e.target.value),
                                      },
                                    })
                                  }
                                  className="w-full accent-cyan-400"
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">
                        टाइमलाइन से कोई एडजस्टमेंट लेयर, इफेक्ट लेयर या क्लिप चुनें।
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

                {/* ========================================================= */}
                {/* TAB 2: TRENDING EFFECTS & TRANSITIONS LIBRARY             */}
                {/* ========================================================= */}
                {activeTool === 'effects' && (
                  <div className="space-y-4">
                    {/* Section: Effects & Transitions */}
                    <div className="space-y-1">
                      <button
                        type="button"
                        onClick={() => toggleAccordion('effects-library')}
                        className="flex items-center justify-between w-full py-2 px-3 rounded-lg bg-slate-900/80 border border-slate-800 hover:bg-slate-800 text-left transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-bold text-slate-100">
                            {lang === 'hi'
                              ? 'ट्रेंडिंग इफेक्ट्स और ट्रांज़िशन लाइब्रेरी'
                              : 'Effects & Transitions Library'}
                          </h2>
                          <p className="text-[11px] text-slate-400">{t(lang, 'dragHint')}</p>
                        </div>
                        {accordionOpen === 'effects-library' ? (
                          <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                        ) : (
                          <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                        )}
                      </button>
                      {accordionOpen === 'effects-library' && (
                      <button
                        type="button"
                        onClick={() => setShowTrendFindings((s) => !s)}
                        className="px-2.5 py-1 rounded bg-amber-500/15 border border-amber-500/40 text-amber-300 text-[11px] font-medium shrink-0"
                      >
                        {showTrendFindings ? 'Hide Research' : 'Search Trends'}
                      </button>
                      )}
                    </div>

                    {/* Google Search Findings Summary Box */}
                    {showTrendFindings && (
                      <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/40 space-y-2 text-xs">
                        <div className="font-semibold text-amber-400">
                          {t(lang, 'trendingResearchTitle')}
                        </div>
                        {TRENDING_SEARCH_FINDINGS.map((tf, i) => (
                          <div key={i} className="border-t border-slate-800/80 pt-1.5">
                            <div className="font-semibold text-slate-200">
                              {lang === 'hi' ? tf.trendHi : tf.trendEn}
                            </div>
                            <div className="text-[11px] text-slate-400">{tf.findingEn}</div>
                            <div className="text-[11px] text-emerald-400">{tf.builtAs}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Search Bar */}
                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={effectSearch}
                        onChange={(e) => setEffectSearch(e.target.value)}
                        placeholder={t(lang, 'searchEffectsPlaceholder')}
                        className="w-full pl-8 pr-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100 focus:outline-none focus:border-amber-500"
                      />
                    </div>

                    {/* Category Filter Buttons */}
                    <div className="flex items-center gap-1 overflow-x-auto pb-1">
                      {(
                        [
                          { id: 'All', label: t(lang, 'catAll') },
                          { id: 'Trending', label: t(lang, 'catTrending') },
                          { id: 'Glitch & Digital', label: t(lang, 'catGlitch') },
                          { id: 'Motion & Velocity', label: t(lang, 'catMotion') },
                          { id: 'Optical & Light', label: t(lang, 'catOptical') },
                          { id: 'Transitions', label: t(lang, 'catTransitions') },
                        ] as const
                      ).map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setEffectCategory(cat.id)}
                          className={`px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap shrink-0 transition-colors ${
                            effectCategory === cat.id
                              ? 'bg-amber-500 text-slate-950 font-semibold'
                              : 'bg-slate-900 text-slate-400 hover:text-slate-200'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>

                    {/* Effects Grid (Draggable onto Timeline OR 1-Click Create FX Layer / Apply) */}
                    {filteredEffects.length > 0 && (
                      <div className="space-y-2">
                        <div className="text-xs font-semibold text-slate-300">
                          Original Procedural Effects ({filteredEffects.length})
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {filteredEffects.map((fx) => (
                            <div
                              key={fx.id}
                              draggable
                              onDragStart={(e) => {
                                e.dataTransfer.setData(
                                  'application/clipnova-item',
                                  JSON.stringify({ kind: 'effect', id: fx.id })
                                );
                              }}
                              className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 flex flex-col justify-between gap-2 cursor-grab active:cursor-grabbing"
                            >
                              <div className="flex items-start gap-2.5">
                                <div
                                  style={{ backgroundColor: `${fx.accentColor}25`, borderColor: fx.accentColor }}
                                  className="w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 font-mono text-[10px] font-bold text-slate-100"
                                >
                                  FX
                                </div>
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-slate-100 truncate">
                                    {lang === 'hi' ? fx.nameHi : fx.nameEn}
                                  </div>
                                  <div className="text-[10px] text-slate-400 line-clamp-1">
                                    {lang === 'hi' ? fx.descHi : fx.descEn}
                                  </div>
                                </div>
                              </div>

                              <div className="flex items-center gap-1.5 pt-1">
                                <button
                                  type="button"
                                  onClick={() => handleCreateEffectLayer(fx.id, playheadTime)}
                                  className="flex-1 py-1 px-2 rounded bg-fuchsia-500/20 hover:bg-fuchsia-500/30 border border-fuchsia-500/40 text-fuchsia-200 text-[10px] font-semibold"
                                >
                                  + FX Layer
                                </button>
                                <button
                                  type="button"
                                  disabled={!selectedClip}
                                  onClick={() =>
                                    updateSelectedClip({
                                      effect: fx.id,
                                      effectIntensity: fx.defaultIntensity,
                                    })
                                  }
                                  className="flex-1 py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 text-[10px] font-medium"
                                >
                                  On Clip
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Transitions Grid */}
                    {filteredTransitions.length > 0 && (
                      <div className="space-y-2 pt-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-300">
                            Transitions ({filteredTransitions.length})
                          </span>
                          {selectedClip && (
                            <div className="flex items-center gap-2 text-[11px] text-slate-400">
                              <span>Duration: {selectedClip.transitionDuration}s</span>
                              <input
                                type="range"
                                min={0.2}
                                max={1.5}
                                step={0.1}
                                value={selectedClip.transitionDuration}
                                onChange={(e) =>
                                  updateSelectedClip({
                                    transitionDuration: Number(e.target.value),
                                  })
                                }
                                className="w-16 accent-amber-500"
                              />
                            </div>
                          )}
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          {filteredTransitions.map((tr) => {
                            const active = selectedClip?.transitionIn === tr.id;
                            return (
                              <button
                                key={tr.id}
                                type="button"
                                draggable
                                onDragStart={(e) => {
                                  e.dataTransfer.setData(
                                    'application/clipnova-item',
                                    JSON.stringify({ kind: 'transition', id: tr.id })
                                  );
                                }}
                                onClick={() =>
                                  updateSelectedClip({
                                    transitionIn: tr.id,
                                    transitionDuration: tr.defaultDuration || 0.5,
                                  })
                                }
                                className={`p-2.5 rounded-lg border text-left transition-colors ${
                                  active
                                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                                    : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                                }`}
                              >
                                <div className="text-xs font-semibold">
                                  {lang === 'hi' ? tr.nameHi : tr.nameEn}
                                </div>
                                <div className="text-[10px] text-slate-400 truncate">
                                  {lang === 'hi' ? tr.descHi : tr.descEn}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* ========================================================= */}
                {/* TAB 3: MEDIA & GALLERY IMPORT                             */}
                {/* ========================================================= */}
                {activeTool === 'media' && (
                  <div className="space-y-5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-100">
                          Media Library & PIP Overlay
                        </h2>
                        <p className="text-xs text-slate-400">
                          गैलरी से वीडियो/फोटो चुनें या बिल्ट-इन 60FPS क्लिप्स जोड़ें।
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="min-h-[38px] px-3.5 py-2 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5 whitespace-nowrap shrink-0"
                      >
                        <Upload className="w-3.5 h-3.5" />
                        <span>Import Media</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-2.5">
                      {STARTER_MEDIA_LIBRARY.map((item) => (
                        <div
                          key={item.id}
                          className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-100 truncate">
                              {lang === 'hi' ? item.titleHi : item.title}
                            </div>
                            <div className="text-[11px] text-slate-400 truncate font-mono tabular-nums">
                              {item.category} · {item.duration}s
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleAddStarterClip(item, 'video')}
                              className="min-h-[34px] px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 flex items-center gap-1 whitespace-nowrap"
                            >
                              <Plus className="w-3 h-3 text-amber-400" />
                              <span>+ Main</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => handleAddStarterClip(item, 'overlay')}
                              className="min-h-[34px] px-2.5 py-1 rounded bg-sky-950/70 hover:bg-sky-900/80 border border-sky-500/30 text-xs font-medium text-sky-200 flex items-center gap-1 whitespace-nowrap"
                            >
                              <Layers className="w-3 h-3" />
                              <span>+ PIP</span>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Imported Media - user's own gallery imports */}
                    {project.clips
                      .filter((c) => c.sourceType === 'uploaded-video' || c.sourceType === 'uploaded-image')
                      .length > 0 && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">
                            {lang === 'hi' ? 'इम्पोर्ट किया गया मीडिया' : 'Imported Media'}
                          </h3>
                          <p className="text-[10px] text-slate-500">
                            {lang === 'hi' ? 'गैलरी से इम्पोर्ट की गई वीडियो और फ़ोटो' : 'Videos and photos imported from your gallery'}
                          </p>
                        </div>
                        <div className="grid grid-cols-1 gap-2.5">
                          {project.clips
                            .filter((c) => c.sourceType === 'uploaded-video' || c.sourceType === 'uploaded-image')
                            .map((item) => (
                              <div
                                key={item.id}
                                className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-3"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-slate-100 truncate">
                                    {item.title}
                                  </div>
                                  <div className="text-[11px] text-slate-400 truncate font-mono tabular-nums">
                                    {item.sourceType} · {item.duration}s
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setSelectedClipId(item.id);
                                      setActiveTool('layers');
                                    }}
                                    className="min-h-[34px] px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 flex items-center gap-1 whitespace-nowrap"
                                  >
                                    <Play className="w-3 h-3 text-amber-400" />{' '}
                                    <span>{lang === 'hi' ? 'प्ले करें' : 'Play'}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const existingOnTrack = project.clips.filter(
                                        (c) => c.trackType === item.trackType
                                      );
                                      const startAt = existingOnTrack.reduce(
                                        (max, c) => Math.max(max, c.startTime + c.duration),
                                        0
                                      );
                                      updateProjectWithHistory((prev) => ({
                                        ...prev,
                                        clips: [
                                          ...prev.clips,
                                          {
                                            ...item,
                                            id: `clip-${Date.now()}`,
                                            startTime: Number(startAt.toFixed(2)),
                                          },
                                        ],
                                      }));
                                      setSelectedClipId(item.id);
                                    }}
                                    className="min-h-[34px] px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-medium flex items-center gap-1 whitespace-nowrap"
                                  >
                                    <Plus className="w-3 h-3" />
                                    <span>+ Main</span>
                                  </button>
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}

                  </div>
                )}

                {/* ========================================================= */}
                {/* TAB 4: TEXT, DEVANAGARI CAPTIONS & STICKERS               */}
                {/* ========================================================= */}
                {activeTool === 'text' && (
                  <div className="space-y-5">
                    <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-2.5">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-400">
                        <Subtitles className="w-4 h-4" />
                        <span>AI Auto-Captions (वर्ड-बाय-वर्ड कराओके हाइलाइट)</span>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <button
                          type="button"
                          onClick={() => handleGenerateAutoCaptions('hindi')}
                          className="min-h-[36px] px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100"
                        >
                          हिंदी कैप्शन
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateAutoCaptions('hinglish')}
                          className="min-h-[36px] px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100"
                        >
                          Hinglish
                        </button>
                        <button
                          type="button"
                          onClick={() => handleGenerateAutoCaptions('english')}
                          className="min-h-[36px] px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100"
                        >
                          English
                        </button>
                      </div>
                    </div>

                    {selectedClip && selectedClip.trackType === 'text' && (
                      <div className="p-3.5 rounded-lg bg-slate-900 border border-amber-500/40 space-y-3">
                        <div className="text-xs font-semibold text-amber-400">
                          Edit Selected Text / Caption
                        </div>
                        <input
                          type="text"
                          value={selectedClip.textContent || ''}
                          onChange={(e) =>
                            updateSelectedClip({
                              textContent: e.target.value,
                              title: e.target.value,
                            })
                          }
                          className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-sm text-slate-100"
                        />
                        <div className="grid grid-cols-2 gap-2.5">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Font Family
                            </label>
                            <select
                              value={selectedClip.fontFamily || 'Noto Sans Devanagari'}
                              onChange={(e) => updateSelectedClip({ fontFamily: e.target.value })}
                              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                            >
                              {FONT_FAMILIES.map((f) => (
                                <option key={f.id} value={f.id}>
                                  {f.label}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Animation
                            </label>
                            <select
                              value={selectedClip.textAnimation || 'none'}
                              onChange={(e) =>
                                updateSelectedClip({
                                  textAnimation: e.target.value as TextAnimationType,
                                })
                              }
                              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                            >
                              <option value="karaoke-highlight">Karaoke Word Highlight</option>
                              <option value="pop-in">Pop In</option>
                              <option value="typewriter">Typewriter</option>
                              <option value="slide-up">Slide Up</option>
                              <option value="none">Static</option>
                            </select>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-300">
                        Devanagari & Latin Typography Presets
                      </div>
                      <div className="grid grid-cols-1 gap-2">
                        {FONT_FAMILIES.map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            onClick={() => handleAddTextOverlay(f.sample, f.id, 'pop-in')}
                            className="p-2.5 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-left flex items-center justify-between"
                          >
                            <div>
                              <div className="text-xs text-slate-400">{f.label}</div>
                              <div
                                style={{ fontFamily: f.id }}
                                className="text-sm font-bold text-slate-100 mt-0.5"
                              >
                                {f.sample}
                              </div>
                            </div>
                            <span className="text-xs text-amber-400 font-medium">+ Add</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-300">Stickers & Emojis</div>
                      <div className="grid grid-cols-4 gap-2">
                        {STICKER_PRESETS.map((stk) => (
                          <button
                            key={stk.id}
                            type="button"
                            onClick={() => handleAddSticker(stk.glyph, stk.label)}
                            className="p-2 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 flex flex-col items-center gap-1"
                          >
                            <span className="text-xl">{stk.glyph}</span>
                            <span className="text-[10px] text-slate-400 truncate w-full text-center">
                              {stk.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* TAB 5: AUDIO, TTS, VOICE CHANGER & BEAT SYNC              */}
                {/* ========================================================= */}
                {activeTool === 'audio' && (
                  <div className="space-y-4">
                    {/* Text-to-Speech (TTS) Box */}
                    <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                      <div className="text-xs font-semibold text-amber-400">
                        {t(lang, 'ttsTitle')}
                      </div>
                      <input
                        type="text"
                        value={ttsInputText}
                        onChange={(e) => setTtsInputText(e.target.value)}
                        className="w-full px-3 py-2 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                      />
                      <div className="flex items-center gap-2">
                        <select
                          value={ttsVoiceLang}
                          onChange={(e) =>
                            setTtsVoiceLang(e.target.value as 'hi-IN' | 'en-IN' | 'en-US')
                          }
                          className="px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                        >
                          <option value="hi-IN">हिन्दी (hi-IN)</option>
                          <option value="en-IN">English India (en-IN)</option>
                          <option value="en-US">English Studio (en-US)</option>
                        </select>
                        <button
                          type="button"
                          onClick={handleSynthesizeTtsToTimeline}
                          className="flex-1 min-h-[34px] px-3 py-1.5 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs"
                        >
                          {t(lang, 'ttsSpeakBtn')}
                        </button>
                      </div>
                    </div>

                    {/* Voiceover, Extract Audio & Import */}
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={handleToggleVoiceover}
                        className={`min-h-[38px] px-3 py-2 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 ${
                          isRecordingVoice
                            ? 'bg-rose-600 text-white'
                            : 'bg-slate-800 hover:bg-slate-700 text-slate-100'
                        }`}
                      >
                        {isRecordingVoice ? (
                          <MicOff className="w-3.5 h-3.5" />
                        ) : (
                          <Mic className="w-3.5 h-3.5 text-amber-400" />
                        )}
                        <span>
                          {isRecordingVoice
                            ? `${t(lang, 'stopVoiceover')} (${recordingSeconds}s)`
                            : t(lang, 'recordVoiceover')}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={handleExtractAudioFromVideo}
                        className="min-h-[38px] px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs font-medium text-slate-100 flex items-center justify-center gap-1.5"
                      >
                        <Scissors className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{t(lang, 'extractAudio')}</span>
                      </button>
                    </div>

                    {/* Voice Changer & Noise Reduction on selected audio clip */}
                    {selectedClip && selectedClip.trackType === 'audio' && (
                      <div className="p-3 rounded-xl bg-slate-900 border border-emerald-500/40 space-y-2.5">
                        <div className="text-xs font-semibold text-emerald-300">
                          Audio Inspector: {selectedClip.title}
                        </div>
                        <div className="grid grid-cols-2 gap-2.5 items-center">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              {t(lang, 'voiceChanger')}
                            </label>
                            <select
                              value={selectedClip.voiceChanger || 'none'}
                              onChange={(e) => {
                                updateSelectedClip({
                                  voiceChanger: e.target.value as VoiceChangerPreset,
                                });
                                triggerToast(
                                  'Applied Web Audio pitch & oscillator Voice Changer preset.',
                                  'वॉइस चेंजर प्रीसेट ऑडियो ट्रैक पर लागू किया गया।'
                                );
                              }}
                              className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                            >
                              <option value="none">Normal Voice</option>
                              <option value="deep-cinema">Deep Bass Narrator</option>
                              <option value="chipmunk">Helium Chipmunk</option>
                              <option value="robot-mod">Cyber Robot Mod</option>
                              <option value="echo-hall">Stadium Echo</option>
                            </select>
                          </div>

                          <label className="flex items-center gap-2 text-xs text-slate-200 cursor-pointer pt-4">
                            <input
                              type="checkbox"
                              checked={Boolean(selectedClip.noiseReduction)}
                              onChange={(e) => {
                                updateSelectedClip({ noiseReduction: e.target.checked });
                                triggerToast(
                                  'Toggled Web Audio bandpass Noise Reduction filter.',
                                  'नॉइज़ रिडक्शन ऑडियो फ़िल्टर चालू किया गया।'
                                );
                              }}
                              className="w-4 h-4 accent-emerald-500"
                            />
                            <span>{t(lang, 'noiseReduction')}</span>
                          </label>
                        </div>
                      </div>
                    )}

                    {/* Royalty-Free Library */}
                    <div className="space-y-2">
                      {ROYALTY_FREE_AUDIO.map((track) => (
                        <div
                          key={track.id}
                          className="p-3 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="text-xs font-semibold text-slate-100 truncate">
                              {lang === 'hi' ? track.titleHi : track.title}
                            </div>
                            <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                              {track.bpm} BPM · Auto Beat Markers (•)
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleAddAudioTrack(track)}
                            className="min-h-[32px] px-3 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/40 text-emerald-300 text-xs font-medium shrink-0"
                          >
                            Use
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* TAB 6: COLOR GRADING, HSL & .CUBE LUT IMPORT              */}
                {/* ========================================================= */}
                {activeTool === 'color' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h2 className="text-sm font-semibold text-slate-100">
                          {t(lang, 'toolColor')}
                        </h2>
                        <p className="text-[11px] text-slate-400">
                          Apply LUTs & filter presets directly or onto an Adjustment Layer.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => lutInputRef.current?.click()}
                        className="min-h-[34px] px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-semibold text-xs shrink-0"
                      >
                        {t(lang, 'importLut')}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {FILTER_PRESETS.map((flt) => {
                        const active = selectedClip?.filterPreset === flt.id;
                        return (
                          <button
                            key={flt.id}
                            type="button"
                            onClick={() => updateSelectedClip({ filterPreset: flt.id })}
                            className={`p-2.5 rounded-lg border text-left transition-colors ${
                              active
                                ? 'bg-amber-500/15 border-amber-500 text-amber-300'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            <div className="text-xs font-semibold">
                              {lang === 'hi' ? flt.nameHi : flt.nameEn}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* TAB 7: KEYFRAMES, CUSTOM MASKS, CHROMA KEY & BG REMOVER   */}
                {/* ========================================================= */}
                {activeTool === 'keyframes' && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold text-slate-100">
                        {t(lang, 'toolKeyframes')}
                      </h2>
                      <button
                        type="button"
                        onClick={handleAddKeyframeAtPlayhead}
                        disabled={!selectedClip}
                        className="min-h-[34px] px-3 py-1 rounded bg-amber-500 text-slate-950 font-semibold text-xs"
                      >
                        {t(lang, 'btnAddKeyframe')}
                      </button>
                    </div>

                    {selectedClip ? (
                      <div className="space-y-4">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Scale ({selectedClip.scale.toFixed(2)}x)
                            </label>
                            <input
                              type="range"
                              min={0.25}
                              max={2.5}
                              step={0.05}
                              value={selectedClip.scale}
                              onChange={(e) =>
                                updateSelectedClip({ scale: Number(e.target.value) })
                              }
                              className="w-full accent-amber-500"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-400 mb-1">
                              Position X / Y ({selectedClip.posX}%, {selectedClip.posY}%)
                            </label>
                            <div className="flex gap-1">
                              <input
                                type="range"
                                min={-80}
                                max={80}
                                value={selectedClip.posX}
                                onChange={(e) =>
                                  updateSelectedClip({ posX: Number(e.target.value) })
                                }
                                className="w-1/2 accent-amber-500"
                              />
                              <input
                                type="range"
                                min={-80}
                                max={80}
                                value={selectedClip.posY}
                                onChange={(e) =>
                                  updateSelectedClip({ posY: Number(e.target.value) })
                                }
                                className="w-1/2 accent-amber-500"
                              />
                            </div>
                          </div>
                        </div>

                        {/* Masks + Interactive Custom Draw Mask */}
                        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-200">
                              {t(lang, 'maskShape')}
                            </span>
                            <label className="flex items-center gap-1.5 text-xs text-slate-300 cursor-pointer">
                              <input
                                type="checkbox"
                                checked={selectedClip.maskInvert}
                                onChange={(e) =>
                                  updateSelectedClip({ maskInvert: e.target.checked })
                                }
                                className="accent-amber-500"
                              />
                              <span>{t(lang, 'maskInvert')}</span>
                            </label>
                          </div>

                          <div className="grid grid-cols-3 gap-1.5">
                            {(
                              [
                                'none',
                                'linear',
                                'circle',
                                'rectangle',
                                'heart',
                                'star',
                                'custom-draw',
                              ] as MaskShapeType[]
                            ).map((shape) => (
                              <button
                                key={shape}
                                type="button"
                                onClick={() => {
                                  updateSelectedClip({ maskShape: shape });
                                  setIsDrawingCustomMask(shape === 'custom-draw');
                                  if (shape === 'custom-draw') {
                                    triggerToast(
                                      'Click 3 or more points directly on the video preview canvas to draw your custom polygon mask!',
                                      'कस्टम मास्क बनाने के लिए वीडियो प्रीव्यू कैनवस पर 3 या अधिक पॉइंट्स क्लिक करें!'
                                    );
                                  }
                                }}
                                className={`py-1.5 px-2 rounded border text-[11px] capitalize ${
                                  selectedClip.maskShape === shape
                                    ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-semibold'
                                    : 'bg-slate-950 border-slate-800 text-slate-300'
                                }`}
                              >
                                {shape}
                              </button>
                            ))}
                          </div>

                          {selectedClip.maskShape === 'custom-draw' && (
                            <div className="flex items-center justify-between pt-1">
                              <span className="text-[11px] text-amber-400">
                                Points: {selectedClip.customMaskPoints?.length || 0} (Click on
                                preview)
                              </span>
                              <button
                                type="button"
                                onClick={() => updateSelectedClip({ customMaskPoints: [] })}
                                className="text-[11px] text-rose-400 hover:underline"
                              >
                                {t(lang, 'clearCustomMask')}
                              </button>
                            </div>
                          )}
                        </div>

                        {/* AI Background Remover & Chroma Key */}
                        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5">
                          <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                            <span>{t(lang, 'bgRemover')}</span>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedClip.bgRemovalEnabled)}
                              onChange={(e) => {
                                updateSelectedClip({ bgRemovalEnabled: e.target.checked });
                                triggerToast(
                                  'Best-Effort Demo: In-browser foreground subject matte enabled.',
                                  'बेस्ट-एफर्ट डेमो: इन-ब्राउज़र फोरग्राउंड सब्जेक्ट बैकग्राउंड रिमूवर चालू किया गया।'
                                );
                              }}
                              className="w-4 h-4 accent-amber-500"
                            />
                          </label>

                          <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                            <span>{t(lang, 'chromaKey')}</span>
                            <input
                              type="checkbox"
                              checked={selectedClip.chromaKeyEnabled}
                              onChange={(e) => {
                                updateSelectedClip({ chromaKeyEnabled: e.target.checked });
                                triggerToast(
                                  'Best-Effort Demo: Chroma Key green screen color tolerance active.',
                                  'बेस्ट-एफर्ट डेमो: ग्रीन स्क्रीन क्रोमा की चालू किया गया।'
                                );
                              }}
                              className="w-4 h-4 accent-emerald-500"
                            />
                          </label>

                          {/* Motion Tracking for Text / Stickers */}
                          {(selectedClip.trackType === 'text' ||
                            selectedClip.trackType === 'sticker') && (
                            <div className="pt-1">
                              <label className="block text-[11px] text-slate-400 mb-1">
                                {t(lang, 'motionTrack')}
                              </label>
                              <select
                                value={selectedClip.motionTrackTargetId || ''}
                                onChange={(e) => {
                                  updateSelectedClip({
                                    motionTrackTargetId: e.target.value || undefined,
                                  });
                                  triggerToast(
                                    'Best-Effort Motion Tracking: Text/Sticker now follows target clip keyframe trajectory!',
                                    'मोशन ट्रैकिंग चालू: टेक्स्ट/स्टिकर अब चुनी गई वीडियो क्लिप के कीफ्रेम पथ का अनुसरण करेगा!'
                                  );
                                }}
                                className="w-full px-2.5 py-1.5 rounded bg-slate-950 border border-slate-800 text-xs text-slate-100"
                              >
                                <option value="">None (Independent Position)</option>
                                {project.clips
                                  .filter(
                                    (c) => c.trackType === 'video' || c.trackType === 'overlay'
                                  )
                                  .map((vc) => (
                                    <option key={vc.id} value={vc.id}>
                                      Follow: {vc.title}
                                    </option>
                                  ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="text-xs text-slate-400">Select a clip on the timeline.</div>
                    )}
                  </div>
                )}

                {/* ========================================================= */}
                {/* TAB 8: SPEED CURVES, STABILIZATION & ASPECT RATIO         */}
                {/* ========================================================= */}
                {activeTool === 'speed' && (
                  <div className="space-y-4">
                    {selectedClip && (
                      <div className="p-3.5 rounded-lg bg-slate-900 border border-slate-800 space-y-3">
                        <div className="flex justify-between text-xs">
                          <span className="text-slate-300">Clip Speed</span>
                          <span className="font-mono tabular-nums text-amber-400 font-semibold">
                            {selectedClip.speed}x
                          </span>
                        </div>
                        <input
                          type="range"
                          min={0.2}
                          max={4.0}
                          step={0.1}
                          value={selectedClip.speed}
                          onChange={(e) =>
                            updateSelectedClip({ speed: Number(e.target.value) })
                          }
                          className="w-full accent-amber-500"
                        />

                        <div className="grid grid-cols-2 gap-2">
                          {(
                            [
                              { id: 'normal', label: 'Linear Normal' },
                              { id: 'montage', label: 'Velocity Montage' },
                              { id: 'hero-bullet', label: 'Hero Slow-Mo' },
                              { id: 'jump-cut', label: 'Jump Velocity' },
                            ] as { id: SpeedCurvePreset; label: string }[]
                          ).map((preset) => (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => updateSelectedClip({ speedCurve: preset.id })}
                              className={`py-1.5 px-2 rounded border text-xs ${
                                selectedClip.speedCurve === preset.id
                                  ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                                  : 'bg-slate-950 border-slate-800 text-slate-300'
                              }`}
                            >
                              {preset.label}
                            </button>
                          ))}
                        </div>

                        <label className="flex items-center justify-between text-xs text-slate-200 cursor-pointer pt-1">
                          <span>{t(lang, 'stabilization')}</span>
                          <input
                            type="checkbox"
                            checked={Boolean(selectedClip.stabilizationEnabled)}
                            onChange={(e) => {
                              updateSelectedClip({ stabilizationEnabled: e.target.checked });
                              triggerToast(
                                'Best-Effort Optical Stabilization: Applied 6% horizon buffer crop.',
                                'वीडियो स्टेबलाइज़ेशन चालू: 6% ऑप्टिकल क्रॉप बफर लागू किया गया।'
                              );
                            }}
                            className="w-4 h-4 accent-amber-500"
                          />
                        </label>

                        <div className="flex items-center gap-2 pt-1">
                          <button
                            type="button"
                            onClick={() =>
                              updateSelectedClip({
                                rotation: (selectedClip.rotation + 90) % 360,
                              })
                            }
                            className="flex-1 min-h-[34px] py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center gap-1"
                          >
                            <RotateCw className="w-3.5 h-3.5" />
                            <span>90°</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedClip({ flipH: !selectedClip.flipH })}
                            className="flex-1 min-h-[34px] py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center gap-1"
                          >
                            <FlipHorizontal className="w-3.5 h-3.5" />
                            <span>Mirror H</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => updateSelectedClip({ flipV: !selectedClip.flipV })}
                            className="flex-1 min-h-[34px] py-1 px-2 rounded bg-slate-800 hover:bg-slate-700 text-xs flex items-center justify-center gap-1"
                          >
                            <FlipVertical className="w-3.5 h-3.5" />
                            <span>Flip V</span>
                          </button>
                        </div>
                      </div>
                    )}

                    <div className="space-y-2">
                      <div className="text-xs font-medium text-slate-300">Aspect Ratio</div>
                      <div className="grid grid-cols-3 gap-2">
                        {ASPECT_RATIOS.map((ar) => (
                          <button
                            key={ar}
                            type="button"
                            onClick={() =>
                              updateProjectWithHistory((prev) => ({ ...prev, aspectRatio: ar }))
                            }
                            className={`py-2 px-3 rounded-lg border font-mono tabular-nums text-xs font-medium ${
                              project.aspectRatio === ar
                                ? 'bg-amber-500 text-slate-950 border-amber-400 font-semibold'
                                : 'bg-slate-900 border-slate-800 text-slate-300 hover:bg-slate-800'
                            }`}
                          >
                            {ar}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Right / Center Column (7 cols): Live Preview Canvas + Transport Controls (order-1 on portrait phone) */}
            <div className="order-1 lg:order-2 lg:col-span-7 flex flex-col items-center justify-between p-3 sm:p-4 bg-[#070A10] relative overflow-hidden">
              <div className="w-full flex items-center justify-between gap-4 text-xs text-slate-400 pb-2">
                <div className="flex items-center gap-2 truncate">
                  <span className="font-semibold text-slate-200 truncate">{project.name}</span>
                  <span>·</span>
                  <span className="font-mono tabular-nums">{project.aspectRatio}</span>
                  <span>·</span>
                  <span className="font-mono tabular-nums">{project.resolution}</span>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setShowChecklistModal(true)}
                    className="px-2.5 py-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs"
                  >
                    {t(lang, 'featureChecklistBtn')}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      updateProjectWithHistory((prev) => ({
                        ...prev,
                        isProUnlocked: !prev.isProUnlocked,
                        watermarkEnabled: prev.isProUnlocked,
                      }))
                    }
                    className={`px-2.5 py-1 rounded text-xs font-medium transition-colors whitespace-nowrap ${
                      project.isProUnlocked
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                    }`}
                  >
                    {project.isProUnlocked ? 'Pro Active (No Watermark)' : 'Free Mode'}
                  </button>
                </div>
              </div>

              {/* Center HTML5 Video Compositor Canvas */}
              <div className="flex-1 flex items-center justify-center w-full my-1 overflow-hidden">
                <div className="relative max-h-[325px] sm:max-h-[375px] flex items-center justify-center rounded-xl overflow-hidden border border-slate-800 shadow-2xl bg-black">
                  <canvas
                    ref={canvasRef}
                    onPointerDown={handleCanvasPointerDown}
                    className={`max-h-[320px] sm:max-h-[370px] w-auto object-contain ${
                      isDrawingCustomMask ? 'cursor-crosshair' : ''
                    }`}
                  />
                </div>
              </div>

              {/* Playback Transport Bar */}
              <div className="w-full max-w-full flex flex-wrap items-center justify-between gap-4 px-3 py-2 rounded-xl bg-[#0F1522] border border-slate-800/90 min-w-0">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setPlayheadTime(0);
                    }}
                    className="p-2 rounded-lg hover:bg-slate-800 text-slate-300"
                    title="Jump to Start"
                  >
                    <SkipBack className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsPlaying((p) => !p)}
                    className="min-h-[38px] min-w-[38px] rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center transition-colors"
                    title="Play / Pause (Space)"
                  >
                    {isPlaying ? (
                      <Pause className="w-4 h-4 fill-current" />
                    ) : (
                      <Play className="w-4 h-4 fill-current ml-0.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setIsPlaying(false);
                      setPlayheadTime(totalDuration);
                    }}
                    className="p-2 rounded-lg hover:bg-slate-800 text-slate-300"
                    title="Jump to End"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                </div>

                <input
                  type="range"
                  min={0}
                  max={totalDuration}
                  step={0.03}
                  value={playheadTime}
                  onChange={(e) => {
                    setIsPlaying(false);
                    setPlayheadTime(Number(e.target.value));
                  }}
                  className="flex-1 accent-amber-500 cursor-pointer"
                  aria-label="Playhead Scrubber"
                />

                <div className="font-mono tabular-nums text-xs text-slate-300 shrink-0 min-w-0 truncate">
                  {playheadTime.toFixed(2)}s / {totalDuration.toFixed(2)}s
                </div>
              </div>
            </div>
          </div>

          {/* Bottom 7-Track Interactive Timeline */}
          <TimelinePanel
            lang={lang}
            clips={project.clips}
            selectedClipId={selectedClipId}
            playheadTime={playheadTime}
            totalDuration={totalDuration}
            zoomPxPerSec={zoomPxPerSec}
            magneticSnap={magneticSnap}
            canUndo={historyPast.length > 0}
            canRedo={historyFuture.length > 0}
            onSelectClip={setSelectedClipId}
            onSeek={(tVal) => {
              setIsPlaying(false);
              setPlayheadTime(tVal);
            }}
            onZoomChange={setZoomPxPerSec}
            onToggleMagneticSnap={() => setMagneticSnap((m) => !m)}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onCreateAdjustmentLayer={handleCreateAdjustmentLayer}
            onCreateEffectLayer={handleCreateEffectLayer}
            onApplyTransitionDrop={(clipId, transition) => {
              updateProjectWithHistory((prev) => ({
                ...prev,
                clips: prev.clips.map((c) =>
                  c.id === clipId ? { ...c, transitionIn: transition } : c
                ),
              }));
              triggerToast(
                `Applied "${transition}" transition to clip.`,
                `क्लिप पर "${transition}" ट्रांज़िशन लगाया गया।`
              );
            }}
            onAutoBeatCut={handleAutoBeatCut}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onDuplicateSelected={handleDuplicateSelected}
            onDeleteSelected={handleDeleteSelected}
            onToggleReverseSelected={handleToggleReverseSelected}
            onToggleFreezeSelected={handleToggleFreezeSelected}
            onAddKeyframeAtPlayhead={handleAddKeyframeAtPlayhead}
            onUpdateClipTiming={handleUpdateClipTiming}
            onToggleTrackMute={handleToggleTrackMute}
          />
        </div>
      )}

      {/* FEATURE IMPLEMENTATION CHECKLIST MODAL */}
      {showChecklistModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto bg-[#0F1522] border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-lg font-bold text-slate-100">
                ClipNova Build Verification Checklist
              </h2>
              <button
                type="button"
                onClick={() => setShowChecklistModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4 text-xs">
              <div>
                <h3 className="font-bold text-emerald-400 mb-2">
                  Fully Working in Browser ({FEATURE_IMPLEMENTATION_CHECKLIST.fullyWorking.length})
                </h3>
                <ul className="space-y-1.5 text-slate-200">
                  {FEATURE_IMPLEMENTATION_CHECKLIST.fullyWorking.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-amber-400 mb-2">
                  Partial / Best-Effort Browser Implementations (
                  {FEATURE_IMPLEMENTATION_CHECKLIST.partialBestEffort.length})
                </h3>
                <ul className="space-y-1.5 text-slate-300">
                  {FEATURE_IMPLEMENTATION_CHECKLIST.partialBestEffort.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>

              <div>
                <h3 className="font-bold text-rose-400 mb-2">
                  Native Mobile / Cloud GPU Only (
                  {FEATURE_IMPLEMENTATION_CHECKLIST.missingNativeOnly.length})
                </h3>
                <ul className="space-y-1.5 text-slate-400">
                  {FEATURE_IMPLEMENTATION_CHECKLIST.missingNativeOnly.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* EXPORT VIDEO MODAL */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0F1522] border border-slate-800 rounded-2xl p-6 space-y-5 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-lg font-bold text-slate-100">
                  {t(lang, 'exportModalTitle')}
                </h2>
                <p className="text-xs text-slate-400">{t(lang, 'exportModalSub')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowExportModal(false)}
                className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Resolution
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {(['480p', '720p', '1080p', '2K', '4K'] as const).map((res) => (
                    <button
                      key={res}
                      type="button"
                      onClick={() =>
                        updateProjectWithHistory((prev) => ({
                          ...prev,
                          resolution: res,
                          isProUnlocked: res === '4K' || res === '2K' ? true : prev.isProUnlocked,
                        }))
                      }
                      className={`py-2 rounded-lg border font-mono tabular-nums text-xs font-medium ${
                        project.resolution === res
                          ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1.5">
                  Frame Rate
                </label>
                <div className="grid grid-cols-5 gap-2">
                  {([24, 25, 30, 50, 60] as const).map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      onClick={() => updateProjectWithHistory((prev) => ({ ...prev, fps }))}
                      className={`py-2 rounded-lg border font-mono tabular-nums text-xs font-medium ${
                        project.fps === fps
                          ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      {fps}fps
                    </button>
                  ))}
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                <div className="text-xs font-semibold text-slate-200">
                  {t(lang, 'proWatermarkToggle')}
                </div>
                <input
                  type="checkbox"
                  checked={project.isProUnlocked}
                  onChange={(e) =>
                    updateProjectWithHistory((prev) => ({
                      ...prev,
                      isProUnlocked: e.target.checked,
                      watermarkEnabled: !e.target.checked,
                    }))
                  }
                  className="w-4 h-4 accent-amber-500 cursor-pointer"
                />
              </div>

              {(isExportingVideo || exportProgress > 0) && (
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300">
                      {exportProgress === 100
                        ? 'Video Ready!'
                        : 'Rendering Non-Destructive Layers & Shaders...'}
                    </span>
                    <span className="font-mono tabular-nums text-amber-400 font-semibold">
                      {exportProgress}%
                    </span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-slate-900 overflow-hidden">
                    <div
                      style={{ width: `${exportProgress}%` }}
                      className="h-full bg-amber-500 transition-all duration-150"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2.5 pt-2">
                {!exportedVideoUrl ? (
                  <button
                    type="button"
                    disabled={isExportingVideo}
                    onClick={handleStartVideoExport}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {isExportingVideo
                        ? 'Rendering...'
                        : `${t(lang, 'startExportBtn')} (${project.resolution} ${project.fps}fps)`}
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      const fileName = `${project.name.replace(/\s+/g, '_')}_${project.resolution}.webm`;
                      if (exportedVideoBlob) {
                        const res = await saveAndShareFileOnDevice(
                          exportedVideoBlob,
                          fileName,
                          `ClipNova Video Export (${project.resolution})`
                        );
                        if (res.savedPath) {
                          triggerToast(
                            isAndroidNativeApp()
                              ? `Saved to Android device storage (${fileName})`
                              : `Downloaded ${fileName}`,
                            isAndroidNativeApp()
                              ? `फ़ोन स्टोरेज में वीडियो सेव किया गया (${fileName})`
                              : `वीडियो डाउनलोड किया गया (${fileName})`
                          );
                        }
                      } else if (exportedVideoUrl) {
                        const a = document.createElement('a');
                        a.href = exportedVideoUrl;
                        a.download = fileName;
                        a.click();
                      }
                    }}
                    className="w-full min-h-[44px] py-2.5 px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    <span>{t(lang, 'downloadVideoBtn')}</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => downloadProjectJson(project)}
                  className="w-full min-h-[40px] py-2 px-4 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-200 font-medium text-xs"
                >
                  {t(lang, 'exportJsonBtn')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
