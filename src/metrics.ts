import { DURATIONS } from "./constants";

export type Mode = "idle" | "running" | "finished";

export function computeTimeLeft(
  mode: Mode,
  startTime: number | null,
  endTime: number | null,
  durationIndex: number,
  nowMs: number,
) {
  const duration = DURATIONS[durationIndex] ?? DURATIONS[0];
  if (mode === "running" && startTime !== null) {
    const elapsed = (nowMs - startTime) / 1000;
    return Math.max(0, duration - elapsed);
  }
  if (mode === "finished" && startTime !== null && endTime !== null) {
    return 0;
  }
  return duration;
}

export function computeStats(
  mode: Mode,
  startTime: number | null,
  endTime: number | null,
  durationIndex: number,
  correctCount: number,
  errorCount: number,
  nowMs: number,
) {
  if (startTime === null) {
    return { wpm: 0, accuracy: 100 };
  }

  const duration = DURATIONS[durationIndex] ?? DURATIONS[0];
  const effectiveEnd = mode === "finished" && endTime !== null ? endTime : nowMs;
  const elapsedSec = Math.min(duration, Math.max(0, (effectiveEnd - startTime) / 1000));
  const minutes = elapsedSec / 60;
  const wpm = minutes > 0 ? Math.round((correctCount / 5) / minutes) : 0;
  const total = correctCount + errorCount;
  const accuracy = total > 0 ? Math.round((correctCount / total) * 100) : 100;
  return { wpm, accuracy };
}
