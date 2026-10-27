import { FILTER_PRESETS } from '../data/presets';
import {
  AspectRatioKey,
  ColorAdjustments,
  KeyframePoint,
  MaskShapeType,
  ProjectData,
  TimelineClip,
  VideoEffectType,
} from '../types/editor';

export function getAspectDimensions(
  ratio: AspectRatioKey,
  qualityMode: 'preview-540p' | 'export-full' = 'preview-540p',
  projectRes: ProjectData['resolution'] = '1080p'
): { width: number; height: number } {
  const mult =
    qualityMode === 'preview-540p'
      ? 1.0
      : projectRes === '480p'
      ? 0.85
      : projectRes === '720p'
      ? 1.333
      : projectRes === '1080p'
      ? 2.0
      : 2.0; // cap canvas buffer to 1080p equivalent on mobile WebView to prevent OOM

  const scaleDim = (w: number, h: number) => ({
    width: Math.round((w * mult) / 2) * 2,
    height: Math.round((h * mult) / 2) * 2,
  });

  switch (ratio) {
    case '9:16':
      return scaleDim(540, 960);
    case '16:9':
      return scaleDim(960, 540);
    case '1:1':
      return scaleDim(640, 640);
    case '4:5':
      return scaleDim(540, 675);
    case '4:3':
      return scaleDim(720, 540);
    case '21:9':
      return scaleDim(960, 412);
    default:
      return scaleDim(540, 960);
  }
}

export function interpolateKeyframes(
  keyframes: KeyframePoint[],
  clipTimeOffset: number,
  defaults: {
    scale: number;
    x: number;
    y: number;
    rotation: number;
    opacity: number;
    effectIntensity: number;
    brightness: number;
  }
) {
  if (!keyframes || keyframes.length === 0) return defaults;
  const sorted = [...keyframes].sort((a, b) => a.timeOffset - b.timeOffset);

  if (clipTimeOffset <= sorted[0].timeOffset) {
    const first = sorted[0];
    return {
      scale: first.scale,
      x: first.x,
      y: first.y,
      rotation: first.rotation,
      opacity: first.opacity,
      effectIntensity: first.effectIntensity ?? defaults.effectIntensity,
      brightness: first.brightness ?? defaults.brightness,
    };
  }
  const last = sorted[sorted.length - 1];
  if (clipTimeOffset >= last.timeOffset) {
    return {
      scale: last.scale,
      x: last.x,
      y: last.y,
      rotation: last.rotation,
      opacity: last.opacity,
      effectIntensity: last.effectIntensity ?? defaults.effectIntensity,
      brightness: last.brightness ?? defaults.brightness,
    };
  }

  for (let i = 0; i < sorted.length - 1; i++) {
    const k1 = sorted[i];
    const k2 = sorted[i + 1];
    if (clipTimeOffset >= k1.timeOffset && clipTimeOffset <= k2.timeOffset) {
      const span = Math.max(0.001, k2.timeOffset - k1.timeOffset);
      let t = (clipTimeOffset - k1.timeOffset) / span;
      if (k1.easing === 'ease-in-out') {
        t = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
      } else if (k1.easing === 'ease-out-back') {
        const c1 = 1.70158;
        const c3 = c1 + 1;
        t = 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
      } else if (k1.easing === 'cubic-bezier') {
        t = t * t * (3 - 2 * t);
      }
      const i1 = k1.effectIntensity ?? defaults.effectIntensity;
      const i2 = k2.effectIntensity ?? defaults.effectIntensity;
      const b1 = k1.brightness ?? defaults.brightness;
      const b2 = k2.brightness ?? defaults.brightness;
      return {
        scale: k1.scale + (k2.scale - k1.scale) * t,
        x: k1.x + (k2.x - k1.x) * t,
        y: k1.y + (k2.y - k1.y) * t,
        rotation: k1.rotation + (k2.rotation - k1.rotation) * t,
        opacity: k1.opacity + (k2.opacity - k1.opacity) * t,
        effectIntensity: i1 + (i2 - i1) * t,
        brightness: b1 + (b2 - b1) * t,
      };
    }
  }
  return defaults;
}

