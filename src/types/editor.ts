export type AspectRatioKey = '9:16' | '16:9' | '1:1' | '4:5' | '4:3' | '21:9';

export type TrackType =
  | 'effect-layer'
  | 'adjustment'
  | 'text'
  | 'sticker'
  | 'overlay'
  | 'video'
  | 'audio';

export type TransitionType =
  | 'none'
  | 'fade'
  | 'dissolve'
  | 'slide'
  | 'wipe'
  | 'zoom'
  | 'whip-pan'
  | 'flash'
  | 'cube'
  | 'ripple'
  | 'luma-fade'
  | 'slide-left'
  | 'zoom-in'
  | 'flash-white'
  | 'wipe-right';

export type VideoEffectType =
  | 'none'
  | 'glitch'
  | 'glitch-rgb'
  | 'rgb-split'
  | 'vhs'
  | 'vhs-retro'
  | 'film-grain'
  | 'light-leak'
  | 'flash'
  | 'beat-flash'
  | 'shake'
  | 'camera-shake'
  | 'zoom-punch'
  | 'zoom-pulse'
  | 'whip-pan'
  | 'spin'
  | 'kaleidoscope'
  | 'pixelate'
  | 'blur'
  | 'glow'
  | 'dream-glow'
  | 'speed-ramp'
  | 'freeze'
  | 'cinematic-bars'
  | 'ripple-wave'
  | 'neon-edge';

export type MaskShapeType =
  | 'none'
  | 'linear'
  | 'linear-split'
  | 'circle'
  | 'rectangle'
  | 'heart'
  | 'star'
  | 'custom-draw';

export type BlendModeType =
  | 'source-over'
  | 'screen'
  | 'multiply'
  | 'overlay'
  | 'lighter'
  | 'lighten'
  | 'color-dodge'
  | 'hard-light';

export type SpeedCurvePreset = 'normal' | 'montage' | 'hero-bullet' | 'jump-cut' | 'flash-in';

export type TextAnimationType =
  | 'none'
  | 'pop-in'
  | 'typewriter'
  | 'slide-up'
  | 'karaoke-highlight'
  | 'pulse-loop'
  | 'fade-out';

export type VoiceChangerPreset = 'none' | 'deep-cinema' | 'chipmunk' | 'robot-mod' | 'echo-hall';

export interface KeyframePoint {
  id: string;
  timeOffset: number; // relative to clip start in seconds
  scale: number;
  x: number; // -100 to 100 percentage offset
  y: number; // -100 to 100 percentage offset
  rotation: number; // degrees
  opacity: number; // 0 to 1
  effectIntensity?: number; // 0 to 100
  brightness?: number; // -50 to 50
  volume?: number; // 0 to 200
  easing: 'linear' | 'ease-in-out' | 'ease-out-back' | 'cubic-bezier';
}

export interface ColorAdjustments {
  brightness: number; // -50 to 50
  contrast: number; // -50 to 50
  saturation: number; // -50 to 50
  exposure: number; // -50 to 50
  highlights: number; // -50 to 50
  shadows: number; // -50 to 50
  temperature: number; // -50 (cool) to 50 (warm)
  tint: number; // -50 to 50
  sharpen: number; // 0 to 100
  vignette: number; // 0 to 100
  grain: number; // 0 to 100
  blur: number; // 0 to 50
  hue: number; // -180 to 180
  fade: number; // 0 to 100
  lutName?: string;
}

