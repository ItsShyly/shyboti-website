// >>> countdown logic, duplicated in the obs render page too
export interface CountdownData {
  mode?: "duration" | "target";
  durationSec?: number;
  targetIso?: string;
  repeat?: boolean;
  doneText?: string;
  running?: boolean;
  accumulatedSec?: number;
  runningSinceMs?: number | null;
}

export type CountdownLikeType = "countdown" | "countup";

// >>> stopwatch, not a wall clock - frozen while stopped
export function currentElapsed(data: CountdownData): number {
  const acc = Number(data.accumulatedSec) || 0;
  if (data.running && data.runningSinceMs) return acc + (Date.now() - data.runningSinceMs) / 1000;
  return acc;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

// >>> HH:MM:SS past an hour, else just MM:SS
export function formatDuration(totalSec: number): string {
  const clamped = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(clamped / 3600);
  const m = Math.floor((clamped % 3600) / 60);
  const s = clamped % 60;
  return h > 0 ? `${pad2(h)}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}

// >>> "H:MM:SS" / "MM:SS" / "SS" back to total seconds
export function parseDuration(input: string): number | null {
  const parts = input.trim().split(":").map((p) => p.trim());
  if (!parts.length || parts.some((p) => p === "" || isNaN(Number(p)))) return null;
  let sec = 0;
  for (const p of parts) sec = sec * 60 + Number(p);
  return Math.max(0, Math.round(sec));
}

export interface CountdownResult {
  seconds: number; // <<< time left for countdown, elapsed for countup
  done: boolean;
}

export function computeCountdown(type: CountdownLikeType, data: CountdownData): CountdownResult {
  if (type === "countup") return { seconds: currentElapsed(data), done: false };

  if ((data.mode || "duration") === "target" && data.targetIso) {
    const target = new Date(data.targetIso).getTime();
    if (isNaN(target)) return { seconds: 0, done: true };
    const secondsLeft = (target - Date.now()) / 1000;
    return { seconds: Math.max(0, secondsLeft), done: secondsLeft <= 0 };
  }

  const dur = Math.max(0, Number(data.durationSec) || 0);
  if (!dur) return { seconds: 0, done: true };
  let elapsed = currentElapsed(data);
  if (data.repeat !== false) return { seconds: dur - (elapsed % dur), done: false };
  return { seconds: Math.max(0, dur - elapsed), done: elapsed >= dur };
}

export function countdownDisplayText(type: CountdownLikeType, data: CountdownData): string {
  const { seconds, done } = computeCountdown(type, data);
  if (done && data.doneText) return data.doneText;
  return formatDuration(seconds);
}

// >>> start/stop toggle - freezes or resumes the current value
export function toggleRunningData(data: CountdownData): CountdownData {
  if (data.running) return { ...data, running: false, accumulatedSec: currentElapsed(data), runningSinceMs: null };
  return { ...data, running: true, runningSinceMs: Date.now() };
}

// >>> sets the currently displayed value directly
export function setCurrentSeconds(type: CountdownLikeType, data: CountdownData, seconds: number): CountdownData {
  const accumulatedSec =
    type === "countdown" && (data.mode || "duration") !== "target"
      ? Math.max(0, (Number(data.durationSec) || 0) - Math.max(0, seconds))
      : Math.max(0, seconds);
  return { ...data, accumulatedSec, runningSinceMs: data.running ? Date.now() : null };
}
