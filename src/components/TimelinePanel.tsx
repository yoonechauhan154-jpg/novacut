import React, { useRef, useState } from 'react';
import {
  Copy,
  Diamond,
  Layers,
  Magnet,
  Rewind,
  RotateCcw,
  RotateCw,
  Scissors,
  Sliders,
  Snowflake,
  Sparkles,
  Trash2,
  Volume2,
  VolumeX,
  Wand2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { LanguageCode, t } from '../i18n/translations';
import { TimelineClip, TrackType, TransitionType, VideoEffectType } from '../types/editor';

interface TimelinePanelProps {
  lang: LanguageCode;
  clips: TimelineClip[];
  selectedClipId: string | null;
  playheadTime: number;
  totalDuration: number;
  zoomPxPerSec: number;
  magneticSnap: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onSelectClip: (id: string | null) => void;
  onSeek: (time: number) => void;
  onZoomChange: (px: number) => void;
  onToggleMagneticSnap: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onCreateAdjustmentLayer: () => void;
  onCreateEffectLayer: (effect?: VideoEffectType, startTime?: number) => void;
  onApplyTransitionDrop: (clipId: string, transition: TransitionType) => void;
  onAutoBeatCut: () => void;
  onSplitAtPlayhead: () => void;
  onDuplicateSelected: () => void;
  onDeleteSelected: () => void;
  onToggleReverseSelected: () => void;
  onToggleFreezeSelected: () => void;
  onAddKeyframeAtPlayhead: () => void;
  onUpdateClipTiming: (clipId: string, newStartTime: number, newDuration: number) => void;
  onToggleTrackMute: (trackType: TrackType) => void;
}

export const TimelinePanel: React.FC<TimelinePanelProps> = ({
  lang,
  clips,
  selectedClipId,
  playheadTime,
  totalDuration,
  zoomPxPerSec,
  magneticSnap,
  canUndo,
  canRedo,
  onSelectClip,
  onSeek,
  onZoomChange,
  onToggleMagneticSnap,
  onUndo,
  onRedo,
  onCreateAdjustmentLayer,
  onCreateEffectLayer,
  onApplyTransitionDrop,
  onAutoBeatCut,
  onSplitAtPlayhead,
  onDuplicateSelected,
  onDeleteSelected,
  onToggleReverseSelected,
  onToggleFreezeSelected,
  onAddKeyframeAtPlayhead,
  onUpdateClipTiming,
  onToggleTrackMute,
}) => {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [dragState, setDragState] = useState<{
    clipId: string;
    mode: 'move' | 'trim-left' | 'trim-right';
    initialX: number;
    initialStart: number;
    initialDuration: number;
  } | null>(null);

  const selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  const timelineDuration = Math.max(12, Math.ceil(totalDuration + 3));
  const timelineWidthPx = timelineDuration * zoomPxPerSec;

  const TRACK_DEFINITIONS: {
    type: TrackType;
    i18nKey: string;
    badge: string;
    colorClass: string;
  }[] = [
    {
      type: 'effect-layer',
      i18nKey: 'trackEffectLayer',
      badge: 'FX',
      colorClass: 'bg-fuchsia-500/20 border-fuchsia-400/60 text-fuchsia-100',
    },
    {
      type: 'adjustment',
      i18nKey: 'trackAdjustmentLayer',
      badge: 'ADJ',
      colorClass: 'bg-cyan-500/20 border-cyan-400/60 text-cyan-100',
    },
    {
      type: 'text',
      i18nKey: 'trackText',
      badge: 'TXT',
      colorClass: 'bg-amber-500/20 border-amber-500/50 text-amber-200',
    },
    {
      type: 'sticker',
      i18nKey: 'trackSticker',
      badge: 'STK',
      colorClass: 'bg-rose-500/20 border-rose-500/50 text-rose-200',
    },
    {
      type: 'overlay',
      i18nKey: 'trackOverlay',
      badge: 'PIP',
      colorClass: 'bg-sky-500/20 border-sky-500/50 text-sky-200',
    },
    {
      type: 'video',
      i18nKey: 'trackVideo',
      badge: 'VID',
      colorClass: 'bg-indigo-500/25 border-indigo-400/60 text-indigo-100',
    },
    {
      type: 'audio',
      i18nKey: 'trackAudio',
      badge: 'AUD',
      colorClass: 'bg-emerald-500/20 border-emerald-500/50 text-emerald-200',
    },
  ];

  // Gather all snap points (clip starts/ends + audio beat markers)
  const snapPoints: number[] = [0];
  clips.forEach((c) => {
    snapPoints.push(c.startTime, c.startTime + c.duration);
    if (c.beatMarkers) {
      c.beatMarkers.forEach((bm) => snapPoints.push(c.startTime + bm));
    }
  });

  const applySnap = (timeVal: number): number => {
    if (!magneticSnap) return Math.max(0, Number(timeVal.toFixed(2)));
    const thresholdSec = 8 / zoomPxPerSec;
    for (const sp of snapPoints) {
      if (Math.abs(timeVal - sp) <= thresholdSec) {
        return Number(sp.toFixed(2));
      }
    }
    return Math.max(0, Number(timeVal.toFixed(2)));
  };

  const handleRulerPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft - 160;
    if (clickX < 0) return;
    const targetSec = applySnap(clickX / zoomPxPerSec);
    onSeek(Math.max(0, Math.min(timelineDuration, targetSec)));
  };

  const pinchDistanceRef = useRef<number | null>(null);

  const handleTouchStartPinch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinchDistanceRef.current = Math.hypot(dx, dy);
    }
  };

  const handleTouchMovePinch = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.touches.length === 2 && pinchDistanceRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const delta = dist - pinchDistanceRef.current;
      if (Math.abs(delta) > 6) {
        onZoomChange(Math.max(35, Math.min(130, Math.round(zoomPxPerSec + delta * 0.25))));
        pinchDistanceRef.current = dist;
      }
    }
  };

  const handleTouchEndPinch = () => {
    pinchDistanceRef.current = null;
  };

  const startClipDrag = (
    e: React.PointerEvent,
    clip: TimelineClip,
    mode: 'move' | 'trim-left' | 'trim-right'
  ) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore if pointer capture unsupported
    }
    onSelectClip(clip.id);
    setDragState({
      clipId: clip.id,
      mode,
      initialX: e.clientX,
      initialStart: clip.startTime,
      initialDuration: clip.duration,
    });
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragState) return;
    const deltaSec = (e.clientX - dragState.initialX) / zoomPxPerSec;

    if (dragState.mode === 'move') {
      const nextStart = applySnap(Math.max(0, dragState.initialStart + deltaSec));
      onUpdateClipTiming(dragState.clipId, nextStart, dragState.initialDuration);
    } else if (dragState.mode === 'trim-left') {
      const maxDelta = dragState.initialDuration - 0.35;
      const clampedDelta = Math.min(maxDelta, Math.max(-dragState.initialStart, deltaSec));
      const nextStart = applySnap(dragState.initialStart + clampedDelta);
      const nextDur = Math.max(
        0.35,
        Number((dragState.initialDuration - (nextStart - dragState.initialStart)).toFixed(2))
      );
      onUpdateClipTiming(dragState.clipId, nextStart, nextDur);
    } else if (dragState.mode === 'trim-right') {
      const nextEnd = applySnap(
        Math.max(
          dragState.initialStart + 0.35,
          dragState.initialStart + dragState.initialDuration + deltaSec
        )
      );
      const nextDur = Math.max(0.35, Number((nextEnd - dragState.initialStart).toFixed(2)));
      onUpdateClipTiming(dragState.clipId, dragState.initialStart, nextDur);
    }
  };

  const handlePointerUp = () => {
    if (dragState) {
      setDragState(null);
    }
  };

  const handleTrackDrop = (e: React.DragEvent<HTMLDivElement>, trackType: TrackType) => {
    e.preventDefault();
    if (!scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const dropX = Math.max(0, e.clientX - rect.left + scrollLeft - 160);
    const dropTime = applySnap(dropX / zoomPxPerSec);

    const payloadRaw = e.dataTransfer.getData('application/clipnova-item');
    if (!payloadRaw) return;
    try {
      const payload = JSON.parse(payloadRaw);
      if (payload.kind === 'effect') {
        onCreateEffectLayer(payload.id as VideoEffectType, dropTime);
      } else if (payload.kind === 'adjustment') {
        onCreateAdjustmentLayer();
      } else if (payload.kind === 'transition') {
        const targetClip =
          clips.find(
            (c) =>
              c.trackType === trackType &&
              dropTime >= c.startTime &&
              dropTime <= c.startTime + c.duration
          ) || selectedClip;
        if (targetClip) {
          onApplyTransitionDrop(targetClip.id, payload.id as TransitionType);
        }
      }
    } catch {
      // ignore invalid drag payload
    }
  };

  const formatTimecode = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const frames = Math.floor((sec % 1) * 30);
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}:${String(
      frames
    ).padStart(2, '0')}`;
  };

  return (
    <section
      className="flex flex-col bg-[#0B0F17] border-t border-slate-800/90 select-none shrink-0"
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Timeline Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 pb-[var(--safe-area-bottom)] bg-[#0F1522] border-b border-slate-800/80 min-w-0">
        <div className="flex items-center gap-1.5 flex-wrap min-w-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo (Ctrl+Z)"
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-35 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{t(lang, 'btnUndo')}</span>
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo (Ctrl+Y)"
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-35 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span>{t(lang, 'btnRedo')}</span>
          </button>

          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          {/* Non-Destructive Adjustment Layer & Effect Overlay Layer Quick Creators */}
          <button
            type="button"
            onClick={onCreateAdjustmentLayer}
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/40 text-cyan-200 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span>{t(lang, 'btnAddAdjustment')}</span>
          </button>

          <button
            type="button"
            onClick={() => onCreateEffectLayer('light-leak', playheadTime)}
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold bg-fuchsia-500/15 hover:bg-fuchsia-500/25 border border-fuchsia-500/40 text-fuchsia-200 transition-colors flex items-center gap-1.5 whitespace-nowrap shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
            <span>{t(lang, 'btnAddEffectLayer')}</span>
          </button>

          <div className="h-4 w-px bg-slate-800 mx-0.5" />

          <button
            type="button"
            onClick={onSplitAtPlayhead}
            disabled={!selectedClip}
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-100 disabled:opacity-40 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span>{t(lang, 'btnSplit')}</span>
          </button>

          <button
            type="button"
            onClick={onDuplicateSelected}
            disabled={!selectedClip}
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-100 disabled:opacity-40 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Copy className="w-3.5 h-3.5 text-sky-400" />
            <span>{t(lang, 'btnDuplicate')}</span>
          </button>

          <button
            type="button"
            onClick={onAddKeyframeAtPlayhead}
            disabled={!selectedClip}
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-100 disabled:opacity-40 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Diamond className="w-3.5 h-3.5 text-amber-400" />
            <span>{t(lang, 'btnAddKeyframe')}</span>
          </button>

          <button
            type="button"
            onClick={onAutoBeatCut}
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/40 text-emerald-200 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
            title="Auto-Split Main Video on Audio Beat Markers"
          >
            <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
            <span>{t(lang, 'btnAutoBeatCut')}</span>
          </button>

          <button
            type="button"
            onClick={onToggleReverseSelected}
            disabled={!selectedClip}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 ${
              selectedClip?.reversed
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 disabled:opacity-40'
            }`}
          >
            <Rewind className="w-3.5 h-3.5" />
            <span>{t(lang, 'btnReverse')}</span>
          </button>

          <button
            type="button"
            onClick={onToggleFreezeSelected}
            disabled={!selectedClip}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium transition-colors flex items-center gap-1 whitespace-nowrap shrink-0 ${
              selectedClip?.frozen
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'bg-slate-800/90 hover:bg-slate-700 text-slate-200 disabled:opacity-40'
            }`}
          >
            <Snowflake className="w-3.5 h-3.5" />
            <span>{t(lang, 'btnFreeze')}</span>
          </button>

          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={!selectedClip}
            className="min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 disabled:opacity-35 transition-colors flex items-center gap-1 whitespace-nowrap shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t(lang, 'btnDelete')}</span>
          </button>
        </div>

        {/* Right: Timecode + Magnetic Snap + Zoom */}
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <div className="font-mono tabular-nums text-xs text-slate-300 bg-slate-900 px-2.5 py-1 rounded border border-slate-800 min-w-0 truncate">
            <span className="text-amber-400 font-semibold truncate">{formatTimecode(playheadTime)}</span>
            <span className="mx-1.5 text-slate-600">/</span>
            <span className="truncate">{formatTimecode(totalDuration)}</span>
          </div>

          <button
            type="button"
            onClick={onToggleMagneticSnap}
            className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors whitespace-nowrap shrink-0 ${
              magneticSnap
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span>
              {t(lang, 'btnSnap')} {magneticSnap ? 'ON' : 'OFF'}
            </span>
          </button>

          <div className="hidden sm:flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => onZoomChange(Math.max(35, zoomPxPerSec - 15))}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              title="Zoom Out Timeline"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <input
              type="range"
              min={35}
              max={130}
              value={zoomPxPerSec}
              onChange={(e) => onZoomChange(Number(e.target.value))}
              className="w-20 accent-amber-500 cursor-pointer"
              aria-label="Timeline Zoom"
            />
            <button
              type="button"
              onClick={() => onZoomChange(Math.min(130, zoomPxPerSec + 15))}
              className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
              title="Zoom In Timeline"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Multi-Track Scrollable Timeline Area */}
      <div
        ref={scrollContainerRef}
        className="relative overflow-x-auto overflow-y-auto max-h-[250px] sm:max-h-[275px] pb-[var(--safe-area-bottom)]"
        onPointerDown={handleRulerPointerDown}
        onTouchStart={handleTouchStartPinch}
        onTouchMove={handleTouchMovePinch}
        onTouchEnd={handleTouchEndPinch}
      >
        <div className="relative min-w-full" style={{ width: `${160 + timelineWidthPx}px` }}>
          {/* Time Ruler Row */}
          <div className="sticky top-0 z-20 flex h-6 bg-[#0D131F] border-b border-slate-800/90">
            <div className="sticky left-0 z-30 w-[160px] shrink-0 bg-[#0D131F] border-r border-slate-800 px-3 flex items-center justify-between text-[11px] font-medium text-slate-400">
              <span>{lang === 'hi' ? 'ट्रैक्स (7 लेयर्स)' : 'Tracks (7 Layers)'}</span>
              <span className="font-mono tabular-nums">30fps</span>
            </div>
            <div className="relative flex-1">
              {Array.from({ length: timelineDuration + 1 }).map((_, sec) => (
                <div
                  key={sec}
                  className="absolute top-0 bottom-0 flex flex-col justify-end pb-0.5 border-l border-slate-800/80 pl-1"
                  style={{ left: `${sec * zoomPxPerSec}px` }}
                >
                  <span className="font-mono tabular-nums text-[10px] text-slate-400">{sec}s</span>
                </div>
              ))}
            </div>
          </div>

          {/* 7 Track Lanes */}
          {TRACK_DEFINITIONS.map((track) => {
            const trackClips = clips.filter((c) => c.trackType === track.type);
            const allMuted = trackClips.length > 0 && trackClips.every((c) => c.muted);

            return (
              <div
                key={track.type}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleTrackDrop(e, track.type)}
                className="flex h-9 border-b border-slate-800/60 bg-[#0B0F17] hover:bg-[#0E1420] transition-colors"
              >
                {/* Sticky Left Track Header */}
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  className="sticky left-0 z-20 w-[160px] shrink-0 bg-[#0F1522] border-r border-slate-800 px-2.5 flex items-center justify-between"
                >
                  <div className="flex items-center gap-1.5 truncate pr-1">
                    <span className="font-mono text-[9px] font-semibold text-slate-400">
                      {track.badge}
                    </span>
                    <span className="text-xs font-medium text-slate-200 truncate">
                      {t(lang, track.i18nKey)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleTrackMute(track.type)}
                    className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 shrink-0"
                    title={allMuted ? 'Unmute / Show Track' : 'Mute / Hide Track'}
                  >
                    {allMuted ? (
                      <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                    ) : (
                      <Volume2 className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>

                {/* Track Clip Canvas Lane */}
                <div className="relative flex-1 h-full">
                  {trackClips.map((clip) => {
                    const isSelected = clip.id === selectedClipId;
                    const leftPx = clip.startTime * zoomPxPerSec;
                    const widthPx = Math.max(24, clip.duration * zoomPxPerSec);

                    return (
                      <div
                        key={clip.id}
                        onPointerDown={(e) => startClipDrag(e, clip, 'move')}
                        style={{
                          left: `${leftPx}px`,
                          width: `${widthPx}px`,
                        }}
                        className={`group touch-none absolute top-1 bottom-1 rounded-md border px-2.5 flex items-center justify-between cursor-grab active:cursor-grabbing overflow-hidden transition-shadow ${
                          track.colorClass
                        } ${
                          isSelected
                            ? 'ring-2 ring-amber-400 shadow-md z-10'
                            : 'hover:brightness-110'
                        } ${clip.muted ? 'opacity-40' : ''}`}
                      >
                        {/* Left Trim Handle (touch-friendly 12px hitbox) */}
                        <div
                          onPointerDown={(e) => startClipDrag(e, clip, 'trim-left')}
                          className="touch-none absolute left-0 top-0 bottom-0 w-3 bg-amber-400/80 opacity-60 sm:opacity-0 group-hover:opacity-100 cursor-ew-resize"
                          title="Drag to Trim In-Point"
                        />

                        {/* Clip Title & Metadata */}
                        <div className="flex items-center gap-1.5 truncate text-[11px] font-medium pointer-events-none">
                          <span className="truncate">
                            {clip.trackType === 'text'
                              ? clip.textContent || clip.title
                              : clip.trackType === 'sticker'
                              ? `${clip.stickerGlyph || '🔥'} ${clip.title}`
                              : clip.trackType === 'effect-layer'
                              ? `✦ ${
                                  lang === 'hi' && clip.titleHi ? clip.titleHi : clip.title
                                } (${clip.effectIntensity}%)`
                              : clip.trackType === 'adjustment'
                              ? `◐ ${lang === 'hi' && clip.titleHi ? clip.titleHi : clip.title}`
                              : lang === 'hi' && clip.titleHi
                              ? clip.titleHi
                              : clip.title}
                          </span>
                          {clip.transitionIn !== 'none' && (
                            <span className="font-mono text-[9px] opacity-80">
                              · {clip.transitionIn}
                            </span>
                          )}
                          {clip.speed !== 1 && (
                            <span className="font-mono tabular-nums text-[9px] opacity-80">
                              · {clip.speed}x
                            </span>
                          )}
                        </div>

                        {/* Keyframe Diamonds */}
                        {clip.keyframes && clip.keyframes.length > 0 && (
                          <div className="flex items-center gap-0.5 pointer-events-none">
                            {clip.keyframes.map((kf) => (
                              <span
                                key={kf.id}
                                style={{
                                  left: `${Math.min(
                                    widthPx - 8,
                                    Math.max(4, kf.timeOffset * zoomPxPerSec)
                                  )}px`,
                                }}
                                className="absolute bottom-0.5 w-2 h-2 rotate-45 bg-amber-400 border border-slate-950"
                              />
                            ))}
                          </div>
                        )}

                        {/* Audio Waveform & Beat Markers */}
                        {clip.trackType === 'audio' && (
                          <div className="absolute inset-x-0 bottom-0.5 flex items-end h-2.5 pointer-events-none opacity-65">
                            {Array.from({ length: Math.min(40, Math.floor(widthPx / 8)) }).map(
                              (_, wIdx) => (
                                <span
                                  key={wIdx}
                                  style={{
                                    left: `${wIdx * 8}px`,
                                    height: `${3 + ((wIdx * 7) % 8)}px`,
                                  }}
                                  className="absolute w-1 bg-emerald-400/50 rounded-t"
                                />
                              )
                            )}
                            {clip.beatMarkers &&
                              clip.beatMarkers
                                .filter((bm) => bm < clip.duration)
                                .map((bm, idx) => (
                                  <span
                                    key={idx}
                                    style={{ left: `${bm * zoomPxPerSec}px` }}
                                    className="absolute bottom-0.5 w-1.5 h-1.5 rounded-full bg-amber-300 shadow-sm"
                                    title={`Beat @ ${bm.toFixed(2)}s`}
                                  />
                                ))}
                          </div>
                        )}

                        {/* Right Trim Handle (touch-friendly 12px hitbox) */}
                        <div
                          onPointerDown={(e) => startClipDrag(e, clip, 'trim-right')}
                          className="touch-none absolute right-0 top-0 bottom-0 w-3 bg-amber-400/80 opacity-60 sm:opacity-0 group-hover:opacity-100 cursor-ew-resize"
                          title="Drag to Trim Out-Point"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Vertical Playhead Line */}
          <div
            style={{ left: `${160 + playheadTime * zoomPxPerSec}px` }}
            className="pointer-events-none absolute top-0 bottom-0 z-30 w-0.5 bg-amber-400"
          >
            <div className="w-3 h-3 -ml-[5px] bg-amber-400 rotate-45 rounded-[2px] shadow" />
          </div>
        </div>
      </div>
    </section>
  );
};