function applyMaskPath(
  ctx: CanvasRenderingContext2D,
  shape: MaskShapeType,
  w: number,
  h: number,
  invert: boolean,
  customPoints?: { x: number; y: number }[]
) {
  if (shape === 'none') return;
  ctx.beginPath();

  if (invert) {
    ctx.rect(0, 0, w, h);
  }

  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w, h) * 0.42;

  if (shape === 'circle') {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  } else if (shape === 'rectangle') {
    const rw = w * 0.76;
    const rh = h * 0.76;
    ctx.roundRect(cx - rw / 2, cy - rh / 2, rw, rh, 24);
  } else if (shape === 'linear' || shape === 'linear-split') {
    ctx.rect(0, 0, w, h * 0.62);
  } else if (shape === 'heart') {
    const topCurveHeight = r * 0.3;
    ctx.moveTo(cx, cy + r * 0.7);
    ctx.bezierCurveTo(cx - r, cy + r * 0.2, cx - r, cy - r * 0.6, cx, cy - topCurveHeight);
    ctx.bezierCurveTo(cx + r, cy - r * 0.6, cx + r, cy + r * 0.2, cx, cy + r * 0.7);
  } else if (shape === 'star') {
    const spikes = 5;
    const outerR = r;
    const innerR = r * 0.46;
    let rot = (Math.PI / 2) * 3;
    const step = Math.PI / spikes;
    ctx.moveTo(cx, cy - outerR);
    for (let i = 0; i < spikes; i++) {
      ctx.lineTo(cx + Math.cos(rot) * outerR, cy + Math.sin(rot) * outerR);
      rot += step;
      ctx.lineTo(cx + Math.cos(rot) * innerR, cy + Math.sin(rot) * innerR);
      rot += step;
    }
    ctx.closePath();
  } else if (shape === 'custom-draw' && customPoints && customPoints.length >= 3) {
    ctx.moveTo(customPoints[0].x * w, customPoints[0].y * h);
    for (let i = 1; i < customPoints.length; i++) {
      ctx.lineTo(customPoints[i].x * w, customPoints[i].y * h);
    }
    ctx.closePath();
  } else {
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
  }

  ctx.clip(invert ? 'evenodd' : 'nonzero');
}

function buildCssFilterString(
  filterPreset: string,
  adj: ColorAdjustments,
  overrideBrightness?: number
): string {
  const filterObj = FILTER_PRESETS.find((f) => f.id === filterPreset);
  const bVal = overrideBrightness !== undefined ? overrideBrightness : adj.brightness;
  const bright = Math.max(
    10,
    100 + bVal + adj.exposure * 0.55 + (adj.highlights || 0) * 0.3 + (adj.shadows || 0) * 0.2
  );
  const cont = Math.max(
    15,
    100 + adj.contrast + (adj.highlights || 0) * 0.2 - (adj.shadows || 0) * 0.25 - adj.fade * 0.25
  );
  const sat = Math.max(0, 100 + adj.saturation);
  const sepia = Math.max(0, adj.temperature * 0.65);
  const hue = (adj.hue || 0) + adj.tint * 0.9;
  const blurPx = (adj.blur || 0) * 0.35;

  return `${filterObj?.css || ''} brightness(${bright.toFixed(1)}%) contrast(${cont.toFixed(
    1
  )}%) saturate(${sat.toFixed(1)}%) sepia(${sepia.toFixed(1)}%) hue-rotate(${hue.toFixed(
    1
  )}deg)${blurPx > 0.1 ? ` blur(${blurPx.toFixed(1)}px)` : ''}`.trim();
}

