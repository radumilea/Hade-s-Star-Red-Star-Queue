import { defaultScheduler, type Scheduler } from '../scheduler.js';
import type { QueueChannel, QueueMessage } from './ports.js';
import { interrupt, type RedStarQueue } from './queue.js';
import type { RedStarType } from './types.js';

export interface ActiveQueue {
  readonly queue: RedStarQueue;
  readonly channel: QueueChannel;
  readonly message: QueueMessage;
  /** Expiry timer. */
  readonly timer: NodeJS.Timeout | undefined;
  /** Pre-expiry reminder timer, when a reminder is configured. */
  readonly reminderTimer: NodeJS.Timeout | undefined;
  /** Last button press per user, for the cooldown; dies with the entry. */
  readonly lastPress: Map<string, number>;
}

export interface QueueKey {
  readonly channelId: string;
  readonly level: number;
  readonly type: RedStarType;
}

export function queueKeyOf(key: QueueKey): string {
  return `${key.channelId}:${key.type}:${key.level}`;
}

/** How long a closed queue is remembered, so late button presses get a precise answer. */
export const TOMBSTONE_TTL_MS = 10 * 60 * 1000;

function clearTimers(entry: ActiveQueue): void {
  if (entry.timer) clearTimeout(entry.timer);
  if (entry.reminderTimer) clearTimeout(entry.reminderTimer);
}

/**
 * In-memory index of the queues this process is currently managing.
 * Owns the timers so that removing an entry always clears them. Closed
 * queues linger as tombstones for a while: a Join that arrives a moment
 * after the queue filled up should hear "closed", not "unknown".
 */
export class QueueRegistry {
  private readonly entries = new Map<string, ActiveQueue>();
  private readonly tombstones = new Map<string, { queue: RedStarQueue; timer: NodeJS.Timeout }>();
  private readonly setTimeoutFn: Scheduler;

  constructor(options: { setTimeoutFn?: Scheduler } = {}) {
    this.setTimeoutFn = options.setTimeoutFn ?? defaultScheduler;
  }

  get size(): number {
    return this.entries.size;
  }

  get(queueId: string): ActiveQueue | undefined {
    return this.entries.get(queueId);
  }

  /** The last known state of a queue that was closed recently, if any. */
  getClosed(queueId: string): RedStarQueue | undefined {
    return this.tombstones.get(queueId)?.queue;
  }

  add(entry: ActiveQueue): void {
    const existing = this.entries.get(entry.queue.id);
    if (existing) clearTimers(existing);
    this.entries.set(entry.queue.id, entry);
  }

  /** Replaces the queue value of an existing entry, keeping its channel, message and timers. */
  update(queue: RedStarQueue): ActiveQueue | undefined {
    const existing = this.entries.get(queue.id);
    if (!existing) return undefined;
    const updated: ActiveQueue = { ...existing, queue };
    this.entries.set(queue.id, updated);
    return updated;
  }

  /** Forgets a queue; when a closed value is given it is remembered as a tombstone. */
  remove(queueId: string, closed?: RedStarQueue): ActiveQueue | undefined {
    const existing = this.entries.get(queueId);
    if (!existing) return undefined;
    clearTimers(existing);
    this.entries.delete(queueId);
    if (closed) this.remember(closed);
    return existing;
  }

  private remember(queue: RedStarQueue): void {
    const previous = this.tombstones.get(queue.id);
    if (previous) clearTimeout(previous.timer);
    const timer = this.setTimeoutFn(() => this.tombstones.delete(queue.id), TOMBSTONE_TTL_MS);
    // a forgotten tombstone must never keep the process alive
    if (typeof timer === 'object' && 'unref' in timer) timer.unref();
    this.tombstones.set(queue.id, { queue, timer });
  }

  /** The open queue for this level and type in this channel, if any. */
  findOpen(key: QueueKey): ActiveQueue | undefined {
    for (const entry of this.entries.values()) {
      if (
        entry.queue.status === 'open' &&
        entry.channel.id === key.channelId &&
        entry.queue.level === key.level &&
        entry.queue.type === key.type
      ) {
        return entry;
      }
    }
    return undefined;
  }

  /** How many open queues this user currently owns in the channel. */
  countOpenByOwner(ownerId: string, channelId: string): number {
    let count = 0;
    for (const entry of this.entries.values()) {
      if (
        entry.queue.status === 'open' &&
        entry.queue.ownerId === ownerId &&
        entry.channel.id === channelId
      ) {
        count += 1;
      }
    }
    return count;
  }

  all(): ActiveQueue[] {
    return [...this.entries.values()];
  }

  /**
   * Takes every active queue out of the registry for shutdown, clearing its
   * timers. Each one is remembered as an interrupted tombstone so a press that
   * lands while the process is still connected hears "closed", not "unknown".
   */
  drain(): ActiveQueue[] {
    const removed = this.all();
    for (const entry of removed) {
      clearTimers(entry);
      this.remember(interrupt(entry.queue));
    }
    this.entries.clear();
    return removed;
  }

  /** Clears every timer and forgets every queue and tombstone. Used by tests. */
  clear(): ActiveQueue[] {
    const removed = this.all();
    for (const entry of removed) clearTimers(entry);
    this.entries.clear();
    for (const tombstone of this.tombstones.values()) clearTimeout(tombstone.timer);
    this.tombstones.clear();
    return removed;
  }
}
