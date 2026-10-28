/* ------------------------------------------------------------------ */
/*  Crash Trace — breadcrumb ring buffer in localStorage              */
/*  Writes synchronously so the last entry survives a process kill.   */
/* ------------------------------------------------------------------ */

import { Capacitor } from '@capacitor/core';

const TRACE_KEY = 'clipnova_export_trace';
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
  try { localStorage.removeItem(TRACE_KEY); } catch {}
}

export function lastStep(): string | null {
  const lines = readTrace();
  if (lines.length === 0) return null;
  return lines[lines.length - 1].step;
}

export function exportFinished(): boolean {
  const lines = readTrace();
  if (lines.length === 0) return false;
  const last = lines[lines.length - 1];
  return last.step === 'export-finished';
}

/* ------------------------------------------------------------------ */
/*  Native process-exit-reason bridge                                 */
/* ------------------------------------------------------------------ */

interface ProcessExitReason {
  reason: string | null;
  description: string | null;
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