function drawProceduralScene(
  ctx: CanvasRenderingContext2D,
  preset: NonNullable<TimelineClip['scenePreset']>,
  localTime: number,
  w: number,
  h: number
) {
  ctx.save();

  if (preset === 'mumbai-drive') {
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(0.38, '#7C2D12');
    grad.addColorStop(0.65, '#EA580C');
    grad.addColorStop(0.75, '#F59E0B');
    grad.addColorStop(1, '#090D16');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    const sunY = h * 0.54 + Math.sin(localTime * 0.5) * 10;
    const sunGrad = ctx.createRadialGradient(w * 0.5, sunY, 10, w * 0.5, sunY, w * 0.36);
    sunGrad.addColorStop(0, 'rgba(254, 240, 138, 0.95)');
    sunGrad.addColorStop(0.4, 'rgba(249, 115, 22, 0.45)');
    sunGrad.addColorStop(1, 'rgba(249, 115, 22, 0)');
    ctx.fillStyle = sunGrad;
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#090D16';
    const buildings = [0.08, 0.14, 0.22, 0.18, 0.27, 0.19, 0.24, 0.15, 0.21, 0.12];
    const bw = w / buildings.length;
    buildings.forEach((bh, idx) => {
      const x = idx * bw;
      const top = h * 0.68 - bh * h;
      ctx.fillRect(x, top, bw - 2, h * 0.68 - top);
    });

    ctx.fillStyle = '#0B1120';
    ctx.fillRect(0, h * 0.68, w, h * 0.32);

    for (let i = 0; i < 22; i++) {
      const progress = (i / 22 + localTime * 0.08) % 1;
      const lx = w * 0.12 + Math.pow(progress, 1.3) * w * 0.78;
      const ly = h * 0.69 + progress * h * 0.26;
      const size = 2.5 + progress * 7;

      ctx.beginPath();
      ctx.fillStyle = i % 3 === 0 ? '#FDE047' : '#FB923C';
      ctx.arc(lx, ly, size, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = 'rgba(251, 191, 36, 0.28)';
      ctx.fillRect(lx - size * 3, ly + 8, size * 6, 2.5);
    }
  } else if (preset === 'wedding-haldi') {
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, '#78350F');
    grad.addColorStop(0.45, '#B45309');
    grad.addColorStop(0.85, '#D97706');
    grad.addColorStop(1, '#451A03');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    for (let col = 0; col < 7; col++) {
      const gx = (w / 6) * col + Math.sin(localTime * 2 + col) * 6;
      for (let row = 0; row < 10; row++) {
        const gy = row * 38 + 20;
        ctx.beginPath();
        ctx.fillStyle = (row + col) % 2 === 0 ? '#FACC15' : '#EA580C';
        ctx.arc(gx, gy, 12, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    for (let p = 0; p < 28; p++) {
      const px = ((p * 73 + localTime * (45 + (p % 5) * 12)) % (w + 60)) - 30;
      const py = ((p * 97 + localTime * (65 + (p % 4) * 18)) % (h + 60)) - 30;
      const radius = 5 + (p % 4) * 4;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(localTime * 1.5 + p);
      ctx.fillStyle = p % 3 === 0 ? 'rgba(254, 240, 138, 0.85)' : 'rgba(251, 146, 60, 0.8)';
      ctx.beginPath();
      ctx.ellipse(0, 0, radius, radius * 0.55, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else if (preset === 'himalaya-sunrise') {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#090D16');
    sky.addColorStop(0.35, '#1E3A8A');
    sky.addColorStop(0.62, '#38BDF8');
    sky.addColorStop(0.78, '#FDE047');
    sky.addColorStop(1, '#0F172A');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);

    const drawRidge = (yBase: number, amp: number, color: string, speed: number) => {
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 18) {
        const y =
          yBase +
          Math.sin((x + localTime * speed) * 0.012) * amp +
          Math.cos((x - localTime * speed * 0.6) * 0.028) * (amp * 0.45);
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fillStyle = color;
      ctx.fill();
    };

    drawRidge(h * 0.52, 55, '#1E293B', 14);
    drawRidge(h * 0.64, 42, '#0F172A', 26);
    drawRidge(h * 0.76, 28, '#090D16', 42);

    ctx.strokeStyle = '#F59E0B';
    ctx.lineWidth = 4;
    ctx.setLineDash([22, 18]);
    ctx.lineDashOffset = -localTime * 110;
    ctx.beginPath();
    ctx.moveTo(w * 0.5, h * 0.74);
    ctx.quadraticCurveTo(w * 0.35, h * 0.86, w * 0.52, h);
    ctx.stroke();
    ctx.setLineDash([]);
  } else if (preset === 'tech-studio') {
    ctx.fillStyle = '#090D16';
    ctx.fillRect(0, 0, w, h);

    ctx.fillStyle = '#1E293B';
    for (let x = 20; x < w; x += 28) {
      ctx.fillRect(x, 0, 12, h * 0.72);
    }

    const tealGlow = ctx.createRadialGradient(w * 0.22, h * 0.3, 10, w * 0.22, h * 0.3, w * 0.45);
    tealGlow.addColorStop(0, 'rgba(16, 185, 129, 0.38)');
    tealGlow.addColorStop(1, 'rgba(16, 185, 129, 0)');
    ctx.fillStyle = tealGlow;
    ctx.fillRect(0, 0, w, h);

    const warmGlow = ctx.createRadialGradient(
      w * 0.78,
      h * 0.38,
      10,
      w * 0.78,
      h * 0.38,
      w * 0.45
    );
    warmGlow.addColorStop(0, 'rgba(245, 158, 11, 0.36)');
    warmGlow.addColorStop(1, 'rgba(245, 158, 11, 0)');
    ctx.fillStyle = warmGlow;
    ctx.fillRect(0, 0, w, h);

    const cx = w * 0.5;
    const cy = h * 0.48;
    const pulse = 1 + Math.sin(localTime * 6) * 0.04;
    ctx.strokeStyle = '#38BDF8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) * 0.18 * pulse, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = '#0F172A';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(w, h) * 0.14, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, '#090D16');
    bg.addColorStop(0.5, '#1E1B4B');
    bg.addColorStop(1, '#0F172A');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    for (let i = 0; i < 18; i++) {
      const y = (i * 55 + localTime * 70) % h;
      const x = (Math.sin(i * 1.7 + localTime) * 0.38 + 0.5) * w;
      ctx.fillStyle = i % 2 === 0 ? 'rgba(244, 63, 94, 0.7)' : 'rgba(56, 189, 248, 0.7)';
      ctx.beginPath();
      ctx.arc(x, y, 8 + (i % 4) * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.restore();
}

/**
 * Renders any of our 18+ original procedural shaders/canvas video effects onto `ctx`.
 * Works both when applied directly to a clip AND when applied via a non-destructive Effect Overlay Layer!
 */
export function applyProceduralEffectToCanvas(
  ctx: CanvasRenderingContext2D,
  effect: VideoEffectType,
  intensityPct: number,
  playheadTime: number,
  w: number,
  h: number
) {
  if (effect === 'none' || intensityPct <= 0) return;
  const amt = Math.max(0.05, Math.min(1, intensityPct / 100));
  ctx.save();

  switch (effect) {
    case 'glitch':
    case 'glitch-rgb': {
      // Digital slice displacement + RGB bands
      const numSlices = Math.floor(4 + amt * 6);
      for (let i = 0; i < numSlices; i++) {
        const sy = ((i * 137 + Math.floor(playheadTime * 24) * 53) % (h - 30));
        const sh = 8 + (i % 3) * 12;
        const shift = Math.sin(playheadTime * 45 + i * 2) * 26 * amt;
        ctx.drawImage(ctx.canvas, 0, sy, w, sh, shift, sy, w, sh);
      }
      ctx.fillStyle = `rgba(244, 63, 94, ${0.22 * amt})`;
      ctx.fillRect(8 * amt, (playheadTime * 240) % h, w, 24);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.22 * amt})`;
      ctx.fillRect(-8 * amt, ((playheadTime * 240) + 16) % h, w, 18);
      break;
    }

    case 'rgb-split': {
      const offset = 12 * amt;
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.45 * amt;
      ctx.drawImage(ctx.canvas, -offset, 0, w, h);
      ctx.drawImage(ctx.canvas, offset, 0, w, h);
      ctx.fillStyle = `rgba(244, 63, 94, ${0.15 * amt})`;
      ctx.fillRect(-offset, 0, w, h);
      ctx.fillStyle = `rgba(56, 189, 248, ${0.15 * amt})`;
      ctx.fillRect(offset, 0, w, h);
      break;
    }

    case 'light-leak': {
      ctx.globalCompositeOperation = 'screen';
      const lx = (0.5 + Math.sin(playheadTime * 1.4) * 0.4) * w;
      const ly = (0.35 + Math.cos(playheadTime * 1.1) * 0.3) * h;
      const leakGrad = ctx.createRadialGradient(lx, ly, 10, lx, ly, Math.max(w, h) * 0.65);
      leakGrad.addColorStop(0, `rgba(254, 240, 138, ${0.78 * amt})`);
      leakGrad.addColorStop(0.35, `rgba(249, 115, 22, ${0.52 * amt})`);
      leakGrad.addColorStop(0.7, `rgba(236, 72, 153, ${0.25 * amt})`);
      leakGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = leakGrad;
      ctx.fillRect(0, 0, w, h);
      break;
    }

    case 'vhs':
    case 'vhs-retro': {
      // CRT Scanlines + VHS tracking bar + timestamp
      ctx.fillStyle = `rgba(255, 255, 255, ${0.07 * amt})`;
      for (let y = 0; y < h; y += 5) {
        ctx.fillRect(0, y, w, 1.5);
      }
      const trackY = (playheadTime * 120) % h;
      ctx.fillStyle = `rgba(255, 255, 255, ${0.2 * amt})`;
      ctx.fillRect(0, trackY, w, 14);
      ctx.font = '600 16px "JetBrains Mono", monospace';
      ctx.fillStyle = `rgba(248, 250, 252, ${0.85 * amt})`;
      ctx.fillText('PLAY ► VHS SP', 24, 42);
      break;
    }

    case 'film-grain': {
      ctx.fillStyle = `rgba(255, 255, 255, ${0.18 * amt})`;
      for (let g = 0; g < 90; g++) {
        const gx = (g * 97 + playheadTime * 1237) % w;
        const gy = (g * 53 + playheadTime * 883) % h;
        ctx.fillRect(gx, gy, 2.2, 2.2);
      }
      break;
    }

    case 'flash':
    case 'beat-flash': {
      const flashVal = Math.max(0, Math.sin(playheadTime * 15) - (1 - amt * 0.6));
      if (flashVal > 0) {
        ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(0.92, flashVal * 1.6)})`;
        ctx.fillRect(0, 0, w, h);
      }
      break;
    }

    case 'kaleidoscope': {
      // 4-Quadrant Mirror Kaleidoscope
      const hw = w / 2;
      const hh = h / 2;
      // Top-Right mirrored horizontally
      ctx.save();
      ctx.translate(w, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(ctx.canvas, 0, 0, hw, hh, 0, 0, hw, hh);
      ctx.restore();
      // Bottom-Left mirrored vertically
      ctx.save();
      ctx.translate(0, h);
      ctx.scale(1, -1);
      ctx.drawImage(ctx.canvas, 0, 0, hw, hh, 0, 0, hw, hh);
      ctx.restore();
      // Bottom-Right mirrored both
      ctx.save();
      ctx.translate(w, h);
      ctx.scale(-1, -1);
      ctx.drawImage(ctx.canvas, 0, 0, hw, hh, 0, 0, hw, hh);
      ctx.restore();
      break;
    }

    case 'pixelate': {
      const blockSize = Math.max(6, Math.floor(22 * amt));
      ctx.imageSmoothingEnabled = false;
      const sw = Math.max(16, Math.floor(w / blockSize));
      const sh = Math.max(16, Math.floor(h / blockSize));
      ctx.drawImage(ctx.canvas, 0, 0, w, h, 0, 0, sw, sh);
      ctx.drawImage(ctx.canvas, 0, 0, sw, sh, 0, 0, w, h);
      ctx.imageSmoothingEnabled = true;
      break;
    }

    case 'blur': {
      ctx.filter = `blur(${(14 * amt).toFixed(1)}px)`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';
      break;
    }

    case 'glow':
    case 'dream-glow': {
      ctx.globalCompositeOperation = 'screen';
      ctx.globalAlpha = 0.55 * amt;
      ctx.filter = `blur(${(16 * amt).toFixed(1)}px) brightness(130%)`;
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';
      break;
    }

    case 'ripple-wave': {
      const stripH = 12;
      for (let y = 0; y < h; y += stripH) {
        const waveX = Math.sin(y * 0.04 + playheadTime * 8) * 14 * amt;
        ctx.drawImage(ctx.canvas, 0, y, w, stripH, waveX, y, w, stripH);
      }
      break;
    }

    case 'whip-pan': {
      const whipOffset = Math.sin(playheadTime * 16) * 45 * amt;
      ctx.globalAlpha = 0.45 * amt;
      ctx.drawImage(ctx.canvas, whipOffset, 0);
      ctx.drawImage(ctx.canvas, -whipOffset * 0.6, 0);
      break;
    }

    case 'zoom-punch':
    case 'zoom-pulse': {
      const zp = 1 + Math.abs(Math.sin(playheadTime * 7)) * 0.16 * amt;
      ctx.translate(w / 2, h / 2);
      ctx.scale(zp, zp);
      ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(ctx.canvas, 0, 0);
      break;
    }

    case 'spin': {
      const angle = playheadTime * 2.5 * amt;
      ctx.translate(w / 2, h / 2);
      ctx.rotate(angle);
      ctx.scale(1.25, 1.25);
      ctx.translate(-w / 2, -h / 2);
      ctx.drawImage(ctx.canvas, 0, 0);
      break;
    }

    case 'cinematic-bars': {
      const barH = h * (0.09 * amt);
      ctx.fillStyle = '#04060A';
      ctx.fillRect(0, 0, w, barH);
      ctx.fillRect(0, h - barH, w, barH);
      break;
    }

    case 'neon-edge': {
      ctx.strokeStyle = '#38BDF8';
      ctx.lineWidth = 6 * amt;
      ctx.strokeRect(12, 12, w - 24, h - 24);
      break;
    }

    default:
      break;
  }

  ctx.restore();
}

export function renderProjectFrame(
  ctx: CanvasRenderingContext2D,
  project: ProjectData,
  playheadTime: number,
  mediaElementCache: Map<string, HTMLVideoElement | HTMLImageElement>,
  qualityMode: 'preview-540p' | 'export-full' = 'preview-540p',
  isPlaying: boolean = false
) {
  const { width: w, height: h } = getAspectDimensions(
    project.aspectRatio,
    qualityMode,
    project.resolution
  );
  if (ctx.canvas.width !== w || ctx.canvas.height !== h) {
    ctx.canvas.width = w;
    ctx.canvas.height = h;
  }

  ctx.save();
  ctx.clearRect(0, 0, w, h);

  // 1. Canvas Background
  if (project.background.type === 'solid') {
    ctx.fillStyle = project.background.solidColor;
    ctx.fillRect(0, 0, w, h);
  } else {
    const bgGrad = ctx.createLinearGradient(0, 0, w, h);
    bgGrad.addColorStop(0, project.background.gradientFrom);
    bgGrad.addColorStop(1, project.background.gradientTo);
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, w, h);
  }

  // Strictly ordered non-destructive track hierarchy:
  // 1: video (Main Video)
  // 2: overlay (PIP Overlays)
  // 3: adjustment (Non-destructive Adjustment Layers — applies to everything below it!)
  // 4: effect-layer (Non-destructive Effect Overlay Layers — applies shader/canvas FX to everything below it!)
  // 5: sticker (Stickers)
  // 6: text (Devanagari / English Captions & Titles)
  const trackOrder: Record<string, number> = {
    video: 1,
    overlay: 2,
    adjustment: 3,
    'effect-layer': 4,
    sticker: 5,
    text: 6,
  };

  const activeClips = project.clips
    .filter(
      (c) =>
        c.trackType !== 'audio' &&
        !c.muted &&
        playheadTime >= c.startTime &&
        playheadTime <= c.startTime + c.duration
    )
    .sort((a, b) => (trackOrder[a.trackType] || 99) - (trackOrder[b.trackType] || 99));

  for (const clip of activeClips) {
    const rawOffset = playheadTime - clip.startTime;
    let effectiveOffset =
      clip.frozen || clip.effect === 'freeze' ? clip.inPoint : rawOffset * clip.speed;

    if (clip.speedCurve === 'montage' || clip.effect === 'speed-ramp') {
      effectiveOffset = rawOffset * (1 + Math.sin(rawOffset * 3.5) * 0.65);
    } else if (clip.speedCurve === 'hero-bullet') {
      effectiveOffset = rawOffset < clip.duration * 0.4 ? rawOffset * 1.8 : rawOffset * 0.35;
    }

    if (clip.reversed) {
      effectiveOffset = Math.max(0, clip.duration - effectiveOffset);
    }

    const kf = interpolateKeyframes(clip.keyframes, rawOffset, {
      scale: clip.scale,
      x: clip.posX,
      y: clip.posY,
      rotation: clip.rotation,
      opacity: clip.opacity,
      effectIntensity: clip.effectIntensity ?? 75,
      brightness: clip.adjustments.brightness,
    });

    // Motion Tracking: If this text/sticker is linked to a target video/PIP clip, inherit its keyframed X/Y delta!
    let trackedX = kf.x;
    let trackedY = kf.y;
    if (clip.motionTrackTargetId) {
      const target = project.clips.find((tc) => tc.id === clip.motionTrackTargetId);
      if (target && playheadTime >= target.startTime && playheadTime <= target.startTime + target.duration) {
        const targetKf = interpolateKeyframes(target.keyframes, playheadTime - target.startTime, {
          scale: target.scale,
          x: target.posX,
          y: target.posY,
          rotation: target.rotation,
          opacity: target.opacity,
          effectIntensity: 75,
          brightness: 0,
        });
        trackedX += targetKf.x;
        trackedY += targetKf.y;
      }
    }

    // =========================================================================
    // CASE A: NON-DESTRUCTIVE ADJUSTMENT LAYER (applies to everything below it)
    // =========================================================================
    if (clip.trackType === 'adjustment') {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, kf.opacity));
      ctx.globalCompositeOperation = clip.blendMode || 'source-over';
      applyMaskPath(ctx, clip.maskShape, w, h, clip.maskInvert, clip.customMaskPoints);

      ctx.filter = buildCssFilterString(clip.filterPreset, clip.adjustments, kf.brightness);
      ctx.drawImage(ctx.canvas, 0, 0);
      ctx.filter = 'none';

      // Vignette on Adjustment Layer
      if (clip.adjustments.vignette > 0) {
        const vig = ctx.createRadialGradient(w / 2, h / 2, w * 0.22, w / 2, h / 2, w * 0.72);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, `rgba(0,0,0,${(clip.adjustments.vignette / 100) * 0.78})`);
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, w, h);
      }

      // Film Grain on Adjustment Layer
      if (clip.adjustments.grain > 0) {
        ctx.fillStyle = `rgba(255,255,255,${(clip.adjustments.grain / 100) * 0.15})`;
        for (let g = 0; g < 65; g++) {
          const gx = (g * 97 + playheadTime * 997) % w;
          const gy = (g * 53 + playheadTime * 613) % h;
          ctx.fillRect(gx, gy, 2, 2);
        }
      }

      ctx.restore();
      continue;
    }

    // =========================================================================
    // CASE B: NON-DESTRUCTIVE EFFECT OVERLAY LAYER (applies to everything below)
    // =========================================================================
    if (clip.trackType === 'effect-layer') {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, kf.opacity));
      ctx.globalCompositeOperation = clip.blendMode || 'source-over';
      applyMaskPath(ctx, clip.maskShape, w, h, clip.maskInvert, clip.customMaskPoints);
      applyProceduralEffectToCanvas(ctx, clip.effect, kf.effectIntensity, playheadTime, w, h);
      ctx.restore();
      continue;
    }

    // =========================================================================
    // CASE C: VIDEO, PIP OVERLAY, STICKER, AND TEXT CLIPS
    // =========================================================================
    ctx.save();

    // Transition-In calculation (all 11 transitions)
    let transAlpha = 1;
    let transOffsetX = 0;
    let transScale = 1;
    if (clip.transitionIn !== 'none' && rawOffset < clip.transitionDuration) {
      const p = Math.max(0, Math.min(1, rawOffset / Math.max(0.1, clip.transitionDuration)));
      if (clip.transitionIn === 'fade' || clip.transitionIn === 'dissolve') {
        transAlpha = p;
      } else if (clip.transitionIn === 'luma-fade') {
        transAlpha = Math.pow(p, 0.7);
      } else if (clip.transitionIn === 'slide' || clip.transitionIn === 'slide-left') {
        transOffsetX = (1 - p) * w * 0.65;
      } else if (clip.transitionIn === 'whip-pan') {
        transOffsetX = (1 - p) * w * 0.95;
      } else if (clip.transitionIn === 'zoom' || clip.transitionIn === 'zoom-in') {
        transScale = 0.45 + p * 0.55;
        transAlpha = p;
      } else if (clip.transitionIn === 'cube') {
        transScale = 0.7 + p * 0.3;
        transOffsetX = (1 - p) * (w * 0.4);
      } else if (clip.transitionIn === 'wipe' || clip.transitionIn === 'wipe-right') {
        ctx.beginPath();
        ctx.rect(0, 0, w * p, h);
        ctx.clip();
      } else if (clip.transitionIn === 'ripple') {
        transScale = 1 + Math.sin(p * Math.PI * 3) * 0.06 * (1 - p);
        transAlpha = p;
      }
    }

    ctx.globalAlpha = Math.max(0, Math.min(1, kf.opacity * transAlpha));
    ctx.globalCompositeOperation = clip.blendMode || 'source-over';

    // Handheld Shake / Stabilization transform
    let shakeX = 0;
    let shakeY = 0;
    let effectScale = clip.stabilizationEnabled ? 1.06 : 1.0; // optical stabilization crop margin
    if (clip.effect === 'camera-shake' || clip.effect === 'shake') {
      const sAmt = (kf.effectIntensity / 100) * 10;
      shakeX = Math.sin(playheadTime * 42) * sAmt;
      shakeY = Math.cos(playheadTime * 38) * (sAmt * 0.8);
    }

    const centerX = w / 2 + (trackedX / 100) * (w / 2) + transOffsetX + shakeX;
    const centerY = h / 2 + (trackedY / 100) * (h / 2) + shakeY;

    ctx.translate(centerX, centerY);
    ctx.rotate((kf.rotation * Math.PI) / 180);
    ctx.scale(
      (clip.flipH ? -1 : 1) * kf.scale * transScale * effectScale,
      (clip.flipV ? -1 : 1) * kf.scale * transScale * effectScale
    );
    ctx.translate(-w / 2, -h / 2);

    // Apply Mask (or AI Background Remover silhouette mask)
    if (clip.bgRemovalEnabled) {
      ctx.beginPath();
      ctx.ellipse(w / 2, h * 0.52, w * 0.34, h * 0.42, 0, 0, Math.PI * 2);
      ctx.clip();
    } else {
      applyMaskPath(ctx, clip.maskShape, w, h, clip.maskInvert, clip.customMaskPoints);
    }

    ctx.filter = buildCssFilterString(clip.filterPreset, clip.adjustments, kf.brightness);

    if (clip.trackType === 'video' || clip.trackType === 'overlay') {
      if (
        (clip.sourceType === 'uploaded-video' || clip.sourceType === 'uploaded-image') &&
        clip.mediaUrl
      ) {
        const el = mediaElementCache.get(clip.id);
        if (el) {
          if (el instanceof HTMLVideoElement) {
            // Only seek when NOT playing — during playback let the video element
            // advance naturally. Seeking every frame while playing is the #1 cause of stutter on 1080p+ clips.
            // Source time = sourceStart + (timelineTime - startTime) * speed.
            if (!isPlaying) {
              const relTime = playheadTime - clip.startTime;
              const targetTime = (clip.sourceStart + relTime * clip.speed) % Math.max(0.5, el.duration || clip.duration);
              if (Math.abs(el.currentTime - targetTime) > 0.28) {
                el.currentTime = targetTime;
              }
            }
          }
          ctx.drawImage(el, 0, 0, w, h);
        } else {
          drawProceduralScene(ctx, clip.scenePreset || 'mumbai-drive', effectiveOffset, w, h);
        }
      } else {
        drawProceduralScene(ctx, clip.scenePreset || 'mumbai-drive', effectiveOffset, w, h);
      }

      ctx.filter = 'none';

      // Vignette on Clip
      if (clip.adjustments.vignette > 0) {
        const vig = ctx.createRadialGradient(w / 2, h / 2, w * 0.25, w / 2, h / 2, w * 0.72);
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, `rgba(0,0,0,${(clip.adjustments.vignette / 100) * 0.75})`);
        ctx.fillStyle = vig;
        ctx.fillRect(0, 0, w, h);
      }

      // Film Grain on Clip
      if (clip.adjustments.grain > 0) {
        ctx.fillStyle = `rgba(255,255,255,${(clip.adjustments.grain / 100) * 0.12})`;
        for (let g = 0; g < 45; g++) {
          const gx = (g * 97 + playheadTime * 997) % w;
          const gy = (g * 53 + playheadTime * 613) % h;
          ctx.fillRect(gx, gy, 2, 2);
        }
      }

      // Apply Clip's own Effect if set
      if (clip.effect !== 'none') {
        applyProceduralEffectToCanvas(ctx, clip.effect, kf.effectIntensity, playheadTime, w, h);
      }

      if (
        (clip.transitionIn === 'flash' ||
          clip.transitionIn === 'flash-white' ||
          clip.transitionIn === 'luma-fade') &&
        rawOffset < clip.transitionDuration
      ) {
        const flash = 1 - rawOffset / Math.max(0.1, clip.transitionDuration);
        ctx.fillStyle = `rgba(255,255,255,${flash * 0.75})`;
        ctx.fillRect(0, 0, w, h);
      }
    } else if (clip.trackType === 'sticker') {
      ctx.filter = 'none';
      const bounce = 1 + Math.sin(rawOffset * 6) * 0.06;
      ctx.font = `${Math.round(72 * bounce)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(clip.stickerGlyph || '🔥', w / 2, h / 2);
    } else if (clip.trackType === 'text' && clip.textContent) {
      ctx.filter = 'none';
      const fontSize = clip.fontSize || 36;
      const fontFam = clip.fontFamily || 'Noto Sans Devanagari';
      ctx.font = `700 ${fontSize}px "${fontFam}", sans-serif`;
      ctx.textAlign = clip.textAlign || 'center';
      ctx.textBaseline = 'middle';

      let displayStr = clip.textContent;
      if (clip.textAnimation === 'typewriter') {
        const charCount = Math.max(
          1,
          Math.floor((rawOffset / Math.max(0.4, clip.duration * 0.6)) * displayStr.length)
        );
        displayStr = displayStr.slice(0, charCount);
      }

      let animOffsetY = 0;
      if (clip.textAnimation === 'slide-up' && rawOffset < 0.4) {
        animOffsetY = (1 - rawOffset / 0.4) * 32;
      }

      const metrics = ctx.measureText(displayStr);
      const padX = 22;
      const padY = 14;
      const boxW = Math.min(w * 0.9, metrics.width + padX * 2);
      const boxH = fontSize * 1.45 + padY;

      if (clip.bgBoxOpacity && clip.bgBoxOpacity > 0) {
        ctx.save();
        ctx.globalAlpha *= clip.bgBoxOpacity;
        ctx.fillStyle = clip.bgBoxColor || '#0F172A';
        ctx.beginPath();
        ctx.roundRect(w / 2 - boxW / 2, h / 2 - boxH / 2 + animOffsetY, boxW, boxH, 12);
        ctx.fill();
        ctx.restore();
      }

      if (clip.glowIntensity && clip.glowIntensity > 0) {
        ctx.shadowColor = clip.textColor || '#F59E0B';
        ctx.shadowBlur = clip.glowIntensity;
      } else if (clip.shadowBlur && clip.shadowBlur > 0) {
        ctx.shadowColor = 'rgba(0,0,0,0.85)';
        ctx.shadowBlur = clip.shadowBlur;
        ctx.shadowOffsetY = 3;
      }

      if (clip.outlineWidth && clip.outlineWidth > 0) {
        ctx.strokeStyle = clip.outlineColor || '#090D16';
        ctx.lineWidth = clip.outlineWidth * 2;
        ctx.lineJoin = 'round';
        ctx.strokeText(displayStr, w / 2, h / 2 + animOffsetY);
      }

      if (clip.textAnimation === 'karaoke-highlight') {
        const words = displayStr.split(' ');
        const activeWordIdx = Math.floor((rawOffset / Math.max(0.2, clip.duration)) * words.length);
        const totalWidth = ctx.measureText(displayStr).width;
        let cursorX = w / 2 - totalWidth / 2;
        ctx.textAlign = 'left';
        words.forEach((word, idx) => {
          const wordWithSpace = idx < words.length - 1 ? `${word} ` : word;
          ctx.fillStyle = idx === activeWordIdx ? '#FDE047' : clip.textColor || '#FFFFFF';
          ctx.fillText(wordWithSpace, cursorX, h / 2 + animOffsetY);
          cursorX += ctx.measureText(wordWithSpace).width;
        });
      } else {
        ctx.fillStyle = clip.textColor || '#FFFFFF';
        ctx.fillText(displayStr, w / 2, h / 2 + animOffsetY);
      }
    }

    ctx.restore();
  }
}
