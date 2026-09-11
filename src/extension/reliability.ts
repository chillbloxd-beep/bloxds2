import type { SkillStateSnapshot } from "../types";

export type OcrWorkClass = "boost-critical" | "boost-sync" | "counter" | "full";

const PRIORITY: Record<OcrWorkClass, number> = {
  "boost-critical": 0,
  "boost-sync": 10,
  counter: 20,
  full: 30
};

const DEFAULT_TTL_MS: Record<OcrWorkClass, number> = {
  "boost-critical": 1_500,
  "boost-sync": 6_000,
  counter: 20_000,
  full: 45_000
};

export class OcrDeadlineError extends Error {
  constructor(readonly workClass: OcrWorkClass) {
    super(`Dropped expired ${workClass} OCR work before it started.`);
    this.name = "OcrDeadlineError";
  }
}

interface QueueItem<T> {
  id: number;
  workClass: OcrWorkClass;
  priority: number;
  deadlineAt: number;
  task: () => Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
}

/**
 * Single-concurrency priority queue for expensive capture/OCR work.
 * Priority reorders only work that has not started; a running OCR task is not
 * interrupted. Expired low-priority work is discarded instead of running stale
 * analytics after a time-critical Chopping read becomes due.
 */
export class PriorityOcrQueue {
  private pending: QueueItem<unknown>[] = [];
  private running = false;
  private sequence = 0;

  enqueue<T>(
    workClass: OcrWorkClass,
    task: () => Promise<T>,
    options?: { deadlineAt?: number; ttlMs?: number }
  ): Promise<T> {
    const now = Date.now();
    const deadlineAt = options?.deadlineAt
      ?? now + (options?.ttlMs ?? DEFAULT_TTL_MS[workClass]);

    return new Promise<T>((resolve, reject) => {
      const item: QueueItem<T> = {
        id: ++this.sequence,
        workClass,
        priority: PRIORITY[workClass],
        deadlineAt,
        task,
        resolve,
        reject
      };
      this.pending.push(item as QueueItem<unknown>);
      this.pump();
    });
  }

  get depth() {
    return this.pending.length + (this.running ? 1 : 0);
  }

  private pump() {
    if (this.running) return;

    while (this.pending.length > 0) {
      this.pending.sort((a, b) => a.priority - b.priority || a.id - b.id);
      const item = this.pending.shift()!;
      if (Date.now() > item.deadlineAt) {
        item.reject(new OcrDeadlineError(item.workClass));
        continue;
      }

      this.running = true;
      void item.task()
        .then(item.resolve, item.reject)
        .finally(() => {
          this.running = false;
          this.pump();
        });
      return;
    }
  }
}

export interface ObservationStamp {
  connectionEpoch: number;
  generation: number;
  captureAt: number;
}

export function isStaleObservation(
  stamp: ObservationStamp,
  currentConnectionEpoch: number,
  lastAcceptedGeneration: number,
  lastAcceptedCaptureAt: number
): boolean {
  return stamp.connectionEpoch !== currentConnectionEpoch
    || stamp.generation < lastAcceptedGeneration
    || stamp.captureAt < lastAcceptedCaptureAt;
}

export type TransitionVerdict = "accept" | "confirm";

/**
 * Only surprising transitions require an extra confirmation. Expected state
 * changes stay on the fast path, so reliability does not add latency to a
 * normal Ready -> Active/cooldown cycle.
 */
export function transitionVerdict(options: {
  previous: SkillStateSnapshot;
  observed: SkillStateSnapshot;
  captureAt: number;
  predictedReadyAt?: number;
  boostCycleActive: boolean;
  earlyReadyToleranceMs?: number;
}): TransitionVerdict {
  const {
    previous,
    observed,
    captureAt,
    predictedReadyAt,
    boostCycleActive,
    earlyReadyToleranceMs = 1_500
  } = options;

  if (observed.state === "unknown" || previous.state === "unknown") return "accept";

  if (previous.state === "cooldown" && (observed.state === "ready" || observed.state === "active")) {
    const clearlyEarly = predictedReadyAt !== undefined
      && captureAt < predictedReadyAt - earlyReadyToleranceMs;
    if (clearlyEarly && !boostCycleActive) return "confirm";
  }

  if (previous.state === "active" && observed.state === "ready" && !boostCycleActive) {
    return "confirm";
  }

  return "accept";
}

/**
 * Dumb mode honours the requested ~15 s cooldown synchronization for most of
 * the cooldown and tightens only near Ready or when uncertainty is high.
 */
export function cooldownSyncDelayMs(options: {
  remainingMs: number;
  nominalIntervalSec: number;
  uncertaintySec: number;
}): number {
  const remainingSec = Math.max(0, options.remainingMs / 1000);
  const nominal = Math.max(5, options.nominalIntervalSec);
  let seconds = nominal;

  if (remainingSec <= 10) seconds = Math.min(seconds, 2.5);
  else if (remainingSec <= 30) seconds = Math.min(seconds, 7);

  if (options.uncertaintySec >= 4) seconds = Math.min(seconds, 3);
  else if (options.uncertaintySec >= 2) seconds = Math.min(seconds, 5);

  return Math.max(750, Math.round(seconds * 1000));
}

/**
 * Precision probing avoids repeatedly invoking Tesseract. While the predicted
 * transition is still more than 150 ms away and a learned micro-crop exists,
 * use the cheap template path only. At the transition boundary, allow one
 * authoritative Tesseract fallback and then back off before trying again.
 */
export function precisionProbePlan(options: {
  remainingMs: number;
  hasMicroCrop: boolean;
}): { fastOnly: boolean; nextDelayMs: number } {
  const remainingMs = options.remainingMs;
  const fastOnly = options.hasMicroCrop && remainingMs > 150;
  let nextDelayMs: number;
  if (remainingMs > 1_000) nextDelayMs = 500;
  else if (remainingMs > 150) nextDelayMs = 250;
  else nextDelayMs = 700;
  return { fastOnly, nextDelayMs };
}
