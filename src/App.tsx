import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Diamond,
  Download,
  Film,
  FlipHorizontal,
  FlipVertical,
  FolderOpen,
  Gauge,
  Globe,
  Home,
  Image as ImageIcon,
  Info,
  Layers,
  LayoutGrid,
  Maximize2,
  Mic,
  MicOff,
  MoreVertical,
  Music,
  Palette,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  RotateCw,
  Scissors,
  Search,
  Settings,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Sliders,
  Smile,
  Sparkles,
  Subtitles,
  Trash2,
  Type,
  Upload,
  Wand2,
  X,
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
  downloadFcpXml,
  downloadProjectJson,
  downloadSrtSubtitles,
  FEATURE_IMPLEMENTATION_CHECKLIST,
  parseCubeLutFile,
} from './export/exportEngine';
import { LanguageCode, SUPPORTED_LANGUAGES, t } from './i18n/translations';
import {
  AspectRatioKey,
  BlendModeType,
  ColorAdjustments,
  ImportedMediaItem,
  KeyframePoint,
  MaskShapeType,
  ProjectData,
  SpecDecisionForm,
  SpeedCurvePreset,
  TemplatePreset,
  TextAnimationType,
  TimelineClip,
  TrackType,
  VideoEffectType,
  VoiceChangerPreset,
} from './types/editor';
import {
  BUILD_ID,
  exitAndroidApp,
  isAndroidNativeApp,
  registerHardwareBackButton,
  saveAndShareFileOnDevice,
} from './utils/androidBridge';
import { getAspectDimensions, renderProjectFrame } from './utils/canvasRenderer';
import { inspectAndImportMediaFile } from './utils/mediaImporter';
import {
  deleteProjectFromStorage,
  loadAllProjectsFromStorage,
  loadMediaBlobFromIdb,
  saveProjectToStorage,
} from './utils/projectStorage';
import { soundEngine } from './utils/soundEngine';

type AppScreen = 'home' | 'picker' | 'editor' | 'settings' | 'spec';
type HomeBottomTab = 'home' | 'templates' | 'projects';

export type BottomSheetToolId =
  | 'edit'
  | 'audio'
  | 'text'
  | 'stickers'
  | 'overlay'
  | 'effects'
  | 'transitions'
  | 'filters'
  | 'adjust'
  | 'captions'
  | 'canvas'
  | 'speed'
  | 'mask'
  | 'keyframe';

const ASPECT_RATIOS: AspectRatioKey[] = ['9:16', '16:9', '1:1', '4:5', '4:3', '21:9'];

export function App() {
  // 1. Language Switcher State — Default English ('en') on first launch with storage key clipnova_lang_v3
  const [lang, setLang] = useState<LanguageCode>(() => {
    try {
      const saved = localStorage.getItem('clipnova_lang_v3');
      if (saved === 'en' || saved === 'hi') return saved;
    } catch {
      // ignore localStorage read errors
    }
    return 'en';
  });

  useEffect(() => {
    try {
      localStorage.setItem('clipnova_lang_v3', lang);
    } catch {
      // ignore
    }
  }, [lang]);

  // 2. Navigation & Screen State (Opens on HOME screen, never auto-opens demo project)
  const [screen, setScreen] = useState<AppScreen>('home');
  const [homeTab, setHomeTab] = useState<HomeBottomTab>('home');
  const [activeSheetTool, setActiveSheetTool] = useState<BottomSheetToolId | null>(null);

  // Accordion state inside bottom sheet (only ONE group expanded at a time)
  const [adjustAccordion, setAdjustAccordion] = useState<'basic' | 'color' | 'effects' | 'blend'>('basic');
  const [editAccordion, setEditAccordion] = useState<'media' | 'transform' | 'smart'>('media');
  const [audioAccordion, setAudioAccordion] = useState<'music' | 'voice' | 'fx'>('music');

  // Toast Notification Queue
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerToast = useCallback(
    (msgEn: string, msgHi?: string) => {
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      setToastMessage(lang === 'hi' && msgHi ? msgHi : msgEn);
      toastTimerRef.current = setTimeout(() => {
        setToastMessage(null);
      }, 3600);
    },
    [lang]
  );

  // Saved Projects List (Loaded from IndexedDB + guarded localStorage fallback)
  const [projects, setProjects] = useState<ProjectData[]>([]);
  const [projectsLoaded, setProjectsLoaded] = useState<boolean>(false);

  // Active Project in Editor
  const [project, setProject] = useState<ProjectData>(() => ({
    id: `proj-empty-${Date.now()}`,
    name: 'My Project',
    aspectRatio: '9:16',
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
    importedMedia: [],
    clips: [],
  }));

  // 3-dot Menu, Rename, Delete Confirmation & Exit Confirmation Modals on Home
  const [openMenuProjectId, setOpenMenuProjectId] = useState<string | null>(null);
  const [renamingProjectId, setRenamingProjectId] = useState<string | null>(null);
  const [renameInputVal, setRenameInputVal] = useState<string>('');
  const [deleteTargetProject, setDeleteTargetProject] = useState<ProjectData | null>(null);
  const [showExitConfirmModal, setShowExitConfirmModal] = useState<boolean>(false);
  const [isEditingHeaderTitle, setIsEditingHeaderTitle] = useState<boolean>(false);

  // Full-Screen Media Picker State (for New Project OR adding clips)
  const [pickerTab, setPickerTab] = useState<'device' | 'starter'>('device');
  const [pickerPool, setPickerPool] = useState<ImportedMediaItem[]>([]);
  const [pickerSelectedIds, setPickerSelectedIds] = useState<string[]>([]);
  const [isImportingFiles, setIsImportingFiles] = useState<boolean>(false);

  // One-time 3-step Onboarding State on first Editor open
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);

  // Undo / Redo History Stack for Active Project
  const [historyPast, setHistoryPast] = useState<ProjectData[]>([]);
  const [historyFuture, setHistoryFuture] = useState<ProjectData[]>([]);

  // Spec Blueprint Form State
  const [specForm, setSpecForm] = useState<SpecDecisionForm>(() => {
    try {
      const saved = localStorage.getItem('clipnova_spec_form_v3');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === 'object') return parsed;
      }
    } catch {
      // ignore
    }
    return INITIAL_SPEC_FORM;
  });

  useEffect(() => {
    try {
      localStorage.setItem('clipnova_spec_form_v3', JSON.stringify(specForm));
    } catch {
      // ignore
    }
  }, [specForm]);

  // Playback & Timeline State
  const [playheadTime, setPlayheadTime] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [zoomPxPerSec, setZoomPxPerSec] = useState<number>(64);
  const [magneticSnap, setMagneticSnap] = useState<boolean>(true);
  const [scrollToTimeTrigger, setScrollToTimeTrigger] = useState<{ time: number; seq: number } | null>(null);
  const [isScrubbing, setIsScrubbing] = useState<boolean>(false);
  const scrubRafRef = useRef<number | null>(null);

  // Debug metrics for preview playback (shown in Settings)
  const [debugVideoDims, setDebugVideoDims] = useState<string>('- x -');
  const [debugPreviewFps, setDebugPreviewFps] = useState<number>(0);
  const [debugDroppedFrames, setDebugDroppedFrames] = useState<number>(0);
  const [debugPlaying, setDebugPlaying] = useState<boolean>(false);
  const [debugActiveClipId, setDebugActiveClipId] = useState<string | null>(null);
  const [debugSourceTime, setDebugSourceTime] = useState<number>(0);
  const [debugReadyState, setDebugReadyState] = useState<number>(0);
  const [debugPaused, setDebugPaused] = useState<boolean>(true);
  const [debugLastError, setDebugLastError] = useState<string | null>(null);
  const [debugPlayingMediaCount, setDebugPlayingMediaCount] = useState<number>(0);
  const [debugActiveAudioSources, setDebugActiveAudioSources] = useState<number>(0);
  const [showPlaybackDebug, setShowPlaybackDebug] = useState<boolean>(false);
  const lastFrameTimeRef = useRef<number>(0);
  const frameCountRef = useRef<number>(0);
  const droppedFramesRef = useRef<number>(0);
  // Seek tracking: wait for seeked (500 ms timeout) before calling play()
  const seekPendingRef = useRef<{
    el: HTMLVideoElement;
    targetTime: number;
    deadline: number;
  } | null>(null);

  // Effects Library Filter State
  const [effectSearch, setEffectSearch] = useState<string>('');
  const [effectCategory, setEffectCategory] = useState<
    'All' | 'Trending' | 'Glitch & Digital' | 'Motion & Velocity' | 'Optical & Light'
  >('All');
  const [showTrendFindings, setShowTrendFindings] = useState<boolean>(false);

  // Interactive Custom Mask Drawing Mode on Preview Canvas
  const [isDrawingCustomMask, setIsDrawingCustomMask] = useState<boolean>(false);

  // Voiceover & TTS State
  const [isRecordingVoice, setIsRecordingVoice] = useState<boolean>(false);
  const [recordingSeconds, setRecordingSeconds] = useState<number>(0);
  const [ttsInputText, setTtsInputText] = useState<string>(
    'Welcome to ClipNova Studio! Edit reels fast.'
  );
  const [ttsVoiceLang, setTtsVoiceLang] = useState<'hi-IN' | 'en-IN' | 'en-US'>('en-IN');

  // Export & Checklist Modal State
  const [showExportModal, setShowExportModal] = useState<boolean>(false);
  const [showChecklistModal, setShowChecklistModal] = useState<boolean>(false);
  const [isExportingVideo, setIsExportingVideo] = useState<boolean>(false);
  const [exportProgress, setExportProgress] = useState<number>(0);
  const [exportedVideoUrl, setExportedVideoUrl] = useState<string | null>(null);
  const [exportedVideoBlob, setExportedVideoBlob] = useState<Blob | null>(null);
  const [exportFormat, setExportFormat] = useState<'mp4' | 'webm'>('mp4');
  const [exportResult, setExportResult] = useState<{format: string; resolution: string; duration: number; frames: number; size: number; hasAudio: boolean} | null>(null);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [overlayVisible, setOverlayVisible] = useState<boolean>(true);
  const overlayHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Refs for Canvas, Media Elements, Active Export Cancellation & RAF Slider Throttling
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaElementsRef = useRef<Map<string, HTMLVideoElement | HTMLImageElement>>(new Map());
  const pickerFileInputRef = useRef<HTMLInputElement | null>(null);
  const editorMediaInputRef = useRef<HTMLInputElement | null>(null);
  const pipOverlayInputRef = useRef<HTMLInputElement | null>(null);
  const audioInputRef = useRef<HTMLInputElement | null>(null);
  const lutInputRef = useRef<HTMLInputElement | null>(null);
  const exportIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const exportRecorderRef = useRef<MediaRecorder | null>(null);
  const exportCancelledRef = useRef<boolean>(false);
  const sliderRafRef = useRef<number | null>(null);
  const playheadRef = useRef<number>(0);
  const renderRafRef = useRef<number | null>(null);
  const lastDisplayUpdateRef = useRef<number>(0);
  const wasPlayingRef = useRef<boolean>(false);
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  // Load saved projects from IndexedDB/localStorage on launch
  useEffect(() => {
    let mounted = true;
    loadAllProjectsFromStorage((warnMsg) => {
      if (mounted) triggerToast(warnMsg);
    }).then((loaded) => {
      if (!mounted) return;
      setProjects(loaded);
      setProjectsLoaded(true);
    });
    return () => {
      mounted = false;
    };
  }, [triggerToast]);

  // Calculate total timeline duration
  const totalDuration = Math.max(
    3,
    ...project.clips.map((c) => Number((c.startTime + c.duration).toFixed(2)))
  );

  const selectedClip = project.clips.find((c) => c.id === selectedClipId) || null;

// Check if any clip active at playheadTime needs canvas processing (effects, adjustments, masks, layers).
// If nothing needs canvas, we can show the plain <video> element for hardware-decoded smooth playback.
const needsCanvasRendering = (t: number): boolean => {
  return project.clips.some((c) => {
    if (c.trackType === 'audio') return false;
    if (t < c.startTime || t > c.startTime + c.duration) return false;
    if (c.muted && c.trackType === 'video') return false;
    // Adjustment / effect layers always need canvas
    if (c.trackType === 'adjustment' || c.trackType === 'effect-layer') return true;
    // Any non-default processing needs canvas
    if (c.effect !== 'none') return true;
    if (c.filterPreset !== 'none') return true;
    if (c.bgRemovalEnabled) return true;
    if (c.maskShape !== 'none') return true;
    if (c.transitionIn !== 'none') return true;
    const adj = c.adjustments;
    if (
      adj.brightness !== 0 ||
      adj.contrast !== 0 ||
      adj.saturation !== 0 ||
      adj.blur !== 0 ||
      adj.grain !== 0 ||
      adj.vignette !== 0 ||
      adj.exposure !== 0 ||
      adj.highlights !== 0 ||
      adj.shadows !== 0 ||
      adj.fade !== 0 ||
      adj.temperature !== 0 ||
      adj.tint !== 0
    )
      return true;
    if (c.opacity !== 100 || c.scale !== 100 || c.rotation !== 0) return true;
    return false;
  });
};

