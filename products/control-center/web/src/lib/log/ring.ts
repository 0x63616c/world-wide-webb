/**
 * Fixed-size in-memory ring buffer , the live tail the logs viewer reads.
 *
 * This is deliberately the only piece of the logging stack with non-trivial
 * logic and zero I/O: no IndexedDB, no globals, no async. The write path runs on
 * every log call on an always-on kiosk, so it must be O(1) and allocation-free
 * per push , a `push` here is one array slot write and two integer updates.
 *
 * Capacity is small (see RING_CAPACITY): the ring is the *tail*, not the
 * history. Durable history lives in store.ts, which holds ~20x more. Holding
 * 100k entries in RAM on a panel that never restarts would cost tens of MB of
 * heap for entries nobody reads.
 */

import type { LogEntry } from "./types";

/** Entries kept in memory. The viewer opens on these; older pages come from IDB. */
export const RING_CAPACITY = 5_000;

export class LogRing {
  private readonly slots: (LogEntry | undefined)[];
  /** Index of the next slot to write. */
  private head = 0;
  /** Entries currently held, saturating at capacity. */
  private size = 0;

  constructor(private readonly capacity: number = RING_CAPACITY) {
    if (capacity <= 0) throw new Error("LogRing capacity must be > 0");
    this.slots = new Array<LogEntry | undefined>(capacity);
  }

  push(entry: LogEntry): void {
    this.slots[this.head] = entry;
    this.head = (this.head + 1) % this.capacity;
    if (this.size < this.capacity) this.size += 1;
  }

  get length(): number {
    return this.size;
  }

  /**
   * Entries in insertion order, oldest first. Allocates a new array, so the
   * viewer calls this on open/refresh , never the write path.
   */
  toArray(): LogEntry[] {
    const out: LogEntry[] = new Array(this.size);
    // When full, the oldest entry sits at `head` (the slot about to be
    // overwritten); when not yet full, writing started at 0.
    const start = this.size === this.capacity ? this.head : 0;
    for (let i = 0; i < this.size; i += 1) {
      // Non-null: every slot below `size` has been written.
      out[i] = this.slots[(start + i) % this.capacity] as LogEntry;
    }
    return out;
  }

  clear(): void {
    this.slots.fill(undefined);
    this.head = 0;
    this.size = 0;
  }
}
