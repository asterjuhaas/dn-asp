import { TIMING } from "@snake/shared";

/**
 * Local-only authoritative tick driver.
 *
 * This is the Node development adapter. It is deliberately kept out of the
 * runtime-agnostic core: Cloudflare Workers must drive the same `GameService`
 * from a Durable Object alarm instead, because a `setTimeout` chain is not a
 * durable clock and cannot survive hibernation or isolate eviction.
 *
 * The loop is drift-corrected: it schedules the next tick relative to the
 * intended wall-clock start of the current tick, so a slow tick does not push
 * every later tick further behind. If the process falls more than one interval
 * behind (for example after a debugger pause) it resynchronises instead of
 * trying to catch up with a burst of ticks.
 */

export interface TickLoopOptions {
  /** Callback invoked once per authoritative tick. */
  onTick: () => void;
  /** Interval between ticks in milliseconds. Defaults to the game tick. */
  intervalMs?: number;
  /** Clock source in milliseconds. Defaults to `Date.now`. */
  now?: () => number;
  /** Timer used to schedule the next tick. Defaults to `setTimeout`. */
  schedule?: (callback: () => void, delayMs: number) => unknown;
  /** Cancels a pending schedule. Defaults to `clearTimeout`. */
  cancel?: (handle: unknown) => void;
  /** Logs a warning when the loop resynchronises after falling behind. */
  onDrift?: (lateMs: number) => void;
}

export interface TickLoop {
  /** Start ticking. Idempotent while already running. */
  start(): void;
  /** Stop ticking and cancel the pending timer. Idempotent. */
  stop(): void;
  /** True while a timer is pending. */
  readonly running: boolean;
}

export function createTickLoop(options: TickLoopOptions): TickLoop {
  const interval = Math.max(1, options.intervalMs ?? TIMING.tickMs);
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.schedule ?? ((callback: () => void, delayMs: number) => setTimeout(callback, delayMs));
  const cancel =
    options.cancel ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));

  let handle: unknown = null;
  let running = false;
  let nextAt = 0;

  const step = () => {
    handle = null;
    if (!running) return;

    const startedAt = now();
    options.onTick();

    // Schedule against the intended start time, not the completion time.
    nextAt += interval;
    const current = now();
    const delay = nextAt - current;

    if (delay < -interval) {
      // We fell more than a full interval behind. Resynchronise rather than
      // firing a burst of catch-up ticks, which would break match timing.
      const late = -delay;
      nextAt = current + interval;
      options.onDrift?.(late);
      handle = schedule(step, interval);
      return;
    }

    handle = schedule(step, Math.max(0, delay));
    void startedAt;
  };

  return {
    start() {
      if (running) return;
      running = true;
      nextAt = now() + interval;
      handle = schedule(step, interval);
    },
    stop() {
      running = false;
      if (handle !== null) {
        cancel(handle);
        handle = null;
      }
    },
    get running() {
      return running;
    },
  };
}
