/**
 * Media I/O guard (#793).
 *
 * `/app/media` is an NFS mount of the NAS. When the NAS drops off the network,
 * file calls against it stop returning. A hard mount never returns. A soft
 * mount returns EIO only after its timeo/retrans budget, which is tens of
 * seconds. Every stalled call holds a runtime I/O thread, so a burst of them
 * starves unrelated work, the Postgres SCRAM handshake included. That is how
 * the Oct 2026 NAS outage became `canceling authentication due to timeout` and
 * 7 hours of 502s.
 *
 * `withMediaIo` bounds every media operation with a deadline and trips a
 * circuit breaker on the first timeout. While the breaker is open, media calls
 * fail immediately with {@link MediaUnavailableError} and nothing new reaches
 * the dead mount, so at most a handful of threads are ever parked on it. After
 * the cooldown, ONE probe call goes through (half-open). If it succeeds the
 * breaker closes. If it fails, the breaker opens again.
 *
 * Plain I/O errors (ENOENT, EACCES) pass through unchanged and do not trip the
 * breaker. A missing file is not a sick NAS. EIO/ETIMEDOUT/ESTALE do trip it,
 * because they are what a soft mount reports when the server is gone.
 */

export class MediaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaUnavailableError";
  }
}

export function isMediaUnavailable(err: unknown): err is MediaUnavailableError {
  return err instanceof MediaUnavailableError;
}

export interface MediaGuardOptions {
  /** Deadline for one media operation. */
  timeoutMs: number;
  /** How long the breaker stays open before letting one probe through. */
  cooldownMs: number;
  now?: () => number;
}

const DEFAULTS: MediaGuardOptions = { timeoutMs: 5_000, cooldownMs: 30_000 };

/** errno codes a soft NFS mount (or a dead server) surfaces. */
const NAS_FAILURE_CODES = new Set(["EIO", "ETIMEDOUT", "ESTALE", "EHOSTDOWN", "EHOSTUNREACH"]);

function isNasFailure(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" && NAS_FAILURE_CODES.has(code);
}

export class MediaGuard {
  private readonly opts: Required<MediaGuardOptions>;
  private openUntil = 0;
  private probing = false;
  private lastReason = "";

  constructor(opts: Partial<MediaGuardOptions> = {}) {
    this.opts = { ...DEFAULTS, now: Date.now, ...opts } as Required<MediaGuardOptions>;
  }

  /** True while media calls are short-circuited. */
  get isOpen(): boolean {
    return this.openUntil > 0;
  }

  async run<T>(label: string, op: () => Promise<T>): Promise<T> {
    const now = this.opts.now();
    let isProbe = false;
    if (this.openUntil > 0) {
      if (now < this.openUntil || this.probing) {
        throw new MediaUnavailableError(
          `media storage unavailable (${label}); last failure: ${this.lastReason}`,
        );
      }
      // Cooldown elapsed: this call is the single half-open probe.
      this.probing = true;
      isProbe = true;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new MediaUnavailableError(`media ${label} timed out after ${this.opts.timeoutMs}ms`),
          ),
        this.opts.timeoutMs,
      );
    });
    try {
      const result = await Promise.race([op(), deadline]);
      this.openUntil = 0;
      return result;
    } catch (err) {
      if (isMediaUnavailable(err) || isNasFailure(err)) {
        this.trip(err instanceof Error ? err.message : String(err));
        if (isMediaUnavailable(err)) throw err;
        throw new MediaUnavailableError(`media ${label} failed: ${(err as Error).message}`);
      }
      // An ordinary error (ENOENT, a validation throw) means the mount itself
      // answered, so a probe that got here proves the NAS is back.
      if (isProbe) this.openUntil = 0;
      throw err;
    } finally {
      clearTimeout(timer);
      if (isProbe) this.probing = false;
    }
  }

  private trip(reason: string): void {
    this.lastReason = reason;
    this.openUntil = this.opts.now() + this.opts.cooldownMs;
  }
}

/** The process-wide guard every `/app/media` caller shares. */
export const mediaGuard = new MediaGuard();

/** Shorthand for `mediaGuard.run`. */
export function withMediaIo<T>(label: string, op: () => Promise<T>): Promise<T> {
  return mediaGuard.run(label, op);
}
