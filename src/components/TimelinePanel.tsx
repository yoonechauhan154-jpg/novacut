import React, { useEffect, useRef, useState } from 'react';
import {
  Copy,
  Diamond,
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

const TRACK_HEADER_WIDTH = 108;

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
  scrollToTimeTrigger?: { time: number; seq: number } | null;
  onSelectClip: (id: string | null) => void;
  onSeek: (time: number) => void;
  onPlayheadDrag?: (time: number) => void;
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
  scrollToTimeTrigger,
  onSelectClip,
  onSeek,
  onPlayheadDrag,
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

  // Playhead scrub state
  const [scrubState, setScrubState] = useState<{
    initialX: number;
    initialTime: number;
  } | null>(null);

  const selectedClip = clips.find((c) => c.id === selectedClipId) || null;
  const timelineDuration = Math.max(10, Math.ceil(totalDuration + 3));
  const timelineWidthPx = timelineDuration * zoomPxPerSec;

  // Scroll timeline to newly added clip when requested
  useEffect(() => {
    if (!scrollToTimeTrigger || !scrollContainerRef.current) return;
    const targetLeft = Math.max(0, scrollToTimeTrigger.time * zoomPxPerSec - 40);
    scrollContainerRef.current.scrollTo({
      left: targetLeft,
      behavior: 'smooth',
    });
  }, [scrollToTimeTrigger, zoomPxPerSec]);

  const TRACK_DEFINITIONS: {
    type: TrackType;
    i18nKey: string;
    badge: string;
    colorClass: string;
  }[] = [
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
    {
      type: 'text',
      i18nKey: 'trackText',
      badge: 'TXT',
      colorClass: 'bg-amber-500/20 border-amber-500/50 text-amber-200',
    },
    {
      type: 'overlay',
      i18nKey: 'trackOverlay',
      badge: 'PIP',
      colorClass: 'bg-sky-500/20 border-sky-500/50 text-sky-200',
    },
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
      type: 'sticker',
      i18nKey: 'trackSticker',
      badge: 'STK',
      colorClass: 'bg-rose-500/20 border-rose-500/50 text-rose-200',
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
    const clickX = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
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
    if (scrubState) {
      setScrubState(null);
    }
  };

  const startPlayheadScrub = (e: React.PointerEvent) => {
    e.stopPropagation();
    try {
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore
    }
    if (!scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
    const targetSec = Math.max(0, Math.min(timelineDuration, clickX / zoomPxPerSec));
    setScrubState({ initialX: e.clientX, initialTime: targetSec });
    if (onPlayheadDrag) onPlayheadDrag(targetSec);
  };

  const handlePlayheadPointerMove = (e: React.PointerEvent) => {
    if (!scrubState) return;
    if (!scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const clickX = e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH;
    let targetSec = Math.max(0, Math.min(timelineDuration, clickX / zoomPxPerSec));
    // Auto-scroll near left/right edges while dragging
    const edgeZone = 60;
    const containerWidth = rect.width;
    const relX = e.clientX - rect.left;
    if (relX < edgeZone) {
      scrollContainerRef.current.scrollLeft -= 12;
    } else if (relX > containerWidth - edgeZone) {
      scrollContainerRef.current.scrollLeft += 12;
    }
    if (onPlayheadDrag) onPlayheadDrag(targetSec);
  };

  const handleTrackDrop = (e: React.DragEvent<HTMLDivElement>, trackType: TrackType) => {
    e.preventDefault();
    if (!scrollContainerRef.current) return;
    const rect = scrollContainerRef.current.getBoundingClientRect();
    const scrollLeft = scrollContainerRef.current.scrollLeft;
    const dropX = Math.max(0, e.clientX - rect.left + scrollLeft - TRACK_HEADER_WIDTH);
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

  return (
    <section
      className="flex flex-col bg-[#0B0F17] border-t border-slate-800/90 select-none shrink-0 min-w-0 w-full"
      onPointerMove={(e) => { handlePointerMove(e); handlePlayheadPointerMove(e); }}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {/* Compact CapCut-Style Scrollable Action Toolbar Row */}
      <div className="flex items-center justify-between gap-1.5 px-2 py-1 bg-[#0E131F] border-b border-slate-800/80 min-w-0">
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5 min-w-0 flex-1">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label={t(lang, 'btnUndo')}
            className="min-h-[40px] min-w-[44px] px-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-35 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span className="text-[11px] leading-none">{t(lang, 'btnUndo')}</span>
          </button>

          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label={t(lang, 'btnRedo')}
            className="min-h-[40px] min-w-[44px] px-2 rounded-lg text-xs font-medium text-slate-200 hover:bg-slate-800 disabled:opacity-35 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="text-[11px] leading-none">{t(lang, 'btnRedo')}</span>
          </button>

          <div className="h-5 w-px bg-slate-800 mx-0.5 shrink-0" />

          <button
            type="button"
            onClick={onSplitAtPlayhead}
            disabled={!selectedClip}
            aria-label={t(lang, 'btnSplit')}
            className="min-h-[40px] min-w-[48px] px-2 rounded-lg text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-100 disabled:opacity-35 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <Scissors className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] leading-none">{t(lang, 'btnSplit')}</span>
          </button>

          <button
            type="button"
            onClick={onDeleteSelected}
            disabled={!selectedClip}
            aria-label={t(lang, 'btnDelete')}
            className="min-h-[40px] min-w-[48px] px-2 rounded-lg text-xs font-medium bg-rose-950/60 hover:bg-rose-900/70 text-rose-200 disabled:opacity-35 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <Trash2 className="w-3.5 h-3.5 text-rose-400" />
            <span className="text-[11px] leading-none">{t(lang, 'btnDelete')}</span>
          </button>

          <button
            type="button"
            onClick={onDuplicateSelected}
            disabled={!selectedClip}
            aria-label={t(lang, 'btnDuplicate')}
            className="min-h-[40px] min-w-[52px] px-2 rounded-lg text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-100 disabled:opacity-35 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <Copy className="w-3.5 h-3.5 text-sky-400" />
            <span className="text-[11px] leading-none">{t(lang, 'btnDuplicate')}</span>
          </button>

          <button
            type="button"
            onClick={onAddKeyframeAtPlayhead}
            disabled={!selectedClip}
            aria-label={t(lang, 'btnAddKeyframe')}
            className="min-h-[40px] min-w-[52px] px-2 rounded-lg text-xs font-medium bg-slate-800/90 hover:bg-slate-700 text-slate-100 disabled:opacity-35 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <Diamond className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-[11px] leading-none">{t(lang, 'btnAddKeyframe')}</span>
          </button>

          <button
            type="button"
            onClick={onToggleReverseSelected}
            disabled={!selectedClip}
            aria-label={t(lang, 'btnReverse')}
            className={`min-h-[40px] min-w-[48px] px-2 rounded-lg text-xs font-medium flex flex-col items-center justify-center gap-0.5 shrink-0 ${
              selectedClip?.reversed
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800/90 text-slate-200 disabled:opacity-35'
            }`}
          >
            <Rewind className="w-3.5 h-3.5" />
            <span className="text-[11px] leading-none">{t(lang, 'btnReverse')}</span>
          </button>

          <button
            type="button"
            onClick={onToggleFreezeSelected}
            disabled={!selectedClip}
            aria-label={t(lang, 'btnFreeze')}
            className={`min-h-[40px] min-w-[48px] px-2 rounded-lg text-xs font-medium flex flex-col items-center justify-center gap-0.5 shrink-0 ${
              selectedClip?.frozen
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'bg-slate-800/90 text-slate-200 disabled:opacity-35'
            }`}
          >
            <Snowflake className="w-3.5 h-3.5" />
            <span className="text-[11px] leading-none">{t(lang, 'btnFreeze')}</span>
          </button>

          <button
            type="button"
            onClick={onCreateAdjustmentLayer}
            aria-label={t(lang, 'btnAddAdjustment')}
            className="min-h-[40px] px-2.5 rounded-lg text-xs font-semibold bg-cyan-500/15 border border-cyan-500/40 text-cyan-200 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <Sliders className="w-3.5 h-3.5 text-cyan-400" />
            <span className="text-[11px] leading-none">{t(lang, 'btnAddAdjustment')}</span>
          </button>

          <button
            type="button"
            onClick={() => onCreateEffectLayer('light-leak', playheadTime)}
            aria-label={t(lang, 'btnAddEffectLayer')}
            className="min-h-[40px] px-2.5 rounded-lg text-xs font-semibold bg-fuchsia-500/15 border border-fuchsia-500/40 text-fuchsia-200 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
            <span className="text-[11px] leading-none">{t(lang, 'btnAddEffectLayer')}</span>
          </button>

          <button
            type="button"
            onClick={onAutoBeatCut}
            aria-label={t(lang, 'btnAutoBeatCut')}
            className="min-h-[40px] px-2.5 rounded-lg text-xs font-medium bg-emerald-500/15 border border-emerald-500/40 text-emerald-200 flex flex-col items-center justify-center gap-0.5 shrink-0"
          >
            <Wand2 className="w-3.5 h-3.5 text-emerald-400" />
            <span className="text-[11px] leading-none">{t(lang, 'btnAutoBeatCut')}</span>
          </button>

          <button
            type="button"
            onClick={onToggleMagneticSnap}
            aria-label={t(lang, 'btnSnap')}
            className={`min-h-[40px] px-2 rounded-lg text-xs font-medium flex flex-col items-center justify-center gap-0.5 shrink-0 ${
              magneticSnap
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'bg-slate-800 text-slate-400'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
            <span className="text-[11px] leading-none">{t(lang, 'btnSnap')}</span>
          </button>

          <button
            type="button"
            onClick={() => onZoomChange(Math.max(35, zoomPxPerSec - 15))}
            aria-label="Zoom Out Timeline"
            className="min-h-[40px] min-w-[38px] rounded-lg bg-slate-900 text-slate-300 flex items-center justify-center shrink-0"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => onZoomChange(Math.min(130, zoomPxPerSec + 15))}
            aria-label="Zoom In Timeline"
            className="min-h-[40px] min-w-[38px] rounded-lg bg-slate-900 text-slate-300 flex items-center justify-center shrink-0"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Multi-Track Scrollable Timeline Area */}
      <div
        ref={scrollContainerRef}
        className="relative overflow-x-auto overflow-y-auto h-[168px] sm:h-[205px]"
        onPointerDown={handleRulerPointerDown}
        onTouchStart={handleTouchStartPinch}
        onTouchMove={handleTouchMovePinch}
        onTouchEnd={handleTouchEndPinch}
      >
        <div
          className="relative min-w-full"
          style={{ width: `${TRACK_HEADER_WIDTH + timelineWidthPx}px` }}
        >
          {/* Time Ruler Row */}
          <div className="sticky top-0 z-20 flex h-5 bg-[#0D131F] border-b border-slate-800/90">
            <div
              style={{ width: `${TRACK_HEADER_WIDTH}px` }}
              className="sticky left-0 z-30 shrink-0 bg-[#0D131F] border-r border-slate-800 px-2 flex items-center justify-between text-[11px] font-medium text-slate-400"
            >
              <span>{lang === 'hi' ? 'ट्रैक्स' : 'Tracks'}</span>
              <span className="font-mono tabular-nums text-[10px]">
                {Math.round(zoomPxPerSec)}px/s
              </span>
            </div>
            <div className="relative flex-1" style={{ touchAction: 'none' }} onPointerDown={handleRulerPointerDown}>
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
                className="flex h-8 border-b border-slate-800/60 bg-[#0B0F17] hover:bg-[#0E1420] transition-colors"
              >
                {/* Sticky Left Track Header */}
                <div
                  onPointerDown={(e) => e.stopPropagation()}
                  style={{ width: `${TRACK_HEADER_WIDTH}px` }}
                  className="sticky left-0 z-20 shrink-0 bg-[#0F1522] border-r border-slate-800 px-2 flex items-center justify-between"
                >
                  <div className="flex items-center gap-1 truncate pr-0.5 min-w-0">
                    <span className="font-mono text-[10px] font-bold text-amber-400/90 shrink-0">
                      {track.badge}
                    </span>
                    <span className="text-[11px] font-medium text-slate-200 truncate">
                      {t(lang, track.i18nKey)}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleTrackMute(track.type)}
                    aria-label={allMuted ? 'Unmute track' : 'Mute track'}
                    className="min-w-[28px] min-h-[28px] flex items-center justify-center rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 shrink-0"
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
                    const widthPx = Math.max(26, clip.duration * zoomPxPerSec);

                    return (
                      <div
                        key={clip.id}
                        onPointerDown={(e) => startClipDrag(e, clip, 'move')}
                        style={{
                          left: `${leftPx}px`,
                          width: `${widthPx}px`,
                        }}
                        className={`group touch-none absolute top-0.5 bottom-0.5 rounded-md border px-2 flex items-center justify-between cursor-grab active:cursor-grabbing overflow-hidden transition-shadow ${
                          track.colorClass
                        } ${
                          isSelected
                            ? 'ring-2 ring-amber-400 shadow-md z-10'
                            : 'hover:brightness-110'
                        } ${clip.muted ? 'opacity-40' : ''}`}
                      >
                        {/* Left Trim Handle (touch-friendly 14px hitbox) */}
                        <div
                          onPointerDown={(e) => startClipDrag(e, clip, 'trim-left')}
                          className="touch-none absolute left-0 top-0 bottom-0 w-3.5 bg-amber-400/80 opacity-75 sm:opacity-0 group-hover:opacity-100 cursor-ew-resize"
                          title="Drag to Trim In-Point"
                        />

                        {/* Clip Thumbnail + Title */}
                        <div className="flex items-center gap-1.5 truncate text-xs font-medium pointer-events-none pl-1">
                          {clip.thumbnailUrl && (
                            <img
                              src={clip.thumbnailUrl}
                              alt=""
                              className="w-4 h-5 object-cover rounded-xs shrink-0 border border-white/20"
                            />
                          )}
                          <span className="truncate text-[11px]">
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
                          <div className="absolute inset-x-0 bottom-0.5 flex items-end h-2 pointer-events-none opacity-65">
                            {clip.beatMarkers &&
                              clip.beatMarkers
                                .filter((bm) => bm < clip.duration)
                                .map((bm, idx) => (
                                  <span
                                    key={idx}
                                    style={{ left: `${bm * zoomPxPerSec}px` }}
                                    className="absolute bottom-0.5 w-1.5 h-1.5 rounded-full bg-amber-300 shadow-sm"
                                  />
                                ))}
                          </div>
                        )}

                        {/* Right Trim Handle (touch-friendly 14px hitbox) */}
                        <div
                          onPointerDown={(e) => startClipDrag(e, clip, 'trim-right')}
                          className="touch-none absolute right-0 top-0 bottom-0 w-3.5 bg-amber-400/80 opacity-75 sm:opacity-0 group-hover:opacity-100 cursor-ew-resize"
                          title="Drag to Trim Out-Point"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Vertical Playhead Line — draggable with 44px touch area */}
          <div
            style={{
              left: `${TRACK_HEADER_WIDTH + playheadTime * zoomPxPerSec - 22}px`,
              touchAction: 'none',
            }}
            className="absolute top-0 bottom-0 z-30 w-[44px]"
            onPointerDown={startPlayheadScrub}
          >
            <div className="absolute left-1/2 -ml-[1px] top-0 bottom-0 w-[2px] bg-amber-400" />
            <div className="absolute left-1/2 -ml-[6px] -top-2 h-4 w-4 flex items-center justify-center">
              <div className="w-3 h-3 bg-amber-400 rotate-45 rounded-[2px] shadow" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