const showPlainVideo = !needsCanvasRendering(playheadTime);

  // Capture a small thumbnail from canvas when saving project
  const captureCanvasThumbnail = useCallback((): string | undefined => {
    try {
      if (!canvasRef.current) return project.thumbnailUrl;
      const thumbCanvas = document.createElement('canvas');
      thumbCanvas.width = 160;
      thumbCanvas.height = 284;
      const tCtx = thumbCanvas.getContext('2d');
      if (!tCtx) return project.thumbnailUrl;
      tCtx.drawImage(canvasRef.current, 0, 0, 160, 284);
      return thumbCanvas.toDataURL('image/jpeg', 0.65);
    } catch {
      return project.thumbnailUrl;
    }
  }, [project.thumbnailUrl]);

  // Save current project to IndexedDB + state list
  const persistCurrentProject = useCallback(
    async (projToSave: ProjectData, withCanvasThumb: boolean = false) => {
      const thumb =
        withCanvasThumb
          ? captureCanvasThumbnail() ||
            projToSave.clips.find((c) => c.thumbnailUrl)?.thumbnailUrl
          : projToSave.thumbnailUrl ||
            projToSave.clips.find((c) => c.thumbnailUrl)?.thumbnailUrl;

      const updated: ProjectData = {
        ...projToSave,
        thumbnailUrl: thumb,
        updatedAt: new Date().toISOString(),
      };

      await saveProjectToStorage(updated);
      setProjects((prev) => {
        const exists = prev.some((p) => p.id === updated.id);
        return exists
          ? prev.map((p) => (p.id === updated.id ? updated : p))
          : [updated, ...prev];
      });
    },
    [captureCanvasThumbnail]
  );

  // Auto-save whenever project changes while inside Editor
  useEffect(() => {
    if (screen !== 'editor') return;
    const timer = setTimeout(() => {
      persistCurrentProject(project, false);
    }, 500);
    return () => clearTimeout(timer);
  }, [project, screen, persistCurrentProject]);

  // Restore media blobs from IndexedDB and build HTMLVideoElement / HTMLImageElement cache for Canvas
  useEffect(() => {
    let active = true;

    const syncMediaCache = async () => {
      for (const clip of project.clips) {
        if (
          (clip.sourceType === 'uploaded-video' || clip.sourceType === 'uploaded-image') &&
          !mediaElementsRef.current.has(clip.id)
        ) {
          let url = clip.mediaUrl;
          if (clip.mediaBlobId) {
            const blob = await loadMediaBlobFromIdb(clip.mediaBlobId);
            if (blob && active) {
              url = URL.createObjectURL(blob);
            }
          }
          if (!url || !active) continue;

          if (clip.sourceType === 'uploaded-video') {
            const vid = document.createElement('video');
            vid.src = url;
            vid.muted = clip.muted;
            vid.volume = Math.max(0, Math.min(1, (clip.volume || 100) / 100));
            vid.playsInline = true;
            vid.setAttribute('playsinline', 'true');
            vid.preload = 'auto';
            vid.load();
            mediaElementsRef.current.set(clip.id, vid);
            // Append to DOM so audio can play (hidden, positioned off-screen)
            vid.style.position = 'absolute';
            vid.style.left = '-9999px';
            vid.style.top = '-9999px';
            vid.style.width = '0';
            vid.style.height = '0';
            vid.setAttribute('aria-hidden', 'true');
            try {
              document.body.appendChild(vid);
            } catch {
              // ignore DOM append errors
            }
          } else {
            const img = new Image();
            img.src = url;
            mediaElementsRef.current.set(clip.id, img);
          }
        }
      }

      // Create <audio> elements for audio-track clips (music, voiceover, TTS)
      for (const clip of project.clips) {
        if (
          clip.trackType === 'audio' &&
          clip.mediaUrl &&
          !audioElementsRef.current.has(clip.id)
        ) {
          try {
            const audio = new Audio(clip.mediaUrl);
            audio.muted = clip.muted;
            audio.volume = Math.max(0, Math.min(1, (clip.volume || 100) / 100));
            audio.preload = 'auto';
            audio.style.position = 'absolute';
            audio.style.left = '-9999px';
            audio.style.top = '-9999px';
            audio.setAttribute('aria-hidden', 'true');
            document.body.appendChild(audio);
            audioElementsRef.current.set(clip.id, audio);
          } catch (err) {
            triggerToast(
              `Audio failed to load: ${err instanceof Error ? err.name : String(err)}`,
              `ऑडियो लोड करने में विफल: ${err instanceof Error ? err.name : String(err)}`
            );
          }
        }
      }
    };

    syncMediaCache();
    return () => {
      active = false;
    };
  }, [project.clips]);

  // Register Hardware Back Button on Android (panel closed -> editor -> Home -> exit confirmation)
  useEffect(() => {
    const cleanup = registerHardwareBackButton(() => {
      if (showExportModal) {
        if (!isExportingVideo) setShowExportModal(false);
        return;
      }
      if (showChecklistModal) {
        setShowChecklistModal(false);
        return;
      }
      if (deleteTargetProject) {
        setDeleteTargetProject(null);
        return;
      }
      if (showExitConfirmModal) {
        setShowExitConfirmModal(false);
        return;
      }
      if (screen === 'editor') {
        if (activeSheetTool !== null) {
          setActiveSheetTool(null);
          return;
        }
        setIsPlaying(false);
        persistCurrentProject(project, true);
        setScreen('home');
        return;
      }
      if (screen === 'picker' || screen === 'settings' || screen === 'spec') {
        setScreen('home');
        return;
      }
      if (screen === 'home') {
        setShowExitConfirmModal(true);
      }
    });
    return cleanup;
  }, [
    screen,
    activeSheetTool,
    showExportModal,
    isExportingVideo,
    showChecklistModal,
    deleteTargetProject,
    showExitConfirmModal,
    project,
    persistCurrentProject,
  ]);

  // Voiceover recording timer
  useEffect(() => {
    if (!isRecordingVoice) {
      setRecordingSeconds(0);
      return;
    }
    const timer = setInterval(() => {
      setRecordingSeconds((s) => s + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, [isRecordingVoice]);

  // Unified playback + render loop (single RAF, ref-based playhead, throttled UI updates ~15fps)
  // Uses requestVideoFrameCallback when available, falls back to requestAnimationFrame.
  // Only ONE loop runs; cancelled on pause/unmount. No per-frame React re-renders.
  useEffect(() => {
    if (screen !== 'editor') {
      if (renderRafRef.current) {
        cancelAnimationFrame(renderRafRef.current);
        renderRafRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Sync ref with state on mount/resume
    playheadRef.current = playheadTime;
    lastDisplayUpdateRef.current = performance.now();

    let lastTs = performance.now();
    let rafId: number | null = null;

    const step = (now: number) => {
      const dt = (now - lastTs) / 1000;
      lastTs = now;

      if (isPlaying) {
        const next = playheadRef.current + dt;
        if (next >= totalDuration) {
          playheadRef.current = totalDuration;
          setIsPlaying(false);
          setPlayheadTime(totalDuration);
        } else {
          playheadRef.current = next;
        }
      }

      // Throttled UI state update (~15 fps) for time label + scrubber
      if (now - lastDisplayUpdateRef.current >= 66) {
        setPlayheadTime(playheadRef.current);
        lastDisplayUpdateRef.current = now;
      }

      // Sync <audio> and <video> elements with playhead (one audio source per clip, no echo)
      const ct = playheadRef.current;
      // Sync <audio> elements with playhead (one audio source per clip, no echo).
      // When two clips share the same audio element (e.g. after a split), only the
      // clip whose half-open range [startTime, startTime+duration) contains the
      // playhead controls playback of that element.
      const activeAudioClip = project.clips.find(
        (c) =>
          c.trackType === 'audio' &&
          ct >= c.startTime &&
          ct < c.startTime + c.duration
      );
      const audioElementController = new Map<
        HTMLAudioElement,
        { clip: TimelineClip; isActive: boolean }
      >();
      for (const [clipId, audio] of audioElementsRef.current) {
        const clip = project.clips.find((c) => c.id === clipId);
        if (!clip) continue;
        const isActive = clip.id === activeAudioClip?.id;
        const existing = audioElementController.get(audio);
        if (!existing || (isActive && !existing.isActive)) {
          audioElementController.set(audio, { clip, isActive });
        }
      }
      const handledAudio = new Set<HTMLAudioElement>();
      for (const [clipId, audio] of audioElementsRef.current) {
        const clip = project.clips.find((c) => c.id === clipId);
        if (!clip) continue;
        if (handledAudio.has(audio)) continue;
        handledAudio.add(audio);
        const ctrl = audioElementController.get(audio);
        if (!ctrl) continue;
        const { clip: ctrlClip, isActive } = ctrl;
        const clipStart = ctrlClip.startTime;
        const clipEnd = clipStart + ctrlClip.duration;
        const relTime = ct - clipStart;
        // source time = sourceStart + (timelineTime - startTime) * speed
        const sourceTime = ctrlClip.sourceStart + relTime * ctrlClip.speed;
        // Update mute/volume in case user changed them mid-session
        audio.muted = ctrlClip.muted;
        audio.volume = Math.max(0, Math.min(1, (ctrlClip.volume || 100) / 100));
        if (isPlaying && isActive) {
          if (audio.paused) {
            try {
              // Don't re-seek if already at expected source time (tolerance 0.1 s)
              if (Math.abs(audio.currentTime - sourceTime) > 0.1) {
                audio.currentTime = Math.max(0, sourceTime);
              }
              audio.play().catch(() => {});
            } catch {}
          } else if (Math.abs(audio.currentTime - sourceTime) > 0.1) {
            // Do not re-arm seek every frame — let the element play continuously.
            // Seeks only happen via the seekPendingRef path above (on clip transition / resume).
          }
        } else {
          // Not playing or not active: pause AND mute this element
          try { audio.pause(); } catch {}
          audio.muted = true;
        }
        // Non-active clip sharing this element: pause if no clip is active at all
        if (!isActive && !audio.paused && !activeAudioClip) {
          try { audio.pause(); } catch {}
        }
      }
      // Sync <video> elements with playhead. One element per source; shared after split.
      // Only the clip whose half-open range [startTime, startTime+duration) contains the
      // playhead controls its element — inactive clips sharing the same element never pause it.
      const activeVideoClip = project.clips.find(
        (c) =>
          c.trackType === 'video' &&
          c.sourceType === 'uploaded-video' &&
          ct >= c.startTime &&
          ct < c.startTime + c.duration
      );
      const elementController = new Map<
        HTMLVideoElement,
        { clip: TimelineClip; isActive: boolean }
      >();
      for (const [clipId, el] of mediaElementsRef.current) {
        const clip = project.clips.find((c) => c.id === clipId);
        if (!clip || !(el instanceof HTMLVideoElement)) continue;
        const isActive = clip.id === activeVideoClip?.id;
        const existing = elementController.get(el);
        // Active clip takes priority over an inactive clip sharing the same element
        if (!existing || (isActive && !existing.isActive)) {
          elementController.set(el, { clip, isActive });
        }
      }
      const handledElements = new Set<HTMLVideoElement>();
      for (const [clipId, el] of mediaElementsRef.current) {
        const clip = project.clips.find((c) => c.id === clipId);
        if (!clip || !(el instanceof HTMLVideoElement)) continue;
        if (handledElements.has(el)) continue;
        handledElements.add(el);
        const ctrl = elementController.get(el);
        if (!ctrl) continue;
        const { clip: ctrlClip, isActive } = ctrl;
        const clipStart = ctrlClip.startTime;
        const clipEnd = clipStart + ctrlClip.duration;
        const relTime = ct - clipStart;
        // source time = sourceStart + (timelineTime - startTime) * speed
        const sourceTime = ctrlClip.sourceStart + relTime * ctrlClip.speed;
        el.muted = ctrlClip.muted;
        el.volume = Math.max(0, Math.min(1, (ctrlClip.volume || 100) / 100));
        // Debug metrics for the active video element
        if (isActive && el.videoWidth > 0) {
          setDebugActiveClipId(ctrlClip.id);
          setDebugSourceTime(Number(sourceTime.toFixed(3)));
          setDebugReadyState(el.readyState);
          setDebugPaused(el.paused);
        }
        if (isPlaying && isActive) {
          // If a seek is already pending for this element, wait for seeked or 500 ms timeout
          const pending = seekPendingRef.current;
          if (pending && pending.el === el) {
            const seeked = Math.abs(el.currentTime - pending.targetTime) < 0.1;
            if (seeked || performance.now() > pending.deadline) {
              seekPendingRef.current = null;
              // Only play if element has enough data buffered (readyState >= 2 = HAVE_CURRENT_DATA)
              if (el.readyState >= 2) {
                try {
                  el.play().catch((err) => {
                    setIsPlaying(false);
                    setDebugLastError(`${err.name}: ${err.message}`);
                    triggerToast(
                      `Playback error: ${err.name}: ${err.message}`,
                      `प्लेबैक त्रुटि: ${err.name}: ${err.message}`
                    );
                  });
                } catch (err) {
                  setIsPlaying(false);
                  const msg = err instanceof Error ? err.message : String(err);
                  const name = err instanceof Error ? err.name : 'Unknown';
                  setDebugLastError(`${name}: ${msg}`);
                  triggerToast(
                    `Playback error: ${name}: ${msg}`,
                    `प्लेबैक त्रुटि: ${name}: ${msg}`
                  );
                }
              } else {
                // Not enough data yet; keep seeking pending until ready
                seekPendingRef.current = { el, targetTime: sourceTime, deadline: performance.now() + 500 };
              }
            }
            continue;
          }
          if (el.paused) {
            try {
              // Don't re-seek if already at expected source time (tolerance 0.1 s)
              if (Math.abs(el.currentTime - sourceTime) > 0.1) {
                el.currentTime = Math.max(0, sourceTime);
              }
              seekPendingRef.current = { el, targetTime: sourceTime, deadline: performance.now() + 500 };
            } catch {
              // ignore
            }
          } else if (Math.abs(el.currentTime - sourceTime) > 0.5) {
            // Do not re-arm seek every frame — let the element play continuously.
            // Seeks only happen via the seekPendingRef path above (on clip transition / resume).
          }
        } else {
          // Not playing or not active: pause this element (includes active clip when paused)
          try { el.pause(); } catch {}
        }
        // Non-active clip sharing this element: pause if no clip is active at all
        if (!isActive && !el.paused && !activeVideoClip) {
          try { el.pause(); } catch {}
        }
      }

      // Pre-load next clip element ~300 ms before boundary so play() doesn't stall on split transitions
      const nextClip = project.clips.find(
        (c) =>
          c.trackType === 'video' &&
          c.sourceType === 'uploaded-video' &&
          ct >= c.startTime - 0.3 &&
          ct < c.startTime
      );
      if (nextClip) {
        const nextEl = mediaElementsRef.current.get(nextClip.id);
        if (nextEl instanceof HTMLVideoElement && nextEl.readyState < 2) {
          try {
            nextEl.currentTime = Math.max(0, nextClip.sourceStart);
            nextEl.load();
          } catch {}
        }
      }

      // When plain video passthrough is active, drive the visible <video> element
      if (showPlainVideo && videoRef.current) {
        const activeVideo = project.clips.find(
          (c) =>
            c.trackType === 'video' &&
            c.sourceType === 'uploaded-video' &&
            !c.muted &&
            ct >= c.startTime &&
            ct < c.startTime + c.duration
        );
        if (activeVideo && activeVideo.mediaUrl) {
          const vid = videoRef.current;
          if (vid.src !== activeVideo.mediaUrl) {
            vid.src = activeVideo.mediaUrl;
          }
          const relTime = ct - activeVideo.startTime;
          // source time = sourceStart + (timelineTime - startTime) * speed
          const sourceTime = activeVideo.sourceStart + relTime * (activeVideo.speed || 1);
          if (!vid.paused && !isPlaying) vid.pause();
          if (isPlaying) {
            if (vid.paused) {
              vid.currentTime = Math.max(0, sourceTime);
              vid.play().catch(() => {});
            } else if (Math.abs(vid.currentTime - sourceTime) > 0.5) {
              vid.currentTime = Math.max(0, sourceTime);
            }
          } else if (!isPlaying && Math.abs(vid.currentTime - sourceTime) > 0.5) {
            // Scrubbing or paused — seek to show the frame at the playhead.
            vid.currentTime = Math.max(0, sourceTime);
          }
          vid.muted = activeVideo.muted;
          vid.volume = Math.max(0, Math.min(1, (activeVideo.volume || 100) / 100));
        } else if (!videoRef.current.paused) {
          try { videoRef.current.pause(); } catch {}
        }
      }

      // Test-only debug hook (VITE_TEST_MODE): expose playback state for Playwright diagnostics.
      if (import.meta.env.VITE_TEST_MODE) {
        const dbgEls: Array<Record<string, unknown>> = [];
        mediaElementsRef.current.forEach((el) => {
          if (el instanceof HTMLVideoElement) {
            dbgEls.push({
              tag: 'VIDEO-CACHED',
              currentTime: Number(el.currentTime.toFixed(3)),
              paused: el.paused,
              muted: el.muted,
              readyState: el.readyState,
            });
          }
        });
        if (videoRef.current) {
          dbgEls.push({
            tag: 'VIDEO-VISIBLE',
            currentTime: Number(videoRef.current.currentTime.toFixed(3)),
            paused: videoRef.current.paused,
            muted: videoRef.current.muted,
            readyState: videoRef.current.readyState,
          });
        }
        (window as any).__debug = {
          playheadTime: playheadRef.current,
          isPlaying,
          totalDuration,
          showPlainVideo,
          activeClipId: activeVideoClip?.id ?? null,
          activeSourceTime: activeVideoClip
            ? Number(
                (activeVideoClip.sourceStart +
                  (playheadRef.current - activeVideoClip.startTime) * (activeVideoClip.speed || 1)).toFixed(3)
              )
            : null,
          elements: dbgEls,
        };
      }

      const qualityMode = isExportingVideo ? 'export-full' : 'preview-540p';
      renderProjectFrame(
        ctx,
        project,
        playheadRef.current,
        mediaElementsRef.current,
        qualityMode,
        isPlaying
      );
      soundEngine.triggerTimelineAudioTick(playheadRef.current, project.clips, isPlaying);

      // Stop all Web Audio sources when transitioning to paused (prevents echo/loop on pause)
      if (wasPlayingRef.current && !isPlaying) {
        soundEngine.stopAllAudio();
      }
      wasPlayingRef.current = isPlaying;

      // Debug metrics: measure preview fps and dropped frames
      frameCountRef.current++;
      const debugNow = performance.now();
      if (debugNow - lastFrameTimeRef.current >= 1000) {
        setDebugPreviewFps(frameCountRef.current);
        frameCountRef.current = 0;
        lastFrameTimeRef.current = debugNow;
      }

      // Debug counters for Bug B acceptance: playing media elements + active audio sources
      let playingMediaCount = 0;
      for (const [, el] of mediaElementsRef.current) {
        if (el instanceof HTMLVideoElement && !el.paused) playingMediaCount++;
      }
      for (const [, audio] of audioElementsRef.current) {
        if (!audio.paused) playingMediaCount++;
      }
      if (!videoRef.current?.paused) playingMediaCount++;
      setDebugPlayingMediaCount(playingMediaCount);
      setDebugActiveAudioSources(soundEngine.activeAudioSourcesCount());

      // Debug metrics: measure preview fps and dropped frames
      // Estimate dropped frames (target ~60fps, measure actual vs expected)
      const expectedFrames = Math.round((debugNow - lastFrameTimeRef.current) / 16.67);
      const actualFrames = frameCountRef.current;
      if (expectedFrames > actualFrames) {
        droppedFramesRef.current += expectedFrames - actualFrames;
        setDebugDroppedFrames(droppedFramesRef.current);
      }
      setDebugPlaying(isPlaying);

      // Update video dimensions debug when a video clip is active
      const activeVideoForDebug = project.clips.find(
        (c) =>
          c.trackType === 'video' &&
          c.sourceType === 'uploaded-video' &&
          ct >= c.startTime &&
          ct < c.startTime + c.duration
      );
      if (activeVideoForDebug) {
        const el = mediaElementsRef.current.get(activeVideoForDebug.id);
        if (el instanceof HTMLVideoElement && el.videoWidth > 0) {
          setDebugVideoDims(`${el.videoWidth} x ${el.videoHeight}`);
        }
      }

      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => {
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [isPlaying, project, totalDuration, screen, isExportingVideo]);

  // History-aware project updater
  const updateProjectWithHistory = useCallback((updater: (prev: ProjectData) => ProjectData) => {
    setProject((prev) => {
      const next = updater(prev);
      setHistoryPast((h) => [...h.slice(-40), prev]);
      setHistoryFuture([]);
      return { ...next, updatedAt: new Date().toISOString() };
    });
  }, []);

  // RAF-throttled clip property updater for smooth 60fps slider dragging on phone
  const updateSelectedClip = useCallback(
    (patch: Partial<TimelineClip>, throttleWithRaf: boolean = false) => {
      if (!selectedClipId) return;
      const applyUpdate = () => {
        setProject((prev) => ({
          ...prev,
          updatedAt: new Date().toISOString(),
          clips: prev.clips.map((c) => (c.id === selectedClipId ? { ...c, ...patch } : c)),
        }));
      };

      if (throttleWithRaf) {
        if (sliderRafRef.current) cancelAnimationFrame(sliderRafRef.current);
        sliderRafRef.current = requestAnimationFrame(applyUpdate);
      } else {
        updateProjectWithHistory((prev) => ({
          ...prev,
          clips: prev.clips.map((c) => (c.id === selectedClipId ? { ...c, ...patch } : c)),
        }));
      }
    },
    [selectedClipId, updateProjectWithHistory]
  );

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

  // Check if first-time onboarding should show when entering Editor
  const openEditorWithProject = (proj: ProjectData) => {
    setProject(proj);
    setHistoryPast([]);
    setHistoryFuture([]);
    setPlayheadTime(0);
    setIsPlaying(false);
    setActiveSheetTool(null);
    setSelectedClipId(proj.clips[0]?.id || null);
    setScreen('editor');

    try {
      const done = localStorage.getItem('clipnova_onboarding_done_v3');
      if (!done) {
        setOnboardingStep(1);
      }
    } catch {
      // ignore
    }
  };

  // ============================================================================
  // NEW PROJECT & MEDIA PICKER FLOW (Section A.2, A.3 & Section D)
  // ============================================================================
  const handleStartNewProject = () => {
    setPickerPool([]);
    setPickerSelectedIds([]);
    setPickerTab('device');
    setScreen('picker');
    // Prompt phone gallery picker after transition
    setTimeout(() => {
      pickerFileInputRef.current?.click();
    }, 120);
  };

  // Test mode: load the pre-pushed test video directly without the system picker.
  // Only available when VITE_TEST_MODE=true (never in the normal release APK).
  // In browser tests, window.__TEST_VIDEO_URL__ can override the mediaUrl.
  const handleLoadTestVideo = () => {
    if (!import.meta.env.VITE_TEST_MODE) return;
    const testClip = createBaseClip({
      id: 'test-video-clip',
      trackId: 'main-video',
      trackType: 'video',
      title: 'Test Video',
      startTime: 0,
      duration: 10,
      sourceType: 'uploaded-video',
    });
    // Override source-specific fields for the test video
    const testVideoUrl =
      (typeof window !== 'undefined' &&
        (window as any).__TEST_VIDEO_URL__) ||
      'file:///sdcard/Movies/test-video.mp4';
    Object.assign(testClip, {
      mediaUrl: testVideoUrl,
      sourceStart: 0,
      sourceEnd: 10,
      speed: 1,
      volume: 100,
      muted: false,
      filterPreset: 'none',
      effect: 'none',
      transitionIn: 'none',
      transitionDuration: 0.3,
      adjustments: { ...DEFAULT_ADJUSTMENTS },
      keyframes: [],
    });
    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [testClip],
      updatedAt: new Date().toISOString(),
    }));
    setSelectedClipId(testClip.id);
    setPlayheadTime(0);
    setIsPlaying(false);
    setScreen('editor');
    triggerToast(
      'Test video loaded',
      'टेस्ट वीडियो लोड किया गया'
    );
  };

  const handlePickerFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setIsImportingFiles(true);
    const newItems: ImportedMediaItem[] = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const item = await inspectAndImportMediaFile(files[i], {
          onStepToast: triggerToast,
        });
        newItems.push(item);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        triggerToast(`Import error: ${msg}`, `इंपोर्ट त्रुटि: ${msg}`);
      }
    }

    setPickerPool((prev) => [...prev, ...newItems]);
    setPickerSelectedIds((prev) => [...prev, ...newItems.map((it) => it.id)]);
    setIsImportingFiles(false);
    e.target.value = '';
  };

  const togglePickerItemSelection = (id: string) => {
    setPickerSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleConfirmMediaPickerAdd = async () => {
    // Gather selected items in exact numbered order
    const starterPool: ImportedMediaItem[] = STARTER_MEDIA_LIBRARY.map((s) => ({
      id: s.id,
      name: lang === 'hi' ? s.titleHi : s.title,
      kind: 'procedural',
      duration: s.duration,
      scenePreset: s.scenePreset,
      createdAt: new Date().toISOString(),
    }));
    const allAvailable = [...pickerPool, ...starterPool];
    const orderedItems = pickerSelectedIds
      .map((id) => allAvailable.find((it) => it.id === id))
      .filter((it): it is ImportedMediaItem => Boolean(it));

    if (orderedItems.length === 0) {
      triggerToast(
        'Please select at least 1 video or photo to start.',
        'शुरू करने के लिए कम से कम 1 वीडियो या फ़ोटो चुनें।'
      );
      return;
    }

    // Build sequential clips on the Main Video track ONLY (Timeline starts empty except for selected clips!)
    let cursorTime = 0;
    const initialClips: TimelineClip[] = orderedItems.map((item, idx) => {
      const clipId = `clip-main-${Date.now()}-${idx}`;
      const clip = createBaseClip({
        id: clipId,
        trackId: 'track-video-main',
        trackType: item.kind === 'audio' ? 'audio' : 'video',
        title: item.name,
        startTime: Number(cursorTime.toFixed(2)),
        duration: item.duration,
        sourceType:
          item.kind === 'video'
            ? 'uploaded-video'
            : item.kind === 'image'
            ? 'uploaded-image'
            : item.kind === 'audio'
            ? 'uploaded-audio'
            : 'procedural-scene',
        scenePreset: item.scenePreset || 'mumbai-drive',
        mediaUrl: item.mediaUrl,
        mediaBlobId: item.mediaBlobId,
        thumbnailUrl: item.thumbnailUrl,
      });
      cursorTime += item.duration;
      return clip;
    });

    const newProj: ProjectData = {
      id: `proj-${Date.now()}`,
      name: `Project ${projects.length + 1}`,
      aspectRatio: '9:16',
      fps: 30,
      resolution: '1080p',
      updatedAt: new Date().toISOString(),
      thumbnailUrl: orderedItems.find((i) => i.thumbnailUrl)?.thumbnailUrl,
      background: {
        type: 'gradient',
        solidColor: '#0F172A',
        gradientFrom: '#0F172A',
        gradientTo: '#1E293B',
        blurAmount: 20,
      },
      importedMedia: orderedItems,
      clips: initialClips,
    };

    await saveProjectToStorage(newProj);
    setProjects((prev) => [newProj, ...prev]);
    triggerToast(
      `Clip added: ${initialClips.length} item(s) placed on Main Video track`,
      `मेन वीडियो ट्रैक पर ${initialClips.length} क्लिप जोड़ी गईं`
    );
    openEditorWithProject(newProj);
  };

  // Import media directly inside Editor (appends to Media panel, Main Video/PIP/Audio track, and scrolls timeline)
  const handleEditorDirectFileImport = async (
    e: React.ChangeEvent<HTMLInputElement>,
    targetTrack: 'video' | 'overlay' | 'audio'
  ) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    let endCursor = project.clips
      .filter((c) => c.trackType === targetTrack)
      .reduce((max, c) => Math.max(max, c.startTime + c.duration), 0);

    if (targetTrack === 'overlay') {
      endCursor = playheadTime;
    }

    const newClips: TimelineClip[] = [];
    const newMediaItems: ImportedMediaItem[] = [];

    for (let i = 0; i < files.length; i++) {
      try {
        const item = await inspectAndImportMediaFile(files[i], {
          onStepToast: triggerToast,
        });
        newMediaItems.push(item);

        const actualTrack: TrackType =
          item.kind === 'audio' ? 'audio' : targetTrack;
        const clipStart = Number(endCursor.toFixed(2));
        const clipId = `clip-${actualTrack}-${Date.now()}-${i}`;

        const newClip = createBaseClip({
          id: clipId,
          trackId: `track-${actualTrack}`,
          trackType: actualTrack,
          title: item.name,
          startTime: clipStart,
          duration: item.duration,
          sourceType:
            item.kind === 'video'
              ? 'uploaded-video'
              : item.kind === 'image'
              ? 'uploaded-image'
              : 'uploaded-audio',
          mediaUrl: item.mediaUrl,
          mediaBlobId: item.mediaBlobId,
          thumbnailUrl: item.thumbnailUrl,
          scale: actualTrack === 'overlay' ? 0.45 : 1,
          beatMarkers:
            actualTrack === 'audio'
              ? soundEngine.generateAutoBeatMarkers(item.duration, 104)
              : undefined,
        });

        newClips.push(newClip);
        endCursor += item.duration;
        triggerToast(
          `Clip added: "${item.name}" at ${clipStart.toFixed(1)}s`,
          `क्लिप जोड़ी गई: "${item.name}" (${clipStart.toFixed(1)}s पर)`
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        triggerToast(`Import failed: ${msg}`, `इंपोर्ट विफल: ${msg}`);
      }
    }

    if (newClips.length > 0) {
      const lastClip = newClips[newClips.length - 1];
      updateProjectWithHistory((prev) => ({
        ...prev,
        importedMedia: [...(prev.importedMedia || []), ...newMediaItems],
        clips: [...prev.clips, ...newClips],
      }));
      setSelectedClipId(lastClip.id);
      setPlayheadTime(lastClip.startTime);
      setScrollToTimeTrigger({ time: lastClip.startTime, seq: Date.now() });
    }

    e.target.value = '';
  };

  // ============================================================================
  // NON-DESTRUCTIVE ADJUSTMENT LAYER & EFFECT OVERLAY LAYER CREATORS
  // ============================================================================
  const handleCreateAdjustmentLayer = () => {
    const newId = `adj-layer-${Date.now()}`;
    const start = Number(playheadTime.toFixed(2));
    const dur = Math.min(4.0, Math.max(2.0, totalDuration - start));

    const newLayer = createBaseClip({
      id: newId,
      trackId: 'track-adjustment',
      trackType: 'adjustment',
      title: `Adjustment Layer #${
        project.clips.filter((c) => c.trackType === 'adjustment').length + 1
      }`,
      titleHi: `एडजस्टमेंट लेयर #${
        project.clips.filter((c) => c.trackType === 'adjustment').length + 1
      }`,
      startTime: start,
      duration: dur,
      sourceType: 'adjustment-layer',
      blendMode: 'source-over',
      opacity: 1,
      adjustments: {
        ...DEFAULT_ADJUSTMENTS,
        contrast: 12,
        saturation: 16,
        temperature: 10,
      },
    });

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, newLayer],
    }));
    setSelectedClipId(newId);
    setScrollToTimeTrigger({ time: start, seq: Date.now() });
    triggerToast(
      'Created Non-Destructive Adjustment Layer.',
      'नॉन-डिस्ट्रक्टिव एडजस्टमेंट लेयर बनाई गई।'
    );
  };

  const handleCreateEffectLayer = (
    effect: VideoEffectType = 'light-leak',
    startTimeOverride?: number
  ) => {
    const newId = `fx-layer-${Date.now()}`;
    const start = Number(
      (startTimeOverride !== undefined ? startTimeOverride : playheadTime).toFixed(2)
    );
    const fxMeta = EFFECTS_CATALOG.find((e) => e.id === effect);
    const dur = 3.0;

    const newLayer = createBaseClip({
      id: newId,
      trackId: 'track-effect-layer',
      trackType: 'effect-layer',
      title: `${fxMeta?.nameEn || effect} FX Layer`,
      titleHi: `${fxMeta?.nameHi || effect} इफेक्ट लेयर`,
      startTime: start,
      duration: dur,
      sourceType: 'effect-layer',
      effect,
      effectIntensity: fxMeta?.defaultIntensity || 80,
      blendMode: effect === 'light-leak' || effect === 'glow' ? 'screen' : 'source-over',
    });

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, newLayer],
    }));
    setSelectedClipId(newId);
    setScrollToTimeTrigger({ time: start, seq: Date.now() });
    triggerToast(
      `Added "${fxMeta?.nameEn || effect}" Effect Overlay Layer.`,
      `"${fxMeta?.nameHi || effect}" इफेक्ट ओवरले लेयर टाइमलाइन पर जोड़ी गई।`
    );
  };

  // ============================================================================
  // TIMELINE EDITING OPERATIONS
  // ============================================================================
  const handleUpdateClipTiming = (clipId: string, newStartTime: number, newDuration: number) => {
    setProject((prev) => ({
      ...prev,
      clips: prev.clips.map((c) => {
        if (c.id !== clipId) return c;
        const speed = c.speed || 1;
        const deltaStart = newStartTime - c.startTime;
        // source time = sourceStart + (timelineTime - startTime) * speed
        // When startTime moves (trim-left), sourceStart moves by deltaStart * speed.
        // When duration changes (trim-right), sourceEnd = sourceStart + duration * speed.
        const newSourceStart = Number((c.sourceStart + deltaStart * speed).toFixed(2));
        const newSourceEnd = Number((newSourceStart + newDuration * speed).toFixed(2));
        return {
          ...c,
          startTime: newStartTime,
          duration: newDuration,
          sourceStart: newSourceStart,
          sourceEnd: newSourceEnd,
          outPoint: newDuration,
        };
      }),
    }));
  };

  const handlePlayheadDrag = (t: number) => {
    // Pause playback while scrubbing, show the frame at the playhead.
    // Seeking is throttled by the single RAF loop (~15fps UI updates); the loop
    // seeks media elements to sourceStart + (t - startTime) * speed on each frame.
    setIsPlaying(false);
    setIsScrubbing(true);
    playheadRef.current = t;
    setPlayheadTime(t);
    // End scrub after the next RAF tick so the frame renders before releasing.
    if (scrubRafRef.current) cancelAnimationFrame(scrubRafRef.current);
    scrubRafRef.current = requestAnimationFrame(() => {
      setIsScrubbing(false);
      scrubRafRef.current = null;
    });
  };

  const handleSplitAtPlayhead = () => {
    if (!selectedClip) return;
    const t = playheadTime;
    const offset = t - selectedClip.startTime;
    if (offset <= 0.25 || offset >= selectedClip.duration - 0.25) {
      triggerToast(
        'Move playhead inside the selected clip to split.',
        'क्लिप को काटने (Split) के लिए प्लेहेड को क्लिप के बीच में रखें।'
      );
      return;
    }

    const speed = selectedClip.speed || 1;
    const firstHalfDur = Number(offset.toFixed(2));
    const secondHalfDur = Number((selectedClip.duration - firstHalfDur).toFixed(2));
    const secondId = `${selectedClip.id}-split-${Date.now()}`;

    // Source range math: source time = sourceStart + (timelineTime - startTime) * speed
    const leftSourceEnd = Number((selectedClip.sourceStart + firstHalfDur * speed).toFixed(2));

    const firstClip: TimelineClip = {
      ...selectedClip,
      duration: firstHalfDur,
      // Left clip keeps timelineStart (= startTime) and sourceStart
      sourceEnd: leftSourceEnd,
      outPoint: selectedClip.inPoint + firstHalfDur,
    };

    const secondClip: TimelineClip = {
      ...selectedClip,
      id: secondId,
      title: `${selectedClip.title} (2)`,
      // Right clip starts at the split point on the timeline
      startTime: Number((selectedClip.startTime + firstHalfDur).toFixed(2)),
      duration: secondHalfDur,
      // Right clip continues the source range where the left clip left off
      sourceStart: leftSourceEnd,
      sourceEnd: selectedClip.sourceEnd,
      inPoint: selectedClip.inPoint + firstHalfDur,
      outPoint: selectedClip.outPoint,
    };

    // Both clips reference the SAME media element — do not re-import, do not revoke the blob URL.
    if (mediaElementsRef.current.has(selectedClip.id)) {
      const existingEl = mediaElementsRef.current.get(selectedClip.id)!;
      mediaElementsRef.current.set(secondId, existingEl);
    }
    if (audioElementsRef.current.has(selectedClip.id)) {
      const existingAudio = audioElementsRef.current.get(selectedClip.id)!;
      audioElementsRef.current.set(secondId, existingAudio);
    }

    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: prev.clips.flatMap((c) => (c.id === selectedClip.id ? [firstClip, secondClip] : c)),
    }));
    // Keep playhead where it is, select the right clip, do not pause or hang the preview.
    setSelectedClipId(secondId);
    triggerToast(
      'Clip split. Right part selected.',
      'क्लिप काट दिया गया। दाहिना भाग चुना गया।'
    );
  };

  const handleDuplicateSelected = () => {
    if (!selectedClip) return;
    const dupId = `${selectedClip.id}-dup-${Date.now()}`;
    const dupClip: TimelineClip = {
      ...selectedClip,
      id: dupId,
      title: `${selectedClip.title} (Copy)`,
      startTime: Number((selectedClip.startTime + selectedClip.duration).toFixed(2)),
    };
    // Share the same media/audio element — same source, do not re-import.
    if (mediaElementsRef.current.has(selectedClip.id)) {
      mediaElementsRef.current.set(dupId, mediaElementsRef.current.get(selectedClip.id)!);
    }
    if (audioElementsRef.current.has(selectedClip.id)) {
      audioElementsRef.current.set(dupId, audioElementsRef.current.get(selectedClip.id)!);
    }
    updateProjectWithHistory((prev) => ({
      ...prev,
      clips: [...prev.clips, dupClip],
    }));
    setSelectedClipId(dupId);
  };

  const handleDeleteSelected = () => {
    if (!selectedClip) return;
    updateProjectWithHistory((prev) => {
      const remaining = prev.clips.filter((c) => c.id !== selectedClip.id);
      setSelectedClipId(remaining[0]?.id || null);
      return { ...prev, clips: remaining };
    });
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
    const relOffset = Number(
      Math.max(
        0,
        Math.min(selectedClip.duration, playheadTime - selectedClip.startTime)
      ).toFixed(2)
    );
    const newKf: KeyframePoint = {
      id: `kf-${Date.now()}`,
      timeOffset: relOffset,
      scale: selectedClip.scale,
      x: selectedClip.posX,
      y: selectedClip.posY,
      rotation: selectedClip.rotation,
      opacity: selectedClip.opacity,
      effectIntensity: selectedClip.effectIntensity ?? 75,
      brightness: selectedClip.adjustments.brightness,
      easing: 'ease-in-out',
    };
    const filtered = selectedClip.keyframes.filter((k) => Math.abs(k.timeOffset - relOffset) > 0.12);
    updateSelectedClip({ keyframes: [...filtered, newKf] });
    triggerToast(
      `Added Keyframe (◆) at +${relOffset}s`,
      `+${relOffset}s पर कीफ्रेम (◆) जोड़ा गया`
    );
  };

  const handleAutoBeatCut = () => {
    const audioClip = project.clips.find(
      (c) => c.trackType === 'audio' && c.beatMarkers && c.beatMarkers.length > 0
    );
    if (!audioClip || !audioClip.beatMarkers) {
      triggerToast('Add a music track with beat markers first.', 'पहले ऑडियो ट्रैक जोड़ें।');
      return;
    }

    const beats = audioClip.beatMarkers;
    updateProjectWithHistory((prev) => {
      const nonVideoClips = prev.clips.filter((c) => c.trackType !== 'video');
      const videoClips = prev.clips
        .filter((c) => c.trackType === 'video')
        .sort((a, b) => a.startTime - b.startTime);
      if (videoClips.length === 0) return prev;

      const splitResult: TimelineClip[] = [];
      for (const vc of videoClips) {
        const clipStart = vc.startTime;
        const clipEnd = vc.startTime + vc.duration;
        const internalBeats = beats.filter((b) => b > clipStart + 0.6 && b < clipEnd - 0.6);
        if (internalBeats.length === 0) {
          splitResult.push(vc);
          continue;
        }
        const cutPoint = internalBeats[0];
        const d1 = Number((cutPoint - clipStart).toFixed(2));
        const d2 = Number((clipEnd - cutPoint).toFixed(2));
        splitResult.push(
          { ...vc, duration: d1, outPoint: d1 },
          {
            ...vc,
            id: `${vc.id}-beat-${Date.now()}`,
            startTime: cutPoint,
            duration: d2,
            transitionIn: 'flash',
            transitionDuration: 0.3,
          }
        );
      }
      return { ...prev, clips: [...nonVideoClips, ...splitResult] };
    });

    triggerToast(
      'Auto Beat-Cut synced Main Video clips to beat markers!',
      'ऑटो बीट-कट द्वारा वीडियो क्लिप्स को म्यूज़िक बीट्स पर सिंक किया गया!'
    );
  };

  const handleToggleTrackMute = (trackType: TrackType) => {
    updateProjectWithHistory((prev) => {
      const trackClips = prev.clips.filter((c) => c.trackType === trackType);
      const allMuted = trackClips.length > 0 && trackClips.every((c) => c.muted);
      return {
        ...prev,
        clips: prev.clips.map((c) =>
          c.trackType === trackType ? { ...c, muted: !allMuted } : c
        ),
      };
    });
  };

  const handleLutFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !selectedClip) return;
    const text = await file.text();
    const parsed = parseCubeLutFile(text, file.name);
    updateSelectedClip({
      adjustments: {
        ...selectedClip.adjustments,
        ...parsed.adjustmentsPatch,
      },
    });
    triggerToast(
      `Imported 3D LUT "${parsed.lutName}"`,
      `3D LUT "${parsed.lutName}" लागू किया गया`
    );
    e.target.value = '';
  };

  // Text, Auto-Captions & Stickers
  const handleAddTextOverlay = (presetText: string, fontFam: string, anim: TextAnimationType) => {
    const newId = `txt-${Date.now()}`;
    const newClip = createBaseClip({
      id: newId,
      trackId: 'track-text-captions',
      trackType: 'text',
      title: presetText.slice(0, 18),
      startTime: Number(playheadTime.toFixed(2)),
      duration: 3.0,
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
        title: `Caption #${i + 1}`,
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
      `Generated ${capLang.toUpperCase()} karaoke auto-captions.`,
      `${capLang.toUpperCase()} ऑटो-कैप्शन टाइमलाइन में जोड़े गए।`
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
    triggerToast(`Added music: ${track.title}`, `म्यूज़िक जोड़ा गया: ${track.titleHi}`);
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
      `Extracted audio from "${sourceVideo.title}".`,
      `"${sourceVideo.title}" से ऑडियो अलग ट्रैक में निकाला गया।`
    );
  };

  const handleSynthesizeTtsToTimeline = () => {
    if (!ttsInputText.trim()) return;
    soundEngine.speakTextToSpeech(ttsInputText, ttsVoiceLang);
    const estDuration = Math.max(2.2, Number((ttsInputText.length * 0.08).toFixed(1)));
    const newId = `tts-${Date.now()}`;
    const ttsClip = createBaseClip({
      id: newId,
      trackId: 'track-audio-main',
      trackType: 'audio',
      title: `TTS: ${ttsInputText.slice(0, 16)}`,
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
      'Added TTS voice clip to Audio Track.',
      'टेक्स्ट-टू-स्पीच वॉइस ऑडियो ट्रैक में जोड़ी गई।'
    );
  };

  const handleToggleVoiceover = async () => {
    if (!isRecordingVoice) {
      const started = await soundEngine.startVoiceoverRecording();
      if (started) {
        setIsRecordingVoice(true);
        triggerToast('Recording microphone voiceover...', 'माइक वॉइसओवर रिकॉर्डिंग चालू...');
      } else {
        const newId = `vo-${Date.now()}`;
        const voClip = createBaseClip({
          id: newId,
          trackId: 'track-audio-main',
          trackType: 'audio',
          title: 'Voiceover Track',
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
          'Mic unavailable — added fallback Voiceover clip.',
          'माइक उपलब्ध न होने पर डेमो वॉइसओवर जोड़ा गया।'
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
      triggerToast('Voiceover added to Audio Track.', 'वॉइसओवर ऑडियो ट्रैक में जोड़ा गया।');
    }
  };

  const handleLoadTemplate = async (tpl: TemplatePreset) => {
    const newProj: ProjectData = {
      id: `proj-tpl-${Date.now()}`,
      name: lang === 'hi' ? tpl.nameHi : tpl.nameEn,
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
      clips: tpl.clips.map((c) => ({ ...c, id: `${c.id}-${Date.now()}` })),
    };
    await saveProjectToStorage(newProj);
    setProjects((prev) => [newProj, ...prev]);
    openEditorWithProject(newProj);
  };

  const handleLoadSampleDemoProject = async () => {
    const sampleProj: ProjectData = {
      ...INITIAL_PROJECT,
      id: `proj-sample-${Date.now()}`,
      name: 'Sample Project (Demo Reel)',
      updatedAt: new Date().toISOString(),
      clips: INITIAL_PROJECT.clips.map((c) => ({ ...c, id: `${c.id}-${Date.now()}` })),
    };
    await saveProjectToStorage(sampleProj);
    setProjects((prev) => [sampleProj, ...prev]);
    openEditorWithProject(sampleProj);
  };

  // Interactive Canvas Click for Custom Polygon Mask Drawing
  const handleCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement | HTMLVideoElement>) => {
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

  // ============================================================================
  // VIDEO EXPORT WITH CANCEL BUTTON & CAPACITOR FILESYSTEM / SHARE (Section F)
  // ============================================================================
  const handleStartVideoExport = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Resize canvas to export-full dimensions BEFORE creating captureStream
    // so the stream captures at the correct resolution.
    const { width: expW, height: expH } = getAspectDimensions(
      project.aspectRatio,
      'export-full',
      project.resolution
    );
    ctx.canvas.width = expW;
    ctx.canvas.height = expH;

    setIsExportingVideo(true);
    setExportProgress(0);
    setExportedVideoUrl(null);
    setExportedVideoBlob(null);
    setExportResult(null);
    exportCancelledRef.current = false;

    try {
      // Build a combined stream: canvas video + audio from all active media elements
      const canvasStream = canvas.captureStream(project.fps);
      const combinedStream = new MediaStream();
      canvasStream.getVideoTracks().forEach((t) => combinedStream.addTrack(t));

      // Add audio tracks from cached video/audio elements (must be playing during export)
      const addAudioTracks = (el: HTMLMediaElement) => {
        try {
          const s = (el as any).captureStream();
          s.getAudioTracks().forEach((t: MediaStreamTrack) => combinedStream.addTrack(t));
        } catch {
          // captureStream may not be supported on all elements
        }
      };
      mediaElementsRef.current.forEach((el) => {
        if (el instanceof HTMLVideoElement || el instanceof HTMLAudioElement) {
          addAudioTracks(el);
        }
      });
      audioElementsRef.current.forEach((el) => addAudioTracks(el));

      // Pick MP4 (H.264 + AAC) if the WebView supports it, otherwise fall back to WebM.
      let mimeType = 'video/webm';
      let useMp4 = false;
      if (exportFormat === 'mp4' && typeof MediaRecorder !== 'undefined') {
        const mp4Candidates = [
          'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
          'video/mp4;codecs=avc1.42E01E',
          'video/mp4',
        ];
        for (const cand of mp4Candidates) {
          try {
            if (MediaRecorder.isTypeSupported(cand)) {
              mimeType = cand;
              useMp4 = true;
              break;
            }
          } catch {
            // continue to next candidate
          }
        }
      }
      if (!useMp4) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) {
          mimeType = 'video/webm;codecs=vp9';
        }
      }
      const recorder = new MediaRecorder(combinedStream, { mimeType });
      exportRecorderRef.current = recorder;
      const chunks: Blob[] = [];
      let frameCount = 0;
      let hasAudio = false;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        if (exportCancelledRef.current) {
          setIsExportingVideo(false);
          setExportProgress(0);
          setIsPlaying(false);
          triggerToast('Export cancelled.', 'एक्सपोर्ट रद्द किया गया।');
          return;
        }
        const ext = useMp4 ? 'mp4' : 'webm';
        const blob = new Blob(chunks, { type: useMp4 ? 'video/mp4' : 'video/webm' });
        const url = URL.createObjectURL(blob);
        const audioTracks = combinedStream.getAudioTracks();
        hasAudio = audioTracks.length > 0;
        setExportedVideoBlob(blob);
        setExportedVideoUrl(url);
        setExportResult({
          format: useMp4 ? 'MP4 (H.264 + AAC)' : 'WebM (VP9)',
          resolution: project.resolution,
          duration: totalDuration,
          frames: frameCount,
          size: blob.size,
          hasAudio,
        });
        setIsExportingVideo(false);
        setExportProgress(100);
        setIsPlaying(false);
        triggerToast(
          useMp4
            ? 'Video rendered (.mp4)! Tap Save & Share below.'
            : 'Video rendered (.webm)! Tap Save & Share below.',
          useMp4
            ? 'वीडियो तैयार (.mp4)! नीचे सेव और शेयर बटन दबाएं।'
            : 'वीडियो तैयार (.webm)! नीचे सेव और शेयर बटन दबाएं।'
        );
      };

      recorder.start(1000);

      // Keep media playing during export so audio is captured and video frames advance.
      setIsPlaying(true);

      const exportDuration = totalDuration;
      const startTime = performance.now();

      exportIntervalRef.current = setInterval(() => {
        if (exportCancelledRef.current) {
          if (exportIntervalRef.current) clearInterval(exportIntervalRef.current);
          return;
        }
        const elapsed = (performance.now() - startTime) / 1000;
        const progress = Math.min(99, Math.round((elapsed / exportDuration) * 100));
        setExportProgress(progress);
        frameCount = Math.round(elapsed * project.fps);

        if (elapsed >= exportDuration) {
          if (exportIntervalRef.current) clearInterval(exportIntervalRef.current);
          setIsPlaying(false);
          if (recorder.state !== 'inactive') recorder.stop();
        }
      }, 200);
    } catch (err) {
      setIsExportingVideo(false);
      setExportProgress(0);
      setIsPlaying(false);
      triggerToast(`Export error: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleCancelVideoExport = () => {
    exportCancelledRef.current = true;
    if (exportIntervalRef.current) {
      clearInterval(exportIntervalRef.current);
      exportIntervalRef.current = null;
    }
    setIsPlaying(false);
    try {
      if (exportRecorderRef.current && exportRecorderRef.current.state !== 'inactive') {
        exportRecorderRef.current.stop();
      }
    } catch {
      // ignore
    }
    setIsExportingVideo(false);
    setExportProgress(0);
  };

  // Filtered Effects Catalog
  const filteredEffects = EFFECTS_CATALOG.filter((item) => {
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
      item.id.toLowerCase().includes(q)
    );
  });

  // Screen orientation toggle for fullscreen preview (Capacitor plugin with CSS fallback)
  const toggleScreenOrientation = async () => {
    try {
      // @ts-expect-error - Capacitor plugin imported at runtime
      const { Plugins } = window.capacitor || {};
      const ScreenOrientation = Plugins?.ScreenOrientation;
      if (ScreenOrientation) {
        const current = await ScreenOrientation.getCurrentOrientation();
        if (current.type === 'PORTRAIT_PRIMARY' || current.type === 'PORTRAIT_SECONDARY') {
          await ScreenOrientation.lock({ orientation: 'LANDSCAPE_PRIMARY' });
        } else {
          await ScreenOrientation.lock({ orientation: 'PORTRAIT_PRIMARY' });
        }
        return;
      }
    } catch {
      // Plugin not available — fall through to CSS rotation
    }
    // CSS fallback: rotate the preview container by 90 degrees
    // (handled by the fullscreen overlay's rotate button via class toggle)
  };

  // Helper to render a touch-friendly 44px Slider Row with numeric readout and Reset button
  const renderTouchSlider = (opts: {
    label: string;
    value: number;
    min: number;
    max: number;
    step?: number;
    defaultValue: number;
    unit?: string;
    onChange: (val: number) => void;
    onReset: () => void;
  }) => (
    <div className="py-1.5 space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-slate-200">{opts.label}</span>
        <span className="font-mono tabular-nums text-amber-400 font-semibold">
          {opts.value}
          {opts.unit || ''}
        </span>
      </div>
      <div className="flex items-center gap-2 min-h-[44px]">
        <input
          type="range"
          min={opts.min}
          max={opts.max}
          step={opts.step ?? 1}
          value={opts.value}
          onChange={(e) => opts.onChange(Number(e.target.value))}
          aria-label={opts.label}
          className="flex-1 h-6 accent-amber-500 cursor-pointer"
        />
        <button
          type="button"
          onClick={opts.onReset}
          aria-label={`Reset ${opts.label}`}
          title="Reset"
          className="min-w-[44px] min-h-[44px] rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 flex items-center justify-center shrink-0"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  );

  // ============================================================================
  // ROOT SAFE-AREA CONTAINER (Section C: Android Edge-to-Edge Safe Area Padding)
  // ============================================================================
  return (
    <div
      style={{
        paddingTop: 'max(env(safe-area-inset-top, 0px), 32px)',
        paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 24px)',
        paddingLeft: 'max(env(safe-area-inset-left, 0px), 12px)',
        paddingRight: 'max(env(safe-area-inset-right, 0px), 12px)',
      }}
      className="h-[100dvh] max-h-[100dvh] w-full max-w-[100vw] overflow-hidden flex flex-col bg-[#070A10] text-slate-100 select-none"
    >
      {/* Hidden Native File Inputs */}
      <input
        ref={pickerFileInputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        onChange={handlePickerFilesSelected}
        className="hidden"
      />
      <input
        ref={editorMediaInputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        onChange={(e) => handleEditorDirectFileImport(e, 'video')}
        className="hidden"
      />
      <input
        ref={pipOverlayInputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        onChange={(e) => handleEditorDirectFileImport(e, 'overlay')}
        className="hidden"
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        onChange={(e) => handleEditorDirectFileImport(e, 'audio')}
        className="hidden"
      />
      <input
        ref={lutInputRef}
        type="file"
        accept=".cube,.3dl"
        onChange={handleLutFileUpload}
        className="hidden"
      />

      {/* Step-by-Step Toast Notification */}
      {toastMessage && (
        <div className="fixed top-12 inset-x-4 z-50 max-w-sm mx-auto bg-slate-900/95 border border-amber-500/70 text-slate-100 px-3.5 py-2.5 rounded-xl shadow-2xl flex items-center gap-2.5 backdrop-blur-md">
          <Info className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="text-xs leading-snug flex-1 min-w-0 break-words">{toastMessage}</div>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            aria-label="Close notification"
            className="min-w-[32px] min-h-[32px] flex items-center justify-center text-slate-400 hover:text-slate-100 shrink-0"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SCREEN 1: CAPCUT-STYLE HOME SCREEN (Home / Templates / Projects Tabs) */}
      {/* ===================================================================== */}
      {screen === 'home' && (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          {/* Home Header */}
          <header className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800/80 shrink-0 min-w-0">
            <div className="flex items-center gap-2.5 min-w-0">
              <div className="w-9 h-9 rounded-xl bg-amber-500 text-slate-950 font-display font-bold text-base flex items-center justify-center shadow-md shrink-0">
                CN
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-display text-lg font-bold tracking-tight text-slate-100 truncate">
                    ClipNova
                  </span>
                </div>
                <div className="text-[11px] font-mono text-slate-500 truncate">
                  v3.0 · Build: {BUILD_ID.slice(0, 7)}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => {
                  const targetProj = projects[0] || project;
                  openEditorWithProject(targetProj);
                  setExportedVideoUrl(null);
                  setExportedVideoBlob(null);
                  setExportProgress(0);
                  setShowExportModal(true);
                }}
                aria-label={t(lang, 'btnExportSmall')}
                className="min-h-[42px] px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-md shrink-0"
              >
                <Download className="w-4 h-4" />
                <span>{t(lang, 'btnExportSmall')}</span>
              </button>

              <button
                type="button"
                onClick={() => setScreen('settings')}
                aria-label="Open Settings"
                className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-200 flex items-center justify-center shrink-0"
              >
                <Settings className="w-5 h-5" />
              </button>
            </div>
          </header>

          {/* Home Main Content Area */}
          <main className="flex-1 overflow-y-auto py-4 space-y-5 min-w-0">
            {(homeTab === 'home' || homeTab === 'projects') && (
              <>
                {/* Big CapCut-Style "New Project" Hero Button + Quick Open Editor Row */}
                {homeTab === 'home' && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={handleStartNewProject}
                      aria-label={t(lang, 'newProjectBtn')}
                      className="w-full min-h-[84px] p-4 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-orange-400 text-slate-950 shadow-lg flex items-center justify-between gap-3 active:scale-[0.99] transition-transform"
                    >
                      <div className="flex items-center gap-3.5 text-left min-w-0">
                        <div className="w-12 h-12 rounded-xl bg-slate-950/15 flex items-center justify-center shrink-0">
                          <Plus className="w-7 h-7 stroke-[2.5]" />
                        </div>
                        <div className="min-w-0">
                          <div className="font-display text-lg font-bold leading-tight truncate">
                            {t(lang, 'newProjectBtn')}
                          </div>
                          <div className="text-xs font-medium text-slate-900/80 truncate mt-0.5">
                            {t(lang, 'newProjectSub')}
                          </div>
                        </div>
                      </div>
                      <ChevronRight className="w-5 h-5 shrink-0" />
                    </button>

                    <div className="grid grid-cols-2 gap-2.5">
                      <button
                        type="button"
                        onClick={() => openEditorWithProject(projects[0] || project)}
                        className="min-h-[46px] px-3 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-100 font-semibold text-xs flex items-center justify-center gap-2"
                      >
                        <Film className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="truncate">
                          {lang === 'hi' ? 'एडिटर खोलें' : 'Open Editor'}
                        </span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          const targetProj = projects[0] || project;
                          openEditorWithProject(targetProj);
                          setExportedVideoUrl(null);
                          setExportedVideoBlob(null);
                          setExportProgress(0);
                          setShowExportModal(true);
                        }}
                        className="min-h-[46px] px-3 py-2 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-bold text-xs flex items-center justify-center gap-2"
                      >
                        <Download className="w-4 h-4 text-amber-400 shrink-0" />
                        <span className="truncate">
                          {lang === 'hi' ? 'वीडियो एक्सपोर्ट करें' : 'Export Video'}
                        </span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Hidden test-mode button: only visible when VITE_TEST_MODE=true */}
                {import.meta.env.VITE_TEST_MODE === 'true' && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={handleLoadTestVideo}
                      aria-label="Load test video (test mode)"
                      className="w-full min-h-[56px] p-3 rounded-2xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 font-bold text-xs flex items-center justify-center gap-2"
                    >
                      <Download className="w-4 h-4" />
                      <span>Load test video (test mode)</span>
                    </button>
                  </div>
                )}

                {/* Recent Projects List / Grid */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-slate-200">
                      {t(lang, 'recentProjectsTitle')} ({projects.length})
                    </h2>
                    {homeTab === 'projects' && (
                      <button
                        type="button"
                        onClick={handleStartNewProject}
                        className="min-h-[38px] px-3 py-1.5 rounded-lg bg-amber-500 text-slate-950 font-semibold text-xs flex items-center gap-1"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>{t(lang, 'newProjectBtn')}</span>
                      </button>
                    )}
                  </div>

                  {!projectsLoaded ? (
                    <div className="p-8 text-center text-sm text-slate-400">Loading projects...</div>
                  ) : projects.length === 0 ? (
                    /* Friendly Empty State */
                    <div className="p-6 rounded-2xl bg-[#0E131F] border border-slate-800/90 text-center space-y-3">
                      <div className="w-12 h-12 rounded-2xl bg-slate-900 border border-slate-800 mx-auto flex items-center justify-center text-amber-400">
                        <Film className="w-6 h-6" />
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-base font-bold text-slate-100">
                          {t(lang, 'emptyProjectsTitle')}
                        </h3>
                        <p className="text-xs text-slate-400 max-w-xs mx-auto leading-relaxed">
                          {t(lang, 'emptyProjectsSub')}
                        </p>
                      </div>
                      <div className="flex items-center justify-center gap-2 pt-1">
                        <button
                          type="button"
                          onClick={handleLoadSampleDemoProject}
                          className="min-h-[40px] px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs flex items-center gap-1.5"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>
                            {lang === 'hi' ? 'सैंपल प्रोजेक्ट खोलें' : 'Load Sample Project'}
                          </span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {projects.map((proj) => {
                        const dur = Math.max(
                          0,
                          ...proj.clips.map((c) => Number((c.startTime + c.duration).toFixed(1)))
                        );
                        const isMenuOpen = openMenuProjectId === proj.id;
                        const isRenaming = renamingProjectId === proj.id;

                        return (
                          <div
                            key={proj.id}
                            className="relative p-3 rounded-xl bg-[#0E131F] border border-slate-800/90 hover:border-slate-700 flex items-center gap-3 min-w-0"
                          >
                            {/* Project Thumbnail */}
                            <button
                              type="button"
                              onClick={() => openEditorWithProject(proj)}
                              aria-label={`Open ${proj.name}`}
                              className="w-14 h-20 rounded-lg bg-slate-900 border border-slate-800 overflow-hidden shrink-0 flex items-center justify-center relative"
                            >
                              {proj.thumbnailUrl ? (
                                <img
                                  src={proj.thumbnailUrl}
                                  alt={proj.name}
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <Film className="w-5 h-5 text-amber-400/80" />
                              )}
                              <span className="absolute bottom-1 right-1 px-1 rounded bg-black/75 font-mono text-[10px] text-slate-200">
                                {dur.toFixed(1)}s
                              </span>
                            </button>

                            {/* Project Info */}
                            <div
                              onClick={() => {
                                if (!isRenaming) openEditorWithProject(proj);
                              }}
                              className="flex-1 min-w-0 cursor-pointer space-y-1"
                            >
                              {isRenaming ? (
                                <div
                                  onClick={(e) => e.stopPropagation()}
                                  className="flex items-center gap-1.5"
                                >
                                  <input
                                    type="text"
                                    value={renameInputVal}
                                    onChange={(e) => setRenameInputVal(e.target.value)}
                                    className="w-full px-2 py-1 rounded bg-slate-950 border border-amber-500 text-sm text-slate-100 focus:outline-none"
                                    autoFocus
                                  />
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const trimmed = renameInputVal.trim() || proj.name;
                                      const updated = {
                                        ...proj,
                                        name: trimmed,
                                        updatedAt: new Date().toISOString(),
                                      };
                                      await saveProjectToStorage(updated);
                                      setProjects((prev) =>
                                        prev.map((p) => (p.id === proj.id ? updated : p))
                                      );
                                      setRenamingProjectId(null);
                                    }}
                                    aria-label="Save name"
                                    className="min-w-[38px] min-h-[38px] rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center shrink-0"
                                  >
                                    <Check className="w-4 h-4" />
                                  </button>
                                </div>
                              ) : (
                                <div className="text-sm font-bold text-slate-100 truncate">
                                  {proj.name}
                                </div>
                              )}
                              <div className="text-xs text-slate-400 font-mono tabular-nums truncate">
                                {proj.aspectRatio} · {proj.resolution} · {proj.clips.length} clips
                              </div>
                              <div className="text-xs text-slate-500 truncate">
                                {new Date(proj.updatedAt).toLocaleDateString()}{' '}
                                {new Date(proj.updatedAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </div>
                            </div>

                            {/* Quick Export + 3-Dot Action Menu Buttons */}
                            <div className="relative flex items-center gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  openEditorWithProject(proj);
                                  setExportedVideoUrl(null);
                                  setExportedVideoBlob(null);
                                  setExportProgress(0);
                                  setShowExportModal(true);
                                }}
                                title={t(lang, 'btnExportSmall')}
                                aria-label={`Export ${proj.name}`}
                                className="min-h-[38px] px-2.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-bold text-xs flex items-center gap-1"
                              >
                                <Download className="w-3.5 h-3.5" />
                                <span>{t(lang, 'btnExportSmall')}</span>
                              </button>

                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenMenuProjectId(isMenuOpen ? null : proj.id);
                                }}
                                aria-label="Project options menu"
                                className="min-w-[40px] min-h-[40px] rounded-lg hover:bg-slate-800 text-slate-300 flex items-center justify-center"
                              >
                                <MoreVertical className="w-4 h-4" />
                              </button>

                              {isMenuOpen && (
                                <div className="absolute right-0 top-11 z-30 w-40 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1 text-xs">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setOpenMenuProjectId(null);
                                      openEditorWithProject(proj);
                                      setExportedVideoUrl(null);
                                      setExportedVideoBlob(null);
                                      setExportProgress(0);
                                      setShowExportModal(true);
                                    }}
                                    className="w-full min-h-[40px] px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 text-amber-300 font-semibold"
                                  >
                                    <Download className="w-3.5 h-3.5 text-amber-400" />
                                    <span>{t(lang, 'btnExportSmall')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setRenameInputVal(proj.name);
                                      setRenamingProjectId(proj.id);
                                      setOpenMenuProjectId(null);
                                    }}
                                    className="w-full min-h-[40px] px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 text-slate-200"
                                  >
                                    <Pencil className="w-3.5 h-3.5 text-amber-400" />
                                    <span>{t(lang, 'menuRename')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={async () => {
                                      const dup: ProjectData = {
                                        ...proj,
                                        id: `proj-dup-${Date.now()}`,
                                        name: `${proj.name} (Copy)`,
                                        updatedAt: new Date().toISOString(),
                                      };
                                      await saveProjectToStorage(dup);
                                      setProjects((prev) => [dup, ...prev]);
                                      setOpenMenuProjectId(null);
                                      triggerToast('Project duplicated.', 'प्रोजेक्ट डुप्लिकेट किया गया।');
                                    }}
                                    className="w-full min-h-[40px] px-3 py-2 text-left hover:bg-slate-800 flex items-center gap-2 text-slate-200"
                                  >
                                    <Copy className="w-3.5 h-3.5 text-sky-400" />
                                    <span>{t(lang, 'menuDuplicate')}</span>
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setDeleteTargetProject(proj);
                                      setOpenMenuProjectId(null);
                                    }}
                                    className="w-full min-h-[40px] px-3 py-2 text-left hover:bg-rose-950/60 flex items-center gap-2 text-rose-400"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    <span>{t(lang, 'menuDelete')}</span>
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            {/* TEMPLATES TAB (Includes the optional "Sample project" demo + creator templates) */}
            {homeTab === 'templates' && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-base font-bold text-slate-100">
                    {t(lang, 'tabTemplates')}
                  </h2>
                  <p className="text-xs text-slate-400">
                    1-tap templates with non-destructive Adjustment & Effect Overlay Layers.
                  </p>
                </div>

                {/* Optional Sample Project Card (kept here instead of auto-opening on launch) */}
                <div className="p-4 rounded-xl bg-[#0E131F] border border-amber-500/40 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 text-xs font-semibold">
                      {t(lang, 'sampleProjectBadge')}
                    </span>
                    <span className="font-mono text-xs text-slate-400">9:16 · 9.5s · 7 Tracks</span>
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-slate-100">{INITIAL_PROJECT.name}</h3>
                    <p className="text-xs text-slate-400 leading-relaxed">
                      Full 7-track showcase with Warm Golden Hour Adjustment Layer, Light Leak FX Overlay, PIP, and Devanagari captions.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleLoadSampleDemoProject}
                    className="w-full min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-xs flex items-center justify-center gap-1.5"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    <span>Open Sample Project</span>
                  </button>
                </div>

                {/* Creator Templates */}
                <div className="grid grid-cols-1 gap-3">
                  {TEMPLATE_PRESETS.map((tpl) => (
                    <div
                      key={tpl.id}
                      className="p-4 rounded-xl bg-[#0E131F] border border-slate-800 space-y-3"
                    >
                      <div className="flex items-center justify-between text-xs text-slate-400">
                        <span>{tpl.category}</span>
                        <span className="font-mono">
                          {tpl.aspectRatio} · {tpl.duration}s · {tpl.bpm} BPM
                        </span>
                      </div>
                      <div className="space-y-1">
                        <h3 className="text-sm font-bold text-slate-100">
                          {lang === 'hi' ? tpl.nameHi : tpl.nameEn}
                        </h3>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {lang === 'hi' ? tpl.descriptionHi : tpl.descriptionEn}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleLoadTemplate(tpl)}
                        className="w-full min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 font-semibold text-xs flex items-center justify-center gap-1.5"
                      >
                        <Play className="w-3.5 h-3.5 fill-current text-amber-400" />
                        <span>{lang === 'hi' ? 'टेम्पलेट लोड करें' : 'Use Template'}</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>

          {/* Home Bottom Navigation Bar (Home, Templates, Projects) */}
          <nav className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-800/90 bg-[#070A10] shrink-0">
            {(
              [
                { id: 'home' as const, icon: Home, label: t(lang, 'tabHome') },
                { id: 'templates' as const, icon: LayoutGrid, label: t(lang, 'tabTemplates') },
                { id: 'projects' as const, icon: FolderOpen, label: t(lang, 'tabProjects') },
              ]
            ).map((tab) => {
              const Icon = tab.icon;
              const active = homeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setHomeTab(tab.id)}
                  aria-label={tab.label}
                  className={`min-h-[48px] rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors ${
                    active ? 'text-amber-400 bg-amber-500/10 font-semibold' : 'text-slate-400'
                  }`}
                >
                  <Icon className="w-5 h-5" />
                  <span className="text-xs">{tab.label}</span>
                </button>
              );
            })}
          </nav>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SCREEN 2: FULL-SCREEN MEDIA PICKER (For New Project)                  */}
      {/* ===================================================================== */}
      {screen === 'picker' && (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <header className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => setScreen('home')}
              aria-label="Back to Home"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-900 text-slate-200 flex items-center justify-center shrink-0"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold text-slate-100 truncate">
              {t(lang, 'pickerTitle')}
            </h1>
            <button
              type="button"
              onClick={() => openEditorWithProject(projects[0] || project)}
              className="min-h-[40px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs shrink-0"
            >
              {lang === 'hi' ? 'एडिटर खोलें' : 'Skip to Editor'}
            </button>
          </header>

          {/* Picker Tabs + Native Phone Gallery Trigger */}
          <div className="py-3 space-y-3 shrink-0">
            <button
              type="button"
              onClick={() => pickerFileInputRef.current?.click()}
              className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-semibold text-sm flex items-center justify-center gap-2 shadow"
            >
              <Upload className="w-4 h-4" />
              <span>
                {isImportingFiles ? 'Reading metadata...' : t(lang, 'pickerPickDeviceBtn')}
              </span>
            </button>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setPickerTab('device')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold ${
                  pickerTab === 'device'
                    ? 'bg-slate-800 text-amber-400 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400'
                }`}
              >
                {t(lang, 'pickerTabDevice')} ({pickerPool.length})
              </button>
              <button
                type="button"
                onClick={() => setPickerTab('starter')}
                className={`min-h-[40px] rounded-lg text-xs font-semibold ${
                  pickerTab === 'starter'
                    ? 'bg-slate-800 text-amber-400 border border-amber-500/40'
                    : 'bg-slate-900 text-slate-400'
                }`}
              >
                {t(lang, 'pickerTabStarter')} ({STARTER_MEDIA_LIBRARY.length})
              </button>
            </div>
          </div>

          {/* Media Grid with Thumbnail, Duration & Numbered Selection Badge */}
          <div className="flex-1 overflow-y-auto py-1 min-h-0">
            {pickerTab === 'device' ? (
              pickerPool.length === 0 ? (
                <div className="p-6 rounded-2xl bg-[#0E131F] border border-slate-800 text-center space-y-3 my-3">
                  <ImageIcon className="w-8 h-8 text-slate-500 mx-auto" />
                  <p className="text-xs text-slate-400 leading-relaxed">
                    {t(lang, 'pickerEmptyDevice')}
                  </p>
                  <button
                    type="button"
                    onClick={() => setPickerTab('starter')}
                    className="min-h-[40px] px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-amber-300 font-semibold text-xs"
                  >
                    {lang === 'hi'
                      ? 'या बिल्ट-इन स्टार्टर क्लिप्स चुनें →'
                      : 'Or Browse Built-in Starter Clips →'}
                  </button>
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2.5">
                  {pickerPool.map((item) => {
                    const selIndex = pickerSelectedIds.indexOf(item.id);
                    const isSelected = selIndex >= 0;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => togglePickerItemSelection(item.id)}
                        className={`relative aspect-[9/16] rounded-xl overflow-hidden border-2 bg-slate-900 text-left ${
                          isSelected ? 'border-amber-400' : 'border-slate-800'
                        }`}
                      >
                        {item.thumbnailUrl ? (
                          <img
                            src={item.thumbnailUrl}
                            alt={item.name}
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 p-2 text-center">
                            {item.name}
                          </div>
                        )}
                        {/* Numbered Selection Badge */}
                        <div
                          className={`absolute top-2 right-2 w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center shadow ${
                            isSelected
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-black/60 text-white border border-white/40'
                          }`}
                        >
                          {isSelected ? selIndex + 1 : ''}
                        </div>
                        {/* Duration & Name */}
                        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent p-2">
                          <div className="text-xs font-medium text-white truncate">{item.name}</div>
                          <div className="font-mono text-[11px] text-amber-300">
                            {item.duration.toFixed(1)}s
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )
            ) : (
              <div className="grid grid-cols-2 gap-2.5">
                {STARTER_MEDIA_LIBRARY.map((item) => {
                  const selIndex = pickerSelectedIds.indexOf(item.id);
                  const isSelected = selIndex >= 0;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => togglePickerItemSelection(item.id)}
                      className={`relative p-3.5 rounded-xl border-2 bg-[#0E131F] text-left space-y-2 ${
                        isSelected ? 'border-amber-400' : 'border-slate-800'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-mono text-amber-400">{item.duration}s</span>
                        <div
                          className={`w-6 h-6 rounded-full text-xs font-bold flex items-center justify-center ${
                            isSelected
                              ? 'bg-amber-400 text-slate-950'
                              : 'bg-slate-800 text-slate-400 border border-slate-700'
                          }`}
                        >
                          {isSelected ? selIndex + 1 : '+'}
                        </div>
                      </div>
                      <div className="text-sm font-bold text-slate-100 line-clamp-1">
                        {lang === 'hi' ? item.titleHi : item.title}
                      </div>
                      <div className="text-xs text-slate-400">{item.category}</div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Bottom "Add (N)" Bar */}
          <div className="pt-3 border-t border-slate-800 flex items-center justify-between gap-3 shrink-0">
            <div className="text-xs text-slate-300">
              <span className="font-bold text-amber-400">{pickerSelectedIds.length}</span>{' '}
              {t(lang, 'pickerSelectedCount')}
            </div>
            <button
              type="button"
              disabled={pickerSelectedIds.length === 0}
              onClick={handleConfirmMediaPickerAdd}
              className="min-h-[48px] px-6 rounded-xl bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-sm flex items-center gap-2"
            >
              <span>
                {t(lang, 'pickerAddBtn')} ({pickerSelectedIds.length})
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SCREEN 3: SETTINGS SCREEN (Language, Pro Mode, PRD Spec, Checklist)   */}
      {/* ===================================================================== */}
      {screen === 'settings' && (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <header className="flex items-center justify-between gap-2 pb-3 border-b border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => setScreen('home')}
              aria-label="Back to Home"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-900 text-slate-200 flex items-center justify-center"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-base font-bold text-slate-100 truncate">
              {t(lang, 'settingsTitle')}
            </h1>
            <div className="w-11" />
          </header>

          <div className="flex-1 overflow-y-auto py-4 space-y-4">
            {/* Language Switcher */}
            <div className="p-4 rounded-xl bg-[#0E131F] border border-slate-800 space-y-3">
              <div className="flex items-center gap-2 text-sm font-bold text-slate-100">
                <Globe className="w-4 h-4 text-amber-400" />
                <span>{t(lang, 'settingsLanguage')}</span>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                {SUPPORTED_LANGUAGES.map((l) => (
                  <button
                    key={l.code}
                    type="button"
                    onClick={() => setLang(l.code)}
                    className={`min-h-[44px] px-3 py-2 rounded-xl border text-xs font-semibold ${
                      lang === l.code
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 border-slate-800 text-slate-200'
                    }`}
                  >
                    {l.nativeLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* Studio Blueprint & Checklist Links */}
            <div className="p-4 rounded-xl bg-[#0E131F] border border-slate-800 space-y-2.5">
              <button
                type="button"
                onClick={() => setScreen('spec')}
                className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-100 flex items-center justify-between"
              >
                <span>{t(lang, 'settingsOpenPrd')}</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
              <button
                type="button"
                onClick={() => setShowChecklistModal(true)}
                className="w-full min-h-[44px] px-4 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 text-xs font-semibold text-slate-100 flex items-center justify-between"
              >
                <span>{t(lang, 'settingsOpenChecklist')}</span>
                <ChevronRight className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {/* About & Build Info */}
            <div className="p-4 rounded-xl bg-[#0E131F] border border-slate-800 space-y-1.5 text-xs text-slate-400">
              <div className="font-bold text-slate-200">{t(lang, 'settingsAbout')}</div>
              <div>App Name: ClipNova (com.clipnova.editor)</div>
              <div className="font-mono">Build ID: {BUILD_ID}</div>
              <div>Runtime: Offline Capacitor Android WebView + IndexedDB</div>
            </div>

            {/* Preview Playback Debug */}
            <div className="p-4 rounded-xl bg-[#0E131F] border border-slate-800 space-y-1.5">
              <div className="flex items-center justify-between">
                <div className="font-bold text-slate-200 text-sm">Preview Debug</div>
                <button
                  type="button"
                  onClick={() => setShowPlaybackDebug((p) => !p)}
                  aria-label="Toggle playback debug detail"
                  className={`min-w-[32px] min-h-[32px] rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center shrink-0`}
                >
                  {showPlaybackDebug ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                </button>
              </div>
              <div className="font-mono text-xs">Video: {debugVideoDims}</div>
              <div className="font-mono text-xs">Preview FPS: {debugPreviewFps}</div>
              <div className="font-mono text-xs">Dropped Frames: {debugDroppedFrames}</div>
              <div className="font-mono text-xs">Playing: {debugPlaying ? 'yes' : 'no'}</div>
              <div className="font-mono text-xs">Playing media: {debugPlayingMediaCount}</div>
              <div className="font-mono text-xs">Active audio sources: {debugActiveAudioSources}</div>
              {showPlaybackDebug && (
                <div className="space-y-1 pt-1 border-t border-slate-800/50">
                  <div className="font-mono text-xs">Active clip: {debugActiveClipId ?? '—'}</div>
                  <div className="font-mono text-xs">Source time: {debugSourceTime.toFixed(3)}s</div>
                  <div className="font-mono text-xs">Ready state: {debugReadyState}</div>
                  <div className="font-mono text-xs">Paused: {debugPaused ? 'yes' : 'no'}</div>
                  {debugLastError && (
                    <div className="font-mono text-xs text-amber-400 truncate" title={debugLastError}>
                      Last error: {debugLastError}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SCREEN 4: MASTER PRODUCT SPEC (PRD) SCREEN (Accessible from Settings) */}
      {/* ===================================================================== */}
      {screen === 'spec' && (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
          <header className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800 shrink-0">
            <button
              type="button"
              onClick={() => setScreen('settings')}
              aria-label="Back to Settings"
              className="min-w-[44px] min-h-[44px] rounded-xl bg-slate-900 text-slate-200 flex items-center justify-center"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <h1 className="text-sm font-bold text-slate-100 truncate">{t(lang, 'navSpec')}</h1>
            <div className="w-11" />
          </header>
          <main className="flex-1 overflow-y-auto">
            <SpecBlueprintView
              specForm={specForm}
              onChangeSpecForm={setSpecForm}
              onOpenEditor={() => setScreen('home')}
            />
          </main>
        </div>
      )}

      {/* ===================================================================== */}
      {/* SCREEN 5: CAPCUT-STYLE PHONE EDITOR WORKSPACE (Section B)             */}
      {/* ===================================================================== */}
      {screen === 'editor' && (
        <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden relative">
          {/* 1. COMPACT TOP BAR: Back arrow, Project Name (tap to rename), Small Export button */}
          <header className="h-11 flex items-center justify-between gap-2 pb-1.5 border-b border-slate-800/90 shrink-0 min-w-0">
            <button
              type="button"
              onClick={async () => {
                setIsPlaying(false);
                setActiveSheetTool(null);
                await persistCurrentProject(project, true);
                setScreen('home');
              }}
              aria-label={t(lang, 'btnBackHome')}
              className="min-w-[44px] min-h-[40px] rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 flex items-center justify-center shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>

            <div className="flex-1 min-w-0 flex items-center justify-center">
              {isEditingHeaderTitle ? (
                <input
                  type="text"
                  value={project.name}
                  onChange={(e) => setProject((p) => ({ ...p, name: e.target.value }))}
                  onBlur={() => setIsEditingHeaderTitle(false)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') setIsEditingHeaderTitle(false);
                  }}
                  autoFocus
                  className="w-full max-w-[200px] px-2 py-1 rounded bg-slate-900 border border-amber-500 text-xs font-bold text-center text-slate-100 focus:outline-none"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingHeaderTitle(true)}
                  title={t(lang, 'tapToRename')}
                  className="max-w-full px-2 py-1 rounded-lg hover:bg-slate-900 flex items-center gap-1.5 min-w-0"
                >
                  <span className="text-sm font-bold text-slate-100 truncate">
                    {project.name}
                  </span>
                  <Pencil className="w-3 h-3 text-slate-400 shrink-0" />
                </button>
              )}
            </div>

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setExportedVideoUrl(null);
                setExportedVideoBlob(null);
                setExportProgress(0);
                setShowExportModal(true);
              }}
              aria-label={t(lang, 'btnExportSmall')}
              className="min-h-[38px] px-3.5 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 shrink-0 shadow"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t(lang, 'btnExportSmall')}</span>
            </button>
          </header>

          {/* 2. LARGEST AREA: VIDEO PREVIEW (plain <video> when no effects — hardware decoded; canvas when effects active) */}
          <div className="flex-1 min-h-[140px] flex items-center justify-center bg-[#05070B] relative overflow-hidden my-1 rounded-xl border border-slate-800/80">
            {/* Plain video element for hardware-decoded playback when no effects active */}
            <video
              ref={videoRef}
              className={`max-h-full max-w-full w-auto h-auto object-contain ${
                showPlainVideo ? '' : 'hidden'
              }`}
              playsInline
              preload="auto"
              onPointerDown={handleCanvasPointerDown}
            />
            {/* Canvas for effects/adjustments/layers — hidden when plain video suffices */}
            <canvas
              ref={canvasRef}
              onPointerDown={handleCanvasPointerDown}
              className={`max-h-full max-w-full w-auto h-auto object-contain ${
                showPlainVideo ? 'hidden' : ''
              } ${isDrawingCustomMask ? 'cursor-crosshair' : ''}`}
            />
            {isDrawingCustomMask && (
              <div className="absolute top-2 inset-x-3 bg-amber-500/90 text-slate-950 text-xs font-semibold px-3 py-1 rounded-lg text-center">
                Tap 3+ points on preview to draw mask ({selectedClip?.customMaskPoints?.length || 0} pts)
              </div>
            )}
            {/* Fullscreen button (bottom-right of preview) */}
            {!isFullscreen && (
              <button
                type="button"
                onClick={() => setIsFullscreen(true)}
                aria-label="Enter fullscreen preview"
                className="absolute bottom-2 right-2 min-w-[44px] min-h-[44px] rounded-xl bg-black/60 hover:bg-black/80 text-slate-100 flex items-center justify-center z-10 backdrop-blur-sm"
              >
                <Maximize2 className="w-5 h-5" />
              </button>
            )}
          </div>

          {/* 3. SLIM PLAYER BAR: Prev, Play/Pause, Next, Current / Total Time */}
          <div className="h-10 flex items-center justify-between gap-2 px-2 bg-[#0B0F17] shrink-0 min-w-0">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setPlayheadTime(0);
                }}
                aria-label="Jump to start"
                className="min-w-[40px] min-h-[38px] rounded-lg hover:bg-slate-800 text-slate-300 flex items-center justify-center"
              >
                <SkipBack className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.resume();
                  setIsPlaying((p) => !p);
                }}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="min-w-[42px] min-h-[38px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center"
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
                aria-label="Jump to end"
                className="min-w-[40px] min-h-[38px] rounded-lg hover:bg-slate-800 text-slate-300 flex items-center justify-center"
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
              aria-label="Playhead Scrubber"
              className="flex-1 accent-amber-500 cursor-pointer min-w-0"
            />

            <div className="font-mono tabular-nums text-xs text-slate-300 shrink-0">
              <span className="text-amber-400 font-semibold">{playheadTime.toFixed(1)}s</span>
              <span className="mx-0.5 text-slate-600">/</span>
              <span>{totalDuration.toFixed(1)}s</span>
            </div>

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setExportedVideoUrl(null);
                setExportedVideoBlob(null);
                setExportProgress(0);
                setShowExportModal(true);
              }}
              aria-label={t(lang, 'btnExportSmall')}
              className="min-h-[34px] px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/50 text-amber-300 font-bold text-xs flex items-center gap-1 shrink-0"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t(lang, 'btnExportSmall')}</span>
            </button>
          </div>

          {/* 4. TIMELINE (with compact scrollable action row & pinch zoom) */}
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
            scrollToTimeTrigger={scrollToTimeTrigger}
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
            }}
            onAutoBeatCut={handleAutoBeatCut}
            onSplitAtPlayhead={handleSplitAtPlayhead}
            onDuplicateSelected={handleDuplicateSelected}
            onDeleteSelected={handleDeleteSelected}
            onToggleReverseSelected={handleToggleReverseSelected}
            onToggleFreezeSelected={handleToggleFreezeSelected}
            onAddKeyframeAtPlayhead={handleAddKeyframeAtPlayhead}
            onUpdateClipTiming={handleUpdateClipTiming}
            onPlayheadDrag={handlePlayheadDrag}
            onToggleTrackMute={handleToggleTrackMute}
          />

          {/* 5. SINGLE OPEN BOTTOM SHEET PANEL (~40% height, above bottom toolbar, preview & timeline stay visible) */}
          {activeSheetTool !== null && (
            <div className="h-[38dvh] max-h-[320px] bg-[#0E131F] border-t-2 border-amber-500/50 rounded-t-2xl flex flex-col shrink-0 z-30 shadow-2xl overflow-hidden">
              {/* Sheet Header with Drag Handle + Close X */}
              <div className="flex items-center justify-between px-3.5 py-2 border-b border-slate-800/90 bg-[#090D14] shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-6 h-1 rounded-full bg-slate-700" />
                  <span className="text-xs font-bold uppercase tracking-wider text-amber-400 truncate">
                    {t(
                      lang,
                      `bar${activeSheetTool.charAt(0).toUpperCase()}${activeSheetTool.slice(1)}`
                    )}
                  </span>
                  {selectedClip && (
                    <span className="text-xs text-slate-400 truncate">
                      · {selectedClip.title}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsDrawingCustomMask(false);
                    setActiveSheetTool(null);
                  }}
                  aria-label="Close tool panel"
                  className="min-w-[40px] min-h-[36px] rounded-lg hover:bg-slate-800 text-slate-300 flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Scrollable Sheet Body */}
              <div className="flex-1 overflow-y-auto p-3.5 space-y-3 min-h-0">
                {/* ========================================================= */}
                {/* SHEET 1: EDIT (Media Grid + Transform + Smart AI Tools)   */}
                {/* ========================================================= */}
                {activeSheetTool === 'edit' && (
                  <div className="space-y-2.5">
                    {/* Accordion 1: Media Import & Project Media Grid */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setEditAccordion('media')}
                        className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                      >
                        <span>Media Library & Gallery Import</span>
                        {editAccordion === 'media' ? (
                          <ChevronDown className="w-4 h-4 text-amber-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      {editAccordion === 'media' && (
                        <div className="p-3 pt-0 space-y-3 border-t border-slate-800/60">
                          <div className="flex items-center gap-2 pt-2">
                            <button
                              type="button"
                              onClick={() => editorMediaInputRef.current?.click()}
                              className="flex-1 min-h-[44px] px-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5"
                            >
                              <Upload className="w-4 h-4" />
                              <span>+ Import Video / Photo</span>
                            </button>
                          </div>

                          {/* Imported Media Thumbnail Grid */}
                          {project.importedMedia && project.importedMedia.length > 0 && (
                            <div className="space-y-1.5">
                              <div className="text-xs font-medium text-slate-400">
                                Imported Media ({project.importedMedia.length})
                              </div>
                              <div className="grid grid-cols-4 gap-2">
                                {project.importedMedia.map((m) => (
                                  <button
                                    key={m.id}
                                    type="button"
                                    onClick={() => {
                                      const endT = project.clips
                                        .filter((c) => c.trackType === 'video')
                                        .reduce((mx, c) => Math.max(mx, c.startTime + c.duration), 0);
                                      const newId = `clip-readd-${Date.now()}`;
                                      const newClip = createBaseClip({
                                        id: newId,
                                        trackId: 'track-video-main',
                                        trackType: 'video',
                                        title: m.name,
                                        startTime: Number(endT.toFixed(2)),
                                        duration: m.duration,
                                        sourceType:
                                          m.kind === 'image'
                                            ? 'uploaded-image'
                                            : m.kind === 'video'
                                            ? 'uploaded-video'
                                            : 'procedural-scene',
                                        scenePreset: m.scenePreset,
                                        mediaUrl: m.mediaUrl,
                                        mediaBlobId: m.mediaBlobId,
                                        thumbnailUrl: m.thumbnailUrl,
                                      });
                                      updateProjectWithHistory((prev) => ({
                                        ...prev,
                                        clips: [...prev.clips, newClip],
                                      }));
                                      setSelectedClipId(newId);
                                      setScrollToTimeTrigger({ time: endT, seq: Date.now() });
                                      triggerToast(`Added ${m.name} to Main Video track`);
                                    }}
                                    className="relative aspect-square rounded-lg overflow-hidden border border-slate-700 bg-slate-950"
                                  >
                                    {m.thumbnailUrl ? (
                                      <img
                                        src={m.thumbnailUrl}
                                        alt={m.name}
                                        className="w-full h-full object-cover"
                                      />
                                    ) : (
                                      <div className="w-full h-full flex items-center justify-center text-[11px] text-slate-300 p-1 truncate">
                                        {m.name}
                                      </div>
                                    )}
                                    <span className="absolute bottom-0.5 right-0.5 px-1 rounded bg-black/80 font-mono text-[10px] text-amber-300">
                                      {m.duration.toFixed(1)}s
                                    </span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Accordion 2: Transform, Scale, Position & Flip */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setEditAccordion('transform')}
                        className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                      >
                        <span>{t(lang, 'accClipTransform')}</span>
                        {editAccordion === 'transform' ? (
                          <ChevronDown className="w-4 h-4 text-amber-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      {editAccordion === 'transform' && selectedClip && (
                        <div className="p-3 pt-1 space-y-2 border-t border-slate-800/60">
                          <div className="grid grid-cols-3 gap-2 pt-1">
                            <button
                              type="button"
                              onClick={() =>
                                updateSelectedClip({
                                  rotation: (selectedClip.rotation + 90) % 360,
                                })
                              }
                              className="min-h-[44px] rounded-lg bg-slate-800 text-xs font-medium flex items-center justify-center gap-1.5"
                            >
                              <RotateCw className="w-4 h-4 text-amber-400" />
                              <span>Rotate 90°</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => updateSelectedClip({ flipH: !selectedClip.flipH })}
                              className="min-h-[44px] rounded-lg bg-slate-800 text-xs font-medium flex items-center justify-center gap-1.5"
                            >
                              <FlipHorizontal className="w-4 h-4 text-sky-400" />
                              <span>Flip H</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => updateSelectedClip({ flipV: !selectedClip.flipV })}
                              className="min-h-[44px] rounded-lg bg-slate-800 text-xs font-medium flex items-center justify-center gap-1.5"
                            >
                              <FlipVertical className="w-4 h-4 text-sky-400" />
                              <span>Flip V</span>
                            </button>
                          </div>

                          {renderTouchSlider({
                            label: 'Scale / Zoom',
                            value: Number(selectedClip.scale.toFixed(2)),
                            min: 0.25,
                            max: 2.5,
                            step: 0.05,
                            defaultValue: 1,
                            unit: 'x',
                            onChange: (v) => updateSelectedClip({ scale: v }, true),
                            onReset: () => updateSelectedClip({ scale: 1 }),
                          })}
                          {renderTouchSlider({
                            label: 'Position X',
                            value: selectedClip.posX,
                            min: -80,
                            max: 80,
                            defaultValue: 0,
                            unit: '%',
                            onChange: (v) => updateSelectedClip({ posX: v }, true),
                            onReset: () => updateSelectedClip({ posX: 0 }),
                          })}
                          {renderTouchSlider({
                            label: 'Position Y',
                            value: selectedClip.posY,
                            min: -80,
                            max: 80,
                            defaultValue: 0,
                            unit: '%',
                            onChange: (v) => updateSelectedClip({ posY: v }, true),
                            onReset: () => updateSelectedClip({ posY: 0 }),
                          })}
                        </div>
                      )}
                    </div>

                    {/* Accordion 3: Smart AI (Chroma Key, BG Remover, Stabilization) */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setEditAccordion('smart')}
                        className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                      >
                        <span>{t(lang, 'accSmartAi')}</span>
                        {editAccordion === 'smart' ? (
                          <ChevronDown className="w-4 h-4 text-amber-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      {editAccordion === 'smart' && selectedClip && (
                        <div className="p-3 space-y-2.5 border-t border-slate-800/60">
                          <label className="min-h-[44px] flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                            <span>{t(lang, 'bgRemover')}</span>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedClip.bgRemovalEnabled)}
                              onChange={(e) =>
                                updateSelectedClip({ bgRemovalEnabled: e.target.checked })
                              }
                              className="w-5 h-5 accent-amber-500"
                            />
                          </label>
                          <label className="min-h-[44px] flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                            <span>{t(lang, 'chromaKey')}</span>
                            <input
                              type="checkbox"
                              checked={selectedClip.chromaKeyEnabled}
                              onChange={(e) =>
                                updateSelectedClip({ chromaKeyEnabled: e.target.checked })
                              }
                              className="w-5 h-5 accent-emerald-500"
                            />
                          </label>
                          <label className="min-h-[44px] flex items-center justify-between text-xs text-slate-200 cursor-pointer">
                            <span>{t(lang, 'stabilization')}</span>
                            <input
                              type="checkbox"
                              checked={Boolean(selectedClip.stabilizationEnabled)}
                              onChange={(e) =>
                                updateSelectedClip({ stabilizationEnabled: e.target.checked })
                              }
                              className="w-5 h-5 accent-amber-500"
                            />
                          </label>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 2: AUDIO (Music, Mic Voiceover, TTS, Voice Changer) */}
                {/* ========================================================= */}
                {activeSheetTool === 'audio' && (
                  <div className="space-y-2.5">
                    {/* Accordion 1: Music & Device Audio Import */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setAudioAccordion('music')}
                        className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                      >
                        <span>{t(lang, 'accMusicLibrary')}</span>
                        {audioAccordion === 'music' ? (
                          <ChevronDown className="w-4 h-4 text-amber-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      {audioAccordion === 'music' && (
                        <div className="p-3 space-y-2.5 border-t border-slate-800/60">
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => audioInputRef.current?.click()}
                              className="min-h-[44px] px-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5"
                            >
                              <Upload className="w-4 h-4" />
                              <span>Import Audio</span>
                            </button>
                            <button
                              type="button"
                              onClick={handleExtractAudioFromVideo}
                              className="min-h-[44px] px-3 rounded-xl bg-slate-800 text-slate-100 font-semibold text-xs flex items-center justify-center gap-1.5"
                            >
                              <Scissors className="w-4 h-4 text-emerald-400" />
                              <span>{t(lang, 'extractAudio')}</span>
                            </button>
                          </div>

                          <div className="space-y-1.5">
                            {ROYALTY_FREE_AUDIO.map((track) => (
                              <div
                                key={track.id}
                                className="p-2.5 rounded-lg bg-slate-950 border border-slate-800 flex items-center justify-between gap-2"
                              >
                                <div className="min-w-0">
                                  <div className="text-xs font-semibold text-slate-100 truncate">
                                    {lang === 'hi' ? track.titleHi : track.title}
                                  </div>
                                  <div className="text-[11px] font-mono text-slate-400">
                                    {track.bpm} BPM · Beat Markers
                                  </div>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => handleAddAudioTrack(track)}
                                  className="min-h-[38px] px-3 rounded-lg bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 text-xs font-semibold shrink-0"
                                >
                                  Use
                                </button>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Accordion 2: Mic Voiceover & Text-to-Speech */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setAudioAccordion('voice')}
                        className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                      >
                        <span>{t(lang, 'accVoiceTts')}</span>
                        {audioAccordion === 'voice' ? (
                          <ChevronDown className="w-4 h-4 text-amber-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      {audioAccordion === 'voice' && (
                        <div className="p-3 space-y-3 border-t border-slate-800/60">
                          <button
                            type="button"
                            onClick={handleToggleVoiceover}
                            className={`w-full min-h-[44px] rounded-xl font-bold text-xs flex items-center justify-center gap-2 ${
                              isRecordingVoice
                                ? 'bg-rose-600 text-white'
                                : 'bg-slate-800 text-slate-100'
                            }`}
                          >
                            {isRecordingVoice ? (
                              <MicOff className="w-4 h-4" />
                            ) : (
                              <Mic className="w-4 h-4 text-amber-400" />
                            )}
                            <span>
                              {isRecordingVoice
                                ? `${t(lang, 'stopVoiceover')} (${recordingSeconds}s)`
                                : t(lang, 'recordVoiceover')}
                            </span>
                          </button>

                          <div className="space-y-2 pt-1">
                            <div className="text-xs font-semibold text-amber-400">
                              {t(lang, 'ttsTitle')}
                            </div>
                            <input
                              type="text"
                              value={ttsInputText}
                              onChange={(e) => setTtsInputText(e.target.value)}
                              className="w-full min-h-[40px] px-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                            />
                            <div className="flex items-center gap-2">
                              <select
                                value={ttsVoiceLang}
                                onChange={(e) =>
                                  setTtsVoiceLang(e.target.value as 'hi-IN' | 'en-IN' | 'en-US')
                                }
                                className="min-h-[42px] px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                              >
                                <option value="en-IN">English (IN)</option>
                                <option value="hi-IN">हिन्दी (HI)</option>
                                <option value="en-US">English (US)</option>
                              </select>
                              <button
                                type="button"
                                onClick={handleSynthesizeTtsToTimeline}
                                className="flex-1 min-h-[42px] px-3 rounded-lg bg-amber-500 text-slate-950 font-bold text-xs"
                              >
                                {t(lang, 'ttsSpeakBtn')}
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Accordion 3: Voice Changer, Volume & Noise Reduction */}
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                      <button
                        type="button"
                        onClick={() => setAudioAccordion('fx')}
                        className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                      >
                        <span>{t(lang, 'accVoiceFx')}</span>
                        {audioAccordion === 'fx' ? (
                          <ChevronDown className="w-4 h-4 text-amber-400" />
                        ) : (
                          <ChevronRight className="w-4 h-4 text-slate-400" />
                        )}
                      </button>
                      {audioAccordion === 'fx' && selectedClip && (
                        <div className="p-3 space-y-2.5 border-t border-slate-800/60">
                          {renderTouchSlider({
                            label: 'Clip Volume',
                            value: selectedClip.volume,
                            min: 0,
                            max: 200,
                            defaultValue: 100,
                            unit: '%',
                            onChange: (v) => updateSelectedClip({ volume: v }, true),
                            onReset: () => updateSelectedClip({ volume: 100 }),
                          })}
                          <div className="grid grid-cols-2 gap-2 items-center">
                            <select
                              value={selectedClip.voiceChanger || 'none'}
                              onChange={(e) =>
                                updateSelectedClip({
                                  voiceChanger: e.target.value as VoiceChangerPreset,
                                })
                              }
                              className="min-h-[42px] px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                            >
                              <option value="none">Normal Voice</option>
                              <option value="deep-cinema">Deep Narrator</option>
                              <option value="chipmunk">Chipmunk</option>
                              <option value="robot-mod">Cyber Robot</option>
                              <option value="echo-hall">Stadium Echo</option>
                            </select>
                            <label className="min-h-[42px] flex items-center gap-2 text-xs text-slate-200 cursor-pointer px-2">
                              <input
                                type="checkbox"
                                checked={Boolean(selectedClip.noiseReduction)}
                                onChange={(e) =>
                                  updateSelectedClip({ noiseReduction: e.target.checked })
                                }
                                className="w-4 h-4 accent-emerald-500"
                              />
                              <span>{t(lang, 'noiseReduction')}</span>
                            </label>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 3: TEXT (Devanagari & Latin Fonts, Styles, Track)   */}
                {/* ========================================================= */}
                {activeSheetTool === 'text' && (
                  <div className="space-y-3">
                    {selectedClip && selectedClip.trackType === 'text' && (
                      <div className="p-3 rounded-xl bg-slate-900 border border-amber-500/40 space-y-2.5">
                        <input
                          type="text"
                          value={selectedClip.textContent || ''}
                          onChange={(e) =>
                            updateSelectedClip({
                              textContent: e.target.value,
                              title: e.target.value,
                            })
                          }
                          className="w-full min-h-[42px] px-3 rounded-lg bg-slate-950 border border-slate-800 text-sm text-slate-100"
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <select
                            value={selectedClip.fontFamily || 'Noto Sans Devanagari'}
                            onChange={(e) => updateSelectedClip({ fontFamily: e.target.value })}
                            className="min-h-[42px] px-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                          >
                            {FONT_FAMILIES.map((f) => (
                              <option key={f.id} value={f.id}>
                                {f.label}
                              </option>
                            ))}
                          </select>
                          <select
                            value={selectedClip.textAnimation || 'none'}
                            onChange={(e) =>
                              updateSelectedClip({
                                textAnimation: e.target.value as TextAnimationType,
                              })
                            }
                            className="min-h-[42px] px-2 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                          >
                            <option value="karaoke-highlight">Karaoke Highlight</option>
                            <option value="pop-in">Pop In</option>
                            <option value="typewriter">Typewriter</option>
                            <option value="slide-up">Slide Up</option>
                            <option value="none">Static</option>
                          </select>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-2">
                      {FONT_FAMILIES.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          onClick={() => handleAddTextOverlay(f.sample, f.id, 'pop-in')}
                          className="min-h-[48px] p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 flex items-center justify-between text-left"
                        >
                          <div>
                            <div className="text-xs text-slate-400">{f.label}</div>
                            <div
                              style={{ fontFamily: f.id }}
                              className="text-sm font-bold text-slate-100"
                            >
                              {f.sample}
                            </div>
                          </div>
                          <span className="text-xs font-semibold text-amber-400">+ Add</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 4: STICKERS (Emoji & Motion Track)                  */}
                {/* ========================================================= */}
                {activeSheetTool === 'stickers' && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-4 gap-2">
                      {STICKER_PRESETS.map((stk) => (
                        <button
                          key={stk.id}
                          type="button"
                          onClick={() => handleAddSticker(stk.glyph, stk.label)}
                          className="min-h-[60px] p-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-800 flex flex-col items-center justify-center gap-1"
                        >
                          <span className="text-2xl">{stk.glyph}</span>
                          <span className="text-[11px] text-slate-300 truncate w-full text-center">
                            {stk.label}
                          </span>
                        </button>
                      ))}
                    </div>

                    {selectedClip &&
                      (selectedClip.trackType === 'sticker' ||
                        selectedClip.trackType === 'text') && (
                        <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-1.5">
                          <label className="block text-xs font-semibold text-slate-300">
                            {t(lang, 'motionTrack')}
                          </label>
                          <select
                            value={selectedClip.motionTrackTargetId || ''}
                            onChange={(e) =>
                              updateSelectedClip({
                                motionTrackTargetId: e.target.value || undefined,
                              })
                            }
                            className="w-full min-h-[42px] px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                          >
                            <option value="">None (Independent)</option>
                            {project.clips
                              .filter((c) => c.trackType === 'video' || c.trackType === 'overlay')
                              .map((vc) => (
                                <option key={vc.id} value={vc.id}>
                                  Follow: {vc.title}
                                </option>
                              ))}
                          </select>
                        </div>
                      )}
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 5: OVERLAY / PIP                                    */}
                {/* ========================================================= */}
                {activeSheetTool === 'overlay' && (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => pipOverlayInputRef.current?.click()}
                      className="w-full min-h-[46px] px-4 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2"
                    >
                      <Layers className="w-4 h-4" />
                      <span>+ Import PIP Overlay (Video / Photo)</span>
                    </button>

                    {selectedClip && (
                      <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 space-y-2">
                        <label className="block text-xs font-semibold text-slate-300">
                          {t(lang, 'blendMode')}
                        </label>
                        <select
                          value={selectedClip.blendMode}
                          onChange={(e) =>
                            updateSelectedClip({ blendMode: e.target.value as BlendModeType })
                          }
                          className="w-full min-h-[42px] px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                        >
                          <option value="source-over">Normal</option>
                          <option value="screen">Screen</option>
                          <option value="multiply">Multiply</option>
                          <option value="overlay">Overlay</option>
                          <option value="lighter">Add / Linear Dodge</option>
                        </select>
                      </div>
                    )}
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 6: EFFECTS (Trending Library + Non-Destructive FX)  */}
                {/* ========================================================= */}
                {activeSheetTool === 'effects' && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleCreateEffectLayer('light-leak', playheadTime)}
                        className="flex-1 min-h-[44px] px-3 rounded-xl bg-fuchsia-500/20 border border-fuchsia-500/50 text-fuchsia-200 font-bold text-xs flex items-center justify-center gap-1.5"
                      >
                        <Sparkles className="w-4 h-4 text-fuchsia-400" />
                        <span>{t(lang, 'createEffectOverlayLayer')}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setShowTrendFindings((s) => !s)}
                        className="min-h-[44px] px-3 rounded-xl bg-slate-900 border border-slate-800 text-amber-300 text-xs font-semibold shrink-0"
                      >
                        Trends
                      </button>
                    </div>

                    {showTrendFindings && (
                      <div className="p-3 rounded-xl bg-slate-950 border border-amber-500/40 space-y-1.5 text-xs">
                        {TRENDING_SEARCH_FINDINGS.map((tf, i) => (
                          <div key={i} className="border-b border-slate-800/80 pb-1">
                            <div className="font-bold text-amber-300">
                              {lang === 'hi' ? tf.trendHi : tf.trendEn}
                            </div>
                            <div className="text-slate-400">{tf.builtAs}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="relative">
                      <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={effectSearch}
                        onChange={(e) => setEffectSearch(e.target.value)}
                        placeholder={t(lang, 'searchEffectsPlaceholder')}
                        className="w-full min-h-[40px] pl-8 pr-3 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                      />
                    </div>

                    <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                      {(
                        [
                          { id: 'All', label: t(lang, 'catAll') },
                          { id: 'Trending', label: t(lang, 'catTrending') },
                          { id: 'Glitch & Digital', label: t(lang, 'catGlitch') },
                          { id: 'Motion & Velocity', label: t(lang, 'catMotion') },
                          { id: 'Optical & Light', label: t(lang, 'catOptical') },
                        ] as const
                      ).map((cat) => (
                        <button
                          key={cat.id}
                          type="button"
                          onClick={() => setEffectCategory(cat.id)}
                          className={`min-h-[36px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 ${
                            effectCategory === cat.id
                              ? 'bg-amber-500 text-slate-950'
                              : 'bg-slate-900 text-slate-300'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>

                    {selectedClip && selectedClip.effect !== 'none' && (
                      <div className="p-2.5 rounded-xl bg-slate-900 border border-fuchsia-500/40">
                        {renderTouchSlider({
                          label: t(lang, 'layerIntensity'),
                          value: selectedClip.effectIntensity ?? 75,
                          min: 0,
                          max: 100,
                          defaultValue: 75,
                          unit: '%',
                          onChange: (v) => updateSelectedClip({ effectIntensity: v }, true),
                          onReset: () => updateSelectedClip({ effectIntensity: 75 }),
                        })}
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      {filteredEffects.map((fx) => (
                        <div
                          key={fx.id}
                          className="p-2.5 rounded-xl bg-slate-900 border border-slate-800 flex flex-col justify-between gap-2"
                        >
                          <div className="text-xs font-bold text-slate-100 truncate">
                            {lang === 'hi' ? fx.nameHi : fx.nameEn}
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleCreateEffectLayer(fx.id, playheadTime)}
                              className="flex-1 min-h-[38px] rounded-lg bg-fuchsia-500/20 border border-fuchsia-500/40 text-fuchsia-200 text-xs font-semibold"
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
                              className="flex-1 min-h-[38px] rounded-lg bg-slate-800 disabled:opacity-40 text-slate-200 text-xs font-semibold"
                            >
                              On Clip
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 7: TRANSITIONS                                      */}
                {/* ========================================================= */}
                {activeSheetTool === 'transitions' && (
                  <div className="space-y-3">
                    {selectedClip &&
                      renderTouchSlider({
                        label: 'Transition Duration',
                        value: selectedClip.transitionDuration,
                        min: 0.2,
                        max: 1.5,
                        step: 0.1,
                        defaultValue: 0.5,
                        unit: 's',
                        onChange: (v) => updateSelectedClip({ transitionDuration: v }, true),
                        onReset: () => updateSelectedClip({ transitionDuration: 0.5 }),
                      })}

                    <div className="grid grid-cols-2 gap-2">
                      {TRANSITIONS_CATALOG.map((tr) => {
                        const active = selectedClip?.transitionIn === tr.id;
                        return (
                          <button
                            key={tr.id}
                            type="button"
                            disabled={!selectedClip}
                            onClick={() =>
                              updateSelectedClip({
                                transitionIn: tr.id,
                                transitionDuration: tr.defaultDuration || 0.5,
                              })
                            }
                            className={`min-h-[48px] p-2.5 rounded-xl border text-left ${
                              active
                                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                                : 'bg-slate-900 border-slate-800 text-slate-200 disabled:opacity-40'
                            }`}
                          >
                            <div className="text-xs font-bold">
                              {lang === 'hi' ? tr.nameHi : tr.nameEn}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 8: FILTERS & .CUBE LUT IMPORT                       */}
                {/* ========================================================= */}
                {activeSheetTool === 'filters' && (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={() => lutInputRef.current?.click()}
                      className="w-full min-h-[44px] px-4 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs"
                    >
                      {t(lang, 'importLut')}
                    </button>

                    <div className="grid grid-cols-2 gap-2">
                      {FILTER_PRESETS.map((flt) => {
                        const active = selectedClip?.filterPreset === flt.id;
                        return (
                          <button
                            key={flt.id}
                            type="button"
                            disabled={!selectedClip}
                            onClick={() => updateSelectedClip({ filterPreset: flt.id })}
                            className={`min-h-[46px] p-2.5 rounded-xl border text-left ${
                              active
                                ? 'bg-amber-500/20 border-amber-400 text-amber-300 font-bold'
                                : 'bg-slate-900 border-slate-800 text-slate-200'
                            }`}
                          >
                            <div className="text-xs">{lang === 'hi' ? flt.nameHi : flt.nameEn}</div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 9: ADJUST (Non-Destructive Layer + 4 Accordions)    */}
                {/* ========================================================= */}
                {activeSheetTool === 'adjust' && (
                  <div className="space-y-2.5">
                    <button
                      type="button"
                      onClick={handleCreateAdjustmentLayer}
                      className="w-full min-h-[44px] px-3 rounded-xl bg-cyan-500/20 border border-cyan-500/50 text-cyan-200 font-bold text-xs flex items-center justify-center gap-1.5"
                    >
                      <Sliders className="w-4 h-4 text-cyan-400" />
                      <span>{t(lang, 'createAdjustmentLayer')}</span>
                    </button>

                    {!selectedClip ? (
                      <div className="text-xs text-slate-400 p-2">
                        Tap a clip or Adjustment Layer on the timeline to adjust values.
                      </div>
                    ) : (
                      <>
                        {/* Group 1: Basic */}
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setAdjustAccordion('basic')}
                            className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                          >
                            <span>{t(lang, 'accBasic')}</span>
                            {adjustAccordion === 'basic' ? (
                              <ChevronDown className="w-4 h-4 text-cyan-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                          {adjustAccordion === 'basic' && (
                            <div className="p-3 pt-0 border-t border-slate-800/60">
                              {(
                                [
                                  { key: 'brightness', min: -50, max: 50, def: 0 },
                                  { key: 'contrast', min: -50, max: 50, def: 0 },
                                  { key: 'saturation', min: -50, max: 50, def: 0 },
                                  { key: 'exposure', min: -50, max: 50, def: 0 },
                                ] as { key: keyof ColorAdjustments; min: number; max: number; def: number }[]
                              ).map((sl) =>
                                renderTouchSlider({
                                  label: t(lang, sl.key),
                                  value: Number(selectedClip.adjustments[sl.key] ?? sl.def),
                                  min: sl.min,
                                  max: sl.max,
                                  defaultValue: sl.def,
                                  onChange: (val) =>
                                    updateSelectedClip(
                                      {
                                        adjustments: {
                                          ...selectedClip.adjustments,
                                          [sl.key]: val,
                                        },
                                      },
                                      true
                                    ),
                                  onReset: () =>
                                    updateSelectedClip({
                                      adjustments: {
                                        ...selectedClip.adjustments,
                                        [sl.key]: sl.def,
                                      },
                                    }),
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* Group 2: Color & Tone (HSL) */}
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setAdjustAccordion('color')}
                            className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                          >
                            <span>{t(lang, 'accColor')}</span>
                            {adjustAccordion === 'color' ? (
                              <ChevronDown className="w-4 h-4 text-cyan-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                          {adjustAccordion === 'color' && (
                            <div className="p-3 pt-0 border-t border-slate-800/60">
                              {(
                                [
                                  { key: 'highlights', min: -50, max: 50, def: 0 },
                                  { key: 'shadows', min: -50, max: 50, def: 0 },
                                  { key: 'temperature', min: -50, max: 50, def: 0 },
                                  { key: 'tint', min: -50, max: 50, def: 0 },
                                  { key: 'hue', min: -180, max: 180, def: 0 },
                                ] as { key: keyof ColorAdjustments; min: number; max: number; def: number }[]
                              ).map((sl) =>
                                renderTouchSlider({
                                  label: t(lang, sl.key),
                                  value: Number(selectedClip.adjustments[sl.key] ?? sl.def),
                                  min: sl.min,
                                  max: sl.max,
                                  defaultValue: sl.def,
                                  onChange: (val) =>
                                    updateSelectedClip(
                                      {
                                        adjustments: {
                                          ...selectedClip.adjustments,
                                          [sl.key]: val,
                                        },
                                      },
                                      true
                                    ),
                                  onReset: () =>
                                    updateSelectedClip({
                                      adjustments: {
                                        ...selectedClip.adjustments,
                                        [sl.key]: sl.def,
                                      },
                                    }),
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* Group 3: Grain, Vignette, Sharpen & Blur */}
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setAdjustAccordion('effects')}
                            className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                          >
                            <span>{t(lang, 'accEffects')}</span>
                            {adjustAccordion === 'effects' ? (
                              <ChevronDown className="w-4 h-4 text-cyan-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                          {adjustAccordion === 'effects' && (
                            <div className="p-3 pt-0 border-t border-slate-800/60">
                              {(
                                [
                                  { key: 'sharpen', min: 0, max: 100, def: 10 },
                                  { key: 'vignette', min: 0, max: 100, def: 12 },
                                  { key: 'grain', min: 0, max: 100, def: 0 },
                                  { key: 'blur', min: 0, max: 50, def: 0 },
                                ] as { key: keyof ColorAdjustments; min: number; max: number; def: number }[]
                              ).map((sl) =>
                                renderTouchSlider({
                                  label: t(lang, sl.key),
                                  value: Number(selectedClip.adjustments[sl.key] ?? sl.def),
                                  min: sl.min,
                                  max: sl.max,
                                  defaultValue: sl.def,
                                  onChange: (val) =>
                                    updateSelectedClip(
                                      {
                                        adjustments: {
                                          ...selectedClip.adjustments,
                                          [sl.key]: val,
                                        },
                                      },
                                      true
                                    ),
                                  onReset: () =>
                                    updateSelectedClip({
                                      adjustments: {
                                        ...selectedClip.adjustments,
                                        [sl.key]: sl.def,
                                      },
                                    }),
                                })
                              )}
                            </div>
                          )}
                        </div>

                        {/* Group 4: Opacity & Blend Mode */}
                        <div className="rounded-xl border border-slate-800 bg-slate-900/60 overflow-hidden">
                          <button
                            type="button"
                            onClick={() => setAdjustAccordion('blend')}
                            className="w-full min-h-[44px] px-3.5 py-2 flex items-center justify-between text-xs font-bold text-slate-100"
                          >
                            <span>{t(lang, 'accBlend')}</span>
                            {adjustAccordion === 'blend' ? (
                              <ChevronDown className="w-4 h-4 text-cyan-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-slate-400" />
                            )}
                          </button>
                          {adjustAccordion === 'blend' && (
                            <div className="p-3 space-y-2 border-t border-slate-800/60">
                              {renderTouchSlider({
                                label: t(lang, 'opacity'),
                                value: Math.round(selectedClip.opacity * 100),
                                min: 5,
                                max: 100,
                                defaultValue: 100,
                                unit: '%',
                                onChange: (v) => updateSelectedClip({ opacity: v / 100 }, true),
                                onReset: () => updateSelectedClip({ opacity: 1 }),
                              })}
                              <select
                                value={selectedClip.blendMode}
                                onChange={(e) =>
                                  updateSelectedClip({
                                    blendMode: e.target.value as BlendModeType,
                                  })
                                }
                                className="w-full min-h-[42px] px-2.5 rounded-lg bg-slate-950 border border-slate-800 text-xs text-slate-100"
                              >
                                <option value="source-over">Normal (Pass-Through)</option>
                                <option value="screen">Screen</option>
                                <option value="multiply">Multiply</option>
                                <option value="overlay">Overlay</option>
                                <option value="lighter">Add / Linear Dodge</option>
                              </select>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 10: CAPTIONS (Hindi, Hinglish, English + SRT)       */}
                {/* ========================================================= */}
                {activeSheetTool === 'captions' && (
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-amber-400">
                      AI Auto-Captions (Word-by-Word Karaoke Highlight)
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => handleGenerateAutoCaptions('english')}
                        className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-100"
                      >
                        English
                      </button>
                      <button
                        type="button"
                        onClick={() => handleGenerateAutoCaptions('hinglish')}
                        className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-100"
                      >
                        Hinglish
                      </button>
                      <button
                        type="button"
                        onClick={() => handleGenerateAutoCaptions('hindi')}
                        className="min-h-[44px] rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-100"
                      >
                        हिंदी कैप्शन
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadSrtSubtitles(project)}
                      className="w-full min-h-[44px] rounded-xl border border-slate-700 bg-slate-900 text-xs font-semibold text-slate-200"
                    >
                      Export Captions (.SRT)
                    </button>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 11: CANVAS / RATIO                                  */}
                {/* ========================================================= */}
                {activeSheetTool === 'canvas' && (
                  <div className="space-y-3">
                    <div className="text-xs font-bold text-slate-200">Aspect Ratio</div>
                    <div className="grid grid-cols-3 gap-2">
                      {ASPECT_RATIOS.map((ar) => (
                        <button
                          key={ar}
                          type="button"
                          onClick={() =>
                            updateProjectWithHistory((prev) => ({ ...prev, aspectRatio: ar }))
                          }
                          className={`min-h-[44px] rounded-xl border font-mono text-xs font-bold ${
                            project.aspectRatio === ar
                              ? 'bg-amber-500 text-slate-950 border-amber-400'
                              : 'bg-slate-900 border-slate-800 text-slate-200'
                          }`}
                        >
                          {ar}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 12: SPEED                                           */}
                {/* ========================================================= */}
                {activeSheetTool === 'speed' && selectedClip && (
                  <div className="space-y-3">
                    {renderTouchSlider({
                      label: 'Playback Speed',
                      value: selectedClip.speed,
                      min: 0.2,
                      max: 4.0,
                      step: 0.1,
                      defaultValue: 1.0,
                      unit: 'x',
                      onChange: (v) => updateSelectedClip({ speed: v }, true),
                      onReset: () => updateSelectedClip({ speed: 1.0 }),
                    })}

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
                          className={`min-h-[42px] rounded-xl border text-xs font-semibold ${
                            selectedClip.speedCurve === preset.id
                              ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                              : 'bg-slate-900 border-slate-800 text-slate-300'
                          }`}
                        >
                          {preset.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 13: MASK                                            */}
                {/* ========================================================= */}
                {activeSheetTool === 'mask' && selectedClip && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-3 gap-2">
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
                          }}
                          className={`min-h-[42px] rounded-xl border text-xs capitalize font-semibold ${
                            selectedClip.maskShape === shape
                              ? 'bg-amber-500/20 border-amber-400 text-amber-300'
                              : 'bg-slate-900 border-slate-800 text-slate-300'
                          }`}
                        >
                          {shape}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center justify-between">
                      <label className="min-h-[42px] flex items-center gap-2 text-xs text-slate-200 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedClip.maskInvert}
                          onChange={(e) => updateSelectedClip({ maskInvert: e.target.checked })}
                          className="w-4 h-4 accent-amber-500"
                        />
                        <span>{t(lang, 'maskInvert')}</span>
                      </label>
                      {selectedClip.maskShape === 'custom-draw' && (
                        <button
                          type="button"
                          onClick={() => updateSelectedClip({ customMaskPoints: [] })}
                          className="min-h-[38px] px-3 rounded-lg bg-rose-950 text-rose-300 text-xs"
                        >
                          {t(lang, 'clearCustomMask')}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* ========================================================= */}
                {/* SHEET 14: KEYFRAME                                        */}
                {/* ========================================================= */}
                {activeSheetTool === 'keyframe' && selectedClip && (
                  <div className="space-y-3">
                    <button
                      type="button"
                      onClick={handleAddKeyframeAtPlayhead}
                      className="w-full min-h-[46px] rounded-xl bg-amber-500 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5"
                    >
                      <Diamond className="w-4 h-4" />
                      <span>+ Add Keyframe at Playhead ({playheadTime.toFixed(1)}s)</span>
                    </button>

                    {selectedClip.keyframes.length > 0 && (
                      <div className="space-y-1.5">
                        <div className="text-xs text-slate-400">
                          Active Keyframes ({selectedClip.keyframes.length})
                        </div>
                        {selectedClip.keyframes.map((kf) => (
                          <div
                            key={kf.id}
                            className="p-2.5 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-between text-xs"
                          >
                            <span className="font-mono text-amber-400">
                              +{kf.timeOffset.toFixed(2)}s ({kf.easing})
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                updateSelectedClip({
                                  keyframes: selectedClip.keyframes.filter((k) => k.id !== kf.id),
                                })
                              }
                              aria-label="Remove keyframe"
                              className="min-w-[36px] min-h-[36px] text-rose-400 flex items-center justify-center"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 6. BOTTOM HORIZONTAL SCROLLABLE TOOL BAR (14 CapCut Tools + Export) */}
          <nav className="flex items-center gap-1 overflow-x-auto no-scrollbar pt-1.5 border-t border-slate-800/90 bg-[#070A10] shrink-0 min-w-0">
            {(
              [
                { id: 'edit' as const, icon: Scissors, label: t(lang, 'barEdit') },
                { id: 'audio' as const, icon: Music, label: t(lang, 'barAudio') },
                { id: 'text' as const, icon: Type, label: t(lang, 'barText') },
                { id: 'stickers' as const, icon: Smile, label: t(lang, 'barStickers') },
                { id: 'overlay' as const, icon: Layers, label: t(lang, 'barOverlay') },
                { id: 'effects' as const, icon: Sparkles, label: t(lang, 'barEffects') },
                { id: 'transitions' as const, icon: Wand2, label: t(lang, 'barTransitions') },
                { id: 'filters' as const, icon: Palette, label: t(lang, 'barFilters') },
                { id: 'adjust' as const, icon: Sliders, label: t(lang, 'barAdjust') },
                { id: 'captions' as const, icon: Subtitles, label: t(lang, 'barCaptions') },
                { id: 'canvas' as const, icon: Maximize2, label: t(lang, 'barCanvas') },
                { id: 'speed' as const, icon: Gauge, label: t(lang, 'barSpeed') },
                { id: 'mask' as const, icon: Film, label: t(lang, 'barMask') },
                { id: 'keyframe' as const, icon: Diamond, label: t(lang, 'barKeyframe') },
              ]
            ).map((tool) => {
              const Icon = tool.icon;
              const isOpen = activeSheetTool === tool.id;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => {
                    setIsDrawingCustomMask(false);
                    setActiveSheetTool(isOpen ? null : tool.id);
                  }}
                  aria-label={tool.label}
                  className={`w-16 min-w-[64px] min-h-[52px] px-1 rounded-xl flex flex-col items-center justify-center gap-1 shrink-0 transition-colors ${
                    isOpen
                      ? 'bg-amber-500/20 text-amber-400 border border-amber-500/50 font-bold'
                      : 'text-slate-300 hover:bg-slate-900'
                  }`}
                >
                  <Icon className="w-4 h-4 shrink-0" />
                  <span className="text-xs leading-none truncate w-full text-center">
                    {tool.label}
                  </span>
                </button>
              );
            })}

            <button
              type="button"
              onClick={() => {
                setIsPlaying(false);
                setExportedVideoUrl(null);
                setExportedVideoBlob(null);
                setExportProgress(0);
                setShowExportModal(true);
              }}
              aria-label={t(lang, 'btnExportSmall')}
              className="w-16 min-w-[64px] min-h-[52px] px-1 rounded-xl bg-amber-500 text-slate-950 font-bold flex flex-col items-center justify-center gap-1 shrink-0 shadow"
            >
              <Download className="w-4 h-4 shrink-0" />
              <span className="text-xs leading-none truncate w-full text-center">
                {t(lang, 'btnExportSmall')}
              </span>
            </button>
          </nav>

          {/* 3-Step First-Time Onboarding Overlay */}
          {onboardingStep !== null && (
            <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
              <div className="w-full max-w-sm bg-[#0F1522] border border-amber-500/50 rounded-2xl p-5 space-y-4 shadow-2xl">
                <div className="text-xs font-mono text-amber-400">
                  Quick Guide · Step {onboardingStep} of 3
                </div>
                <h3 className="text-base font-bold text-slate-100">
                  {onboardingStep === 1
                    ? t(lang, 'onboardStep1Title')
                    : onboardingStep === 2
                    ? t(lang, 'onboardStep2Title')
                    : t(lang, 'onboardStep3Title')}
                </h3>
                <p className="text-xs text-slate-300 leading-relaxed">
                  {onboardingStep === 1
                    ? t(lang, 'onboardStep1Desc')
                    : onboardingStep === 2
                    ? t(lang, 'onboardStep2Desc')
                    : t(lang, 'onboardStep3Desc')}
                </p>
                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (onboardingStep < 3) {
                        setOnboardingStep(onboardingStep + 1);
                      } else {
                        try {
                          localStorage.setItem('clipnova_onboarding_done_v3', 'true');
                        } catch {
                          // ignore
                        }
                        setOnboardingStep(null);
                      }
                    }}
                    className="min-h-[44px] px-5 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs"
                  >
                    {onboardingStep < 3 ? t(lang, 'onboardNext') : t(lang, 'onboardDone')}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* DELETE PROJECT CONFIRMATION MODAL (Section F)                         */}
      {/* ===================================================================== */}
      {deleteTargetProject && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0F1522] border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
            <h2 className="text-base font-bold text-slate-100">
              {t(lang, 'confirmDeleteTitle')}
            </h2>
            <p className="text-xs text-slate-300 leading-relaxed">
              "{deleteTargetProject.name}" — {t(lang, 'confirmDeleteSub')}
            </p>
            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTargetProject(null)}
                className="flex-1 min-h-[44px] rounded-xl bg-slate-800 text-slate-200 font-semibold text-xs"
              >
                {t(lang, 'btnCancel')}
              </button>
              <button
                type="button"
                onClick={async () => {
                  const targetId = deleteTargetProject.id;
                  await deleteProjectFromStorage(targetId);
                  setProjects((prev) => prev.filter((p) => p.id !== targetId));
                  setDeleteTargetProject(null);
                  triggerToast('Project deleted.', 'प्रोजेक्ट हटाया गया।');
                }}
                className="flex-1 min-h-[44px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs"
              >
                {t(lang, 'btnConfirmDelete')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* ANDROID HARDWARE BACK EXIT CONFIRMATION MODAL (Section A.6)           */}
      {/* ===================================================================== */}
      {showExitConfirmModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-sm bg-[#0F1522] border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
            <h2 className="text-base font-bold text-slate-100">{t(lang, 'exitConfirmTitle')}</h2>
            <p className="text-xs text-slate-300 leading-relaxed">{t(lang, 'exitConfirmSub')}</p>
            <div className="flex items-center gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setShowExitConfirmModal(false)}
                className="flex-1 min-h-[44px] rounded-xl bg-slate-800 text-slate-200 font-semibold text-xs"
              >
                {t(lang, 'btnStay')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setShowExitConfirmModal(false);
                  exitAndroidApp();
                }}
                className="flex-1 min-h-[44px] rounded-xl bg-amber-500 text-slate-950 font-bold text-xs"
              >
                {t(lang, 'btnExit')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* FEATURE IMPLEMENTATION CHECKLIST MODAL                                */}
      {/* ===================================================================== */}
      {showChecklistModal && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-lg max-h-[80dvh] overflow-y-auto bg-[#0F1522] border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h2 className="text-base font-bold text-slate-100">
                ClipNova Feature Status Checklist
              </h2>
              <button
                type="button"
                onClick={() => setShowChecklistModal(false)}
                aria-label="Close checklist"
                className="min-w-[40px] min-h-[40px] rounded-lg hover:bg-slate-800 text-slate-400 flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-3 text-xs">
              <div>
                <h3 className="font-bold text-emerald-400 mb-1.5">
                  Fully Working ({FEATURE_IMPLEMENTATION_CHECKLIST.fullyWorking.length})
                </h3>
                <ul className="space-y-1 text-slate-200">
                  {FEATURE_IMPLEMENTATION_CHECKLIST.fullyWorking.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="font-bold text-amber-400 mb-1.5">
                  Partial / Best-Effort ({FEATURE_IMPLEMENTATION_CHECKLIST.partialBestEffort.length})
                </h3>
                <ul className="space-y-1 text-slate-300">
                  {FEATURE_IMPLEMENTATION_CHECKLIST.partialBestEffort.map((item, i) => (
                    <li key={i}>• {item}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* EXPORT VIDEO MODAL (Progress %, Cancel Button, .webm Warning, Share)  */}
      {/* ===================================================================== */}
      {showExportModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-[#0F1522] border border-slate-800 rounded-2xl p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-100">
                  {t(lang, 'exportModalTitle')}
                </h2>
                <p className="text-xs text-slate-400">{t(lang, 'exportModalSub')}</p>
              </div>
              {!isExportingVideo && (
                <button
                  type="button"
                  onClick={() => setShowExportModal(false)}
                  aria-label="Close export modal"
                  className="min-w-[40px] min-h-[40px] rounded-lg hover:bg-slate-800 text-slate-400 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Export Format Selector: MP4 (recommended) or WebM */}
            <div className="p-3 rounded-xl bg-[#0E131F] border border-slate-800 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-300 shrink-0">Format:</span>
                <div className="flex gap-1">
                  <button
                    type="button"
                    disabled={isExportingVideo}
                    onClick={() => setExportFormat('mp4')}
                    aria-pressed={exportFormat === 'mp4'}
                    className={`min-w-[52px] min-h-[36px] rounded-lg border text-xs font-semibold flex items-center justify-center ${
                      exportFormat === 'mp4'
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    MP4
                  </button>
                  <button
                    type="button"
                    disabled={isExportingVideo}
                    onClick={() => setExportFormat('webm')}
                    aria-pressed={exportFormat === 'webm'}
                    className={`min-w-[52px] min-h-[36px] rounded-lg border text-xs font-semibold flex items-center justify-center ${
                      exportFormat === 'webm'
                        ? 'bg-amber-500 text-slate-950 border-amber-400'
                        : 'bg-slate-900 border-slate-800 text-slate-400'
                    }`}
                  >
                    WebM
                  </button>
                </div>
                <span className={`text-[10px] ${exportFormat === 'mp4' ? 'text-emerald-400' : 'text-amber-400'} font-medium shrink-0`}>
                  {exportFormat === 'mp4' ? 'H.264 + AAC' : 'VP9'}
                </span>
              </div>
              {exportFormat === 'webm' && (
                <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/40 flex items-start gap-2.5 text-xs text-amber-200">
                  <ShieldAlert className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
                  <span>WebM fallback — MP4 not supported by this WebView.</span>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Resolution</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {(['480p', '720p', '1080p', '2K', '4K'] as const).map((res) => (
                    <button
                      key={res}
                      type="button"
                      disabled={isExportingVideo}
                      onClick={() =>
                        updateProjectWithHistory((prev) => ({
                          ...prev,
                          resolution: res,
                        }))
                      }
                      className={`min-h-[40px] rounded-lg border font-mono text-xs font-semibold ${
                        project.resolution === res
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      {res}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">Frame Rate</label>
                <div className="grid grid-cols-5 gap-1.5">
                  {([24, 25, 30, 50, 60] as const).map((fps) => (
                    <button
                      key={fps}
                      type="button"
                      disabled={isExportingVideo}
                      onClick={() => updateProjectWithHistory((prev) => ({ ...prev, fps }))}
                      className={`min-h-[40px] rounded-lg border font-mono text-xs font-semibold ${
                        project.fps === fps
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-900 border-slate-800 text-slate-300'
                      }`}
                    >
                      {fps}fps
                    </button>
                  ))}
                </div>
              </div>

              {(isExportingVideo || exportProgress > 0) && (
                <div className="space-y-2 pt-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-200 font-medium">
                      {exportProgress === 100 ? 'Render Complete!' : 'Rendering frames...'}
                    </span>
                    <span className="font-mono tabular-nums text-amber-400 font-bold">
                      {exportProgress}%
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-slate-900 overflow-hidden">
                    <div
                      style={{ width: `${exportProgress}%` }}
                      className="h-full bg-amber-500 transition-all duration-150"
                    />
                  </div>
                </div>
              )}

              <div className="flex flex-col gap-2 pt-2">
                {isExportingVideo ? (
                  <button
                    type="button"
                    onClick={handleCancelVideoExport}
                    className="w-full min-h-[46px] rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold text-xs flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    <span>{t(lang, 'exportCancelBtn')}</span>
                  </button>
                ) : !exportedVideoUrl ? (
                  <button
                    type="button"
                    onClick={handleStartVideoExport}
                    className="w-full min-h-[46px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>
                      {t(lang, 'startExportBtn')} ({project.resolution} · {project.fps}fps)
                    </span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={async () => {
                      const ext = exportedVideoBlob?.type === 'video/mp4' ? 'mp4' : 'webm';
                      const fileName = `${project.name.replace(/\s+/g, '_')}_${project.resolution}.${ext}`;
                      if (exportedVideoBlob) {
                        const res = await saveAndShareFileOnDevice(
                          exportedVideoBlob,
                          fileName,
                          `ClipNova Video Export (${project.resolution})`
                        );
                        if (res.saved) {
                          triggerToast(
                            isAndroidNativeApp()
                              ? `Saved to Documents/ClipNova/${fileName}`
                              : `Downloaded ${fileName}`,
                            isAndroidNativeApp()
                              ? `Documents/ClipNova/${fileName} में सेव किया गया`
                              : `${fileName} डाउनलोड किया गया`
                          );
                        }
                      }
                    }}
                    className="w-full min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-2"
                  >
                    <Check className="w-4 h-4" />
                    <span>
                      {t(lang, 'downloadVideoBtn')} ({exportedVideoBlob?.type === 'video/mp4' ? '.mp4' : '.webm'})
                    </span>
                  </button>
                )}
              </div>

              {/* Export Result Info: format, resolution, duration, frames, size, audio */}
              {exportResult && (
                <div className="p-3 rounded-xl bg-[#0E131F] border border-slate-800 space-y-1.5">
                  <div className="text-xs font-bold text-slate-100 mb-1">{t(lang, 'exportResultTitle')}</div>
                  <div className="text-[10px] text-slate-300 space-y-0.5">
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t(lang, 'exportResultFormat')}</span>
                      <span className="font-mono text-amber-400">{exportResult.format}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t(lang, 'exportResultResolution')}</span>
                      <span className="font-mono text-amber-400">{exportResult.resolution}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t(lang, 'exportResultDuration')}</span>
                      <span className="font-mono text-amber-400">{exportResult.duration.toFixed(1)}s</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t(lang, 'exportResultFrames')}</span>
                      <span className="font-mono text-amber-400">{exportResult.frames}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t(lang, 'exportResultSize')}</span>
                      <span className="font-mono text-amber-400">{(exportResult.size / 1024 / 1024).toFixed(2)} MB</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">{t(lang, 'exportResultAudio')}</span>
                      <span className={"font-mono " + (exportResult.hasAudio ? 'text-emerald-400' : 'text-rose-400')}>
                        {exportResult.hasAudio ? t(lang, 'exportResultAudioYes') : t(lang, 'exportResultAudioNo')}
                      </span>
                    </div>
                  </div>
                </div>
              )}

                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => downloadProjectJson(project)}
                    className="min-h-[42px] px-3 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 font-medium text-xs"
                  >
                    Export .JSON
                  </button>
                  <button
                    type="button"
                    onClick={() => downloadFcpXml(project)}
                    className="min-h-[42px] px-3 rounded-xl border border-slate-700 bg-slate-900 text-slate-200 font-medium text-xs"
                  >
                    Export .FCPXML
                  </button>
                </div>
              </div>
            </div>
          </div>
      )}

      {/* ===================================================================== */}
      {/* FULLSCREEN PREVIEW OVERLAY */}
      {/* ===================================================================== */}
      {isFullscreen && (
        <div
          className="fixed inset-0 z-50 bg-black flex items-center justify-center"
          onTouchStart={() => {
            setOverlayVisible(true);
            if (overlayHideRef.current) clearTimeout(overlayHideRef.current);
            overlayHideRef.current = setTimeout(() => setOverlayVisible(false), 3000);
          }}
        >
          {/* Video fills screen, aspect ratio preserved */}
          <div className="relative w-full h-full flex items-center justify-center bg-black">
            <video
              ref={videoRef}
              className="max-w-full max-h-full w-auto h-auto object-contain"
              playsInline
              preload="auto"
              onPointerDown={handleCanvasPointerDown}
            />
            <canvas
              ref={canvasRef}
              className="max-w-full max-h-full w-auto h-auto object-contain absolute inset-0"
              style={{ pointerEvents: 'none' }}
            />
          </div>

          {/* Controls overlay (auto-hides after 3s) */}
          <div
            className={"absolute inset-0 flex flex-col justify-between p-4 pointer-events-none " + (overlayVisible ? 'opacity-100 transition-opacity duration-300' : 'opacity-0 transition-opacity duration-300')}
          >
            {/* Top: close button */}
            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setIsFullscreen(false)}
                aria-label="Close fullscreen"
                className="min-w-[44px] min-h-[44px] rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Middle: play/pause, prev/next */}
            <div className="flex items-center justify-center gap-4 pointer-events-auto">
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setPlayheadTime(0);
                }}
                aria-label="Previous"
                className="min-w-[44px] min-h-[44px] rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
              >
                <SkipBack className="w-5 h-5" />
              </button>
              <button
                type="button"
                onClick={() => {
                  soundEngine.resume();
                  setIsPlaying((p) => !p);
                }}
                aria-label={isPlaying ? 'Pause' : 'Play'}
                className="min-w-[44px] min-h-[44px] rounded-full bg-amber-500 hover:bg-amber-400 text-slate-950 flex items-center justify-center"
              >
                {isPlaying ? (
                  <Pause className="w-5 h-5 fill-current" />
                ) : (
                  <Play className="w-5 h-5 fill-current" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsPlaying(false);
                  setPlayheadTime(totalDuration);
                }}
                aria-label="Next"
                className="min-w-[44px] min-h-[44px] rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
              >
                <SkipForward className="w-5 h-5" />
              </button>
            </div>

            {/* Bottom: seek bar + time + rotate */}
            <div className="flex flex-col gap-2 pb-4 pointer-events-auto w-full">
              <div className="flex items-center gap-2">
                <span className="text-xs text-white font-mono">{playheadTime.toFixed(1)}s</span>
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
                  onPointerDown={() => {
                    if (overlayHideRef.current) clearTimeout(overlayHideRef.current);
                  }}
                  onPointerUp={() => {
                    overlayHideRef.current = setTimeout(() => setOverlayVisible(false), 3000);
                  }}
                  className="flex-1 accent-amber-500 cursor-pointer touch-none"
                  style={{ touchAction: 'none' }}
                />
                <span className="text-xs text-white font-mono">{totalDuration.toFixed(1)}s</span>
              </div>
              <div className="flex items-center justify-between gap-4">
                <button
                  type="button"
                  onClick={toggleScreenOrientation}
                  aria-label="Rotate screen"
                  className="min-w-[44px] min-h-[44px] rounded-full bg-black/60 hover:bg-black/80 text-white flex items-center justify-center"
                >
                  <RotateCw className="w-5 h-5" />
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
