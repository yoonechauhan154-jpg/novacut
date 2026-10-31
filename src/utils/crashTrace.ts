/* ------------------------------------------------------------------ */
/*  Crash Trace — breadcrumb ring buffer in localStorage              */
/*  Writes synchronously so the last entry survives a process kill.   */
/* ------------------------------------------------------------------ */

import { Capacitor } from '@capacitor/core';

const TRACE_KEY = 'clipnova_export_trace';
const EXPORT_STATE_KEY = 'clipnova_export_activity_v1';
const MAX_LINES = 200;

interface TraceLine {
  ts: number;
  step: string;
  detail: string;
}

function readTrace(): TraceLine[] {
  try {
    const raw = localStorage.getItem(TRACE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeTrace(lines: TraceLine[]): void {
  try {
    localStorage.setItem(TRACE_KEY, JSON.stringify(lines.slice(-MAX_LINES)));
  } catch {
    // localStorage may be full or disabled — best effort
  }
}

export function trace(step: string, detail: string): void {
  // Only lifecycle events change recovery state; source checks and Lab logs are not crashes.
  try {
    if (step === 'export-started' || step === 'renderer-crashed') localStorage.setItem(EXPORT_STATE_KEY, 'running');
    else if (step === 'export-finished') localStorage.setItem(EXPORT_STATE_KEY, 'finished');
  } catch {}
  const line: TraceLine = { ts: Date.now(), step, detail };
  const lines = readTrace();
  lines.push(line);
  writeTrace(lines);
  // Also log to console for debugging
  try { console.log(`[TRACE][${step}] ${detail}`); } catch {}
}

export function getTrace(): TraceLine[] {
  return readTrace();
}

export function clearTrace(): void {
  try { localStorage.removeItem(TRACE_KEY); localStorage.removeItem(EXPORT_STATE_KEY); } catch {}
}

export function lastStep(): string | null {
  const lines = readTrace();
  if (lines.length === 0) return null;
  return lines[lines.length - 1].step;
}

export function exportFinished(): boolean {
  try {
    const state = localStorage.getItem(EXPORT_STATE_KEY);
    if (state === 'running') return false;
    if (state === 'finished') return true;
  } catch {}
  // Upgrade an existing breadcrumb history. Ignore source diagnostics written outside export.
  const lines = readTrace();
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].step === 'export-finished') return true;
    if (lines[i].step === 'export-started' || lines[i].step === 'renderer-crashed') return false;
  }
  // An older export may have filled the ring buffer and evicted its start marker.
  return !lines.some(line => /^(frame|seek-failed|audio-render|webview-failed|fallback|mux-done)$/.test(line.step));
}

/* ------------------------------------------------------------------ */
/*  Native process-exit-reason bridge                                 */
/* ------------------------------------------------------------------ */

interface ProcessExitReason {
  reason: string | null;
  status: number | null;
  description: string | null;
  importance: number | null;
  rssPages: number | null;
  pssPages: number | null;
}

let NativeExitReason: { getHistoricalProcessExitReasons?: () => Promise<ProcessExitReason[]> } | null = null;

try {
  const p = (Capacitor as any).Plugins?.NativeExitReason;
  if (p) NativeExitReason = p;
} catch {}

export async function getNativeExitReasons(): Promise<ProcessExitReason[]> {
  if (!NativeExitReason) return [];
  try {
    const result = await NativeExitReason.getHistoricalProcessExitReasons?.();
    return result ?? [];
  } catch {
    return [];
  }
}