export interface TimelineClip {
  id: string;
  trackId: string;
  trackType: TrackType;
  title: string;
  titleHi?: string;
  // Timing on timeline (seconds)
  startTime: number;
  duration: number;
  inPoint: number;
  outPoint: number;
  // Media source
  sourceType:
    | 'procedural-scene'
    | 'uploaded-video'
    | 'uploaded-image'
    | 'synth-audio'
    | 'uploaded-audio'
    | 'text'
    | 'sticker'
    | 'adjustment-layer'
    | 'effect-layer';
  scenePreset?: 'mumbai-drive' | 'wedding-haldi' | 'himalaya-sunrise' | 'tech-studio' | 'neon-bazaar';
  mediaUrl?: string;
  // Transform & playback
  speed: number; // 0.1 to 10
  speedCurve: SpeedCurvePreset;
  smoothSlowMo?: boolean;
  reversed: boolean;
  frozen: boolean;
  stabilizationEnabled?: boolean;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
  scale: number; // 0.2 to 3.0
  posX: number; // -100 to 100
  posY: number; // -100 to 100
  opacity: number; // 0 to 1
  // Audio properties
  volume: number; // 0 to 200 (%)
  fadeIn: number; // seconds
  fadeOut: number; // seconds
  muted: boolean;
  synthPreset?: 'desi-hiphop' | 'wedding-shehnai' | 'cyber-synth' | 'lofi-monsoon' | 'cinematic-riser';
  beatMarkers?: number[];
  voiceChanger?: VoiceChangerPreset;
  noiseReduction?: boolean;
  // Visual styling, filters & effects
  filterPreset: string;
  filterIntensity: number; // 0 to 100
  effect: VideoEffectType;
  effectIntensity: number; // 0 to 100
  transitionIn: TransitionType;
  transitionDuration: number; // 0.2 to 1.5s
  adjustments: ColorAdjustments;
  // Masks, Chroma Key, AI Background Remover, Motion Tracking
  maskShape: MaskShapeType;
  maskFeather: number; // 0 to 50
  maskInvert: boolean;
  customMaskPoints?: { x: number; y: number }[];
  blendMode: BlendModeType;
  chromaKeyEnabled: boolean;
  chromaKeyColor: string;
  chromaKeySimilarity: number;
  chromaKeyShadow: number;
  bgRemovalEnabled?: boolean;
  motionTrackTargetId?: string;
  keyframes: KeyframePoint[];
  // Text / Caption specific
  textContent?: string;
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
  outlineColor?: string;
  outlineWidth?: number;
  shadowBlur?: number;
  bgBoxColor?: string;
  bgBoxOpacity?: number;
  glowIntensity?: number;
  textAlign?: 'left' | 'center' | 'right';
  textAnimation?: TextAnimationType;
  // Sticker specific
  stickerGlyph?: string;
  stickerLabel?: string;
}

export interface CanvasBackgroundConfig {
  type: 'solid' | 'gradient' | 'blur';
  solidColor: string;
  gradientFrom: string;
  gradientTo: string;
  blurAmount: number;
}

export interface ProjectData {
  id: string;
  name: string;
  aspectRatio: AspectRatioKey;
  fps: 24 | 25 | 30 | 50 | 60;
  resolution: '480p' | '720p' | '1080p' | '2K' | '4K';
  updatedAt: string;
  background: CanvasBackgroundConfig;
  watermarkEnabled: boolean;
  isProUnlocked: boolean;
  clips: TimelineClip[];
}

export interface TemplatePreset {
  id: string;
  nameEn: string;
  nameHi: string;
  category: 'Reels & Shorts' | 'Wedding & Festive' | 'Tech & Vlog' | 'Business Promo';
  aspectRatio: AspectRatioKey;
  duration: number;
  slotsCount: number;
  bpm: number;
  descriptionEn: string;
  descriptionHi: string;
  sceneTheme: 'mumbai-drive' | 'wedding-haldi' | 'himalaya-sunrise' | 'tech-studio' | 'neon-bazaar';
  clips: TimelineClip[];
}

export interface SpecDecisionForm {
  finalAppName: string;
  tagline: string;
  primaryPlatform: 'Android First (Kotlin + Media3 + OpenGL ES)' | 'Both Android & iOS (Flutter + C++ Engine)' | 'Web + Mobile PWA + Native Shell';
  techStack: 'Native Android (Kotlin) + Media3/Transformer + OpenGL ES' | 'C++ Cross-Platform Core (FFmpeg + OpenGL) + UI Shell' | 'Flutter + Native Video Engine Plugins' | 'React Native + Native GPU Modules';
  exportTargetSpeed: string;
  minDeviceSpec: string;
  teamSizeAndSkills: string;
  budgetBreakdown: string;
  monetizationModel: 'Freemium + Pro Subscription (UPI AutoPay)' | 'Subscription + Rewarded Ads Unlock' | 'Free with Watermark + Template Credits';
  rewardedAdsEnabled: boolean;
  aiExecutionStrategy: 'Hybrid (On-Device MediaPipe/TFLite + Cloud STT/TTS with Credit Limit)' | '100% On-Device ML (Zero Server Cost)' | 'Cloud AI API Gateway (Whisper + Gemini + RIFE)';
  targetAudienceNiche: string;
  launchTargetDate: string;
  coreUsp: string;
  trademarkStatus: string;
  selectedMvpFeatures: string[];
}
