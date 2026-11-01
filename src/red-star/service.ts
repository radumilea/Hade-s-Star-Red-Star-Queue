import { randomUUID } from 'node:crypto';
import { ApiErrorCode, isDiscordApiError } from '../discord/api-errors.js';
import { UserFacingError, errorToLog } from '../errors.js';
import type { Logger } from '../logger.js';
import { defaultScheduler, type Scheduler } from '../scheduler.js';
import type { ButtonAction } from './buttons.js';
import type { ButtonPort, QueueChannel, QueueMessage } from './ports.js';
import {
  CLOSED_MESSAGE,
  cancel,
  createQueue,
  expire,
  interrupt,
  join,
  leave,
  start,
  type RedStarQueue,
  type Result,
} from './queue.js';
import { queueKeyOf, type ActiveQueue, type QueueRegistry } from './queue-registry.js';
import {
  expiredNotification,
  interruptedNotification,
  ownerInstructions,
  QUEUE_GONE_MESSAGE,
  goneMessage,
  openedAnnouncement,
  queueMessage,
  queuePost,
  reminderMessage,
  transitionNotification,
} from './render.js';
import type { RedStarType } from './types.js';

export interface RedStarServiceDeps {
  readonly logger: Logger;
  readonly registry: QueueRegistry;
  readonly queueTimeoutMs: number;
  /** How long before expiry the "last chance" reminder is posted; 0 or ≥ timeout disables it. */
  readonly reminderLeadMs?: number;
  /** Open queues one user may own per channel; limits @everyone reminder abuse. */
  readonly maxOpenQueuesPerOwner?: number;
  /** Minimum time between two button presses of the same user on the same queue. */
  readonly buttonCooldownMs?: number;
  readonly now?: () => number;
  readonly newId?: () => string;
  readonly setTimeoutFn?: Scheduler;
}

export interface OpenQueueRequest {
  readonly ownerId: string;
  readonly displayName: string;
  readonly level: number;
  readonly type: RedStarType;
  readonly channel: QueueChannel;
}

export type OpenQueueResult =
  | {
      readonly outcome: 'created';
      readonly queue: RedStarQueue;
      readonly message: QueueMessage;
      /** What the new owner should be told privately. */
      readonly ownerInstructions: string;
    }
  | {
      /** The user was added to the queue that already existed for this level and type. */
      readonly outcome: 'joined';
      readonly queue: RedStarQueue;
      readonly message: QueueMessage;
    };

export interface ButtonRequest {
  readonly action: ButtonAction;
  readonly queueId: string;
  readonly userId: string;
  readonly displayName: string;
  readonly interaction: ButtonPort;
  /** Tells the user something privately; used for validation failures. */
  readonly notifyUser: (content: string) => Promise<void>;
}

export const DEFAULT_MAX_OPEN_QUEUES_PER_OWNER = 3;
export const DEFAULT_BUTTON_COOLDOWN_MS = 3_000;

export { QUEUE_GONE_MESSAGE };
export const COOLDOWN_MESSAGE = 'Easy there, wait a moment before pressing again.';
export const MESSAGE_DELETED_MESSAGE =
  'Someone deleted the matchmaking card, so the matchmaking is closed. Open a new one with /rs or /drs.';
export const CARD_STALE_MESSAGE =
  'Your action counted, but I could not refresh the matchmaking card. It will catch up on the next change.';
export const RESTARTING_MESSAGE =
  'The bot is restarting. Please open the matchmaking again in a minute.';

interface Creation {
  readonly promise: Promise<unknown>;
  readonly ownerId: string;
  readonly channelId: string;
}

/**
 * Orchestrates the red star matchmaking flow: domain transitions, the in-memory
 * registry, rendering and all Discord I/O for queue messages and notifications.
 *
 * Concurrency: every read-modify-write on the registry is synchronous (no await
 * between `registry.get` and `registry.update`/`remove`), so concurrent button
 * presses cannot lose updates. Queue creation does REST calls before the entry
 * exists, so it is serialised per channel/type/level with `creating`.
 */
export class RedStarService {
  private readonly logger: Logger;
  private readonly registry: QueueRegistry;
  private readonly queueTimeoutMs: number;
  private readonly reminderLeadMs: number;
  private readonly maxOpenQueuesPerOwner: number;
  private readonly buttonCooldownMs: number;
  private readonly now: () => number;
  private readonly newId: () => string;
  private readonly setTimeoutFn: Scheduler;
  /** When this process started; cards older than that may belong to a previous life. */
  private readonly bootedAt: number;
  /** In-flight creations keyed by channel/type/level. */
  private readonly creating = new Map<string, Creation>();
  /** Set once shutdown starts: nothing new may be registered afterwards. */
  private closing = false;

  constructor(deps: RedStarServiceDeps) {
    this.logger = deps.logger;
    this.registry = deps.registry;
    this.queueTimeoutMs = deps.queueTimeoutMs;
    this.reminderLeadMs = deps.reminderLeadMs ?? 0;
    this.maxOpenQueuesPerOwner = deps.maxOpenQueuesPerOwner ?? DEFAULT_MAX_OPEN_QUEUES_PER_OWNER;
    this.buttonCooldownMs = deps.buttonCooldownMs ?? DEFAULT_BUTTON_COOLDOWN_MS;
    this.now = deps.now ?? (() => Date.now());
    this.newId = deps.newId ?? (() => randomUUID());
    // resolved lazily so fake timers installed after construction still apply
    this.setTimeoutFn = deps.setTimeoutFn ?? defaultScheduler;
    this.bootedAt = this.now();
  }

  /** Whether a "last chance" reminder is scheduled for new queues. */
  get remindsBeforeExpiry(): boolean {
    return this.reminderLeadMs > 0 && this.reminderLeadMs < this.queueTimeoutMs;
  }

  /**
   * Opens a queue for this level and type in the channel. There is at most one
   * such queue per channel: if it already exists the user joins it instead.
   */
  async openQueue(request: OpenQueueRequest): Promise<OpenQueueResult> {
    if (this.closing) throw new UserFacingError(RESTARTING_MESSAGE);
    const key = queueKeyOf({
      channelId: request.channel.id,
      level: request.level,
      type: request.type,
    });

    // Someone else is creating this very queue: wait for it (and for whoever
    // retries after a failure), then join it.
    for (let pending = this.creating.get(key); pending; pending = this.creating.get(key)) {
      await pending.promise.catch(() => undefined);
    }

    const existing = this.registry.findOpen({
      channelId: request.channel.id,
      level: request.level,
      type: request.type,
    });
    if (existing) {
      try {
        return await this.joinExisting(existing, request);
      } catch (error) {
        // the card was deleted meanwhile and the queue dropped: open a fresh one instead
        if (!(error instanceof UserFacingError && error.message === MESSAGE_DELETED_MESSAGE)) {
          throw error;
        }
      }
    }

    const owned =
      this.registry.countOpenByOwner(request.ownerId, request.channel.id) +
      this.inFlightByOwner(request.ownerId, request.channel.id);
    if (owned >= this.maxOpenQueuesPerOwner) {
      throw new UserFacingError(
        `You already own ${owned} open matchmaking queues in this channel. ` +
          'Close one before opening another.',
      );
    }

    const promise = this.create(request);
    this.creating.set(key, { promise, ownerId: request.ownerId, channelId: request.channel.id });
    try {
      return await promise;
    } finally {
      this.creating.delete(key);
    }
  }

  private inFlightByOwner(ownerId: string, channelId: string): number {
    let count = 0;
    for (const creation of this.creating.values()) {
      if (creation.ownerId === ownerId && creation.channelId === channelId) count += 1;
    }
    return count;
  }

  private async joinExisting(
    existing: ActiveQueue,
    request: OpenQueueRequest,
  ): Promise<OpenQueueResult> {
    const result = join(existing.queue, request.ownerId, request.displayName);
    if (!result.ok) {
      throw new UserFacingError(`${result.error.message} ${existing.message.url}`);
    }
    this.logger.info(
      { queueId: existing.queue.id, userId: request.ownerId },
      'Joined existing queue instead of opening a new one',
    );
    const queue = await this.commit(existing, result.value, 'join', {
      id: request.ownerId,
      displayName: request.displayName,
    });
    return { outcome: 'joined', queue, message: existing.message };
  }

  private async create(request: OpenQueueRequest): Promise<OpenQueueResult> {
    const queue = createQueue({
      id: this.newId(),
      ownerId: request.ownerId,
      ownerName: request.displayName,
      level: request.level,
      type: request.type,
      now: this.now(),
      timeoutMs: this.queueTimeoutMs,
    });

    // The announcement goes first so the card sits right under it. The card is
    // posted silently (a push for it would be empty): the announcement is the
    // notification. Best effort: its failure must not stop the queue from opening.
    let announcement: QueueMessage | undefined;
    try {
      announcement = await request.channel.send(openedAnnouncement(queue));
    } catch (error) {
      this.logger.warn({ err: errorToLog(error), queueId: queue.id }, 'Queue announcement failed');
    }

    let message: QueueMessage;
    try {
      message = await request.channel.send(queuePost(queue));
    } catch (error) {
      // no card, no queue: do not leave an @everyone pointing at nothing
      await announcement?.delete().catch((deleteError: unknown) => {
        this.logger.debug(
          { err: errorToLog(deleteError), queueId: queue.id },
          'Could not delete the announcement of a failed queue',
        );
      });
      throw error;
    }

    if (this.closing) {
      // shutdown started while the card was being posted: close it right away
      await this.editQueueMessage(message, interrupt(queue)).catch(() => false);
      throw new UserFacingError(RESTARTING_MESSAGE);
    }

    // schedule from the printed expiry so the card and the timer agree even after slow sends
    const timer = this.setTimeoutFn(
      () => void this.expireQueue(queue.id),
      Math.max(0, queue.expiresAt - this.now()),
    );
    const reminderTimer = this.remindsBeforeExpiry
      ? this.setTimeoutFn(
          () => void this.remindQueue(queue.id),
          Math.max(0, queue.expiresAt - this.reminderLeadMs - this.now()),
        )
      : undefined;

    this.registry.add({
      queue,
      channel: request.channel,
      message,
      timer,
      reminderTimer,
      lastPress: new Map(),
    });
    this.logger.info(
      { queueId: queue.id, ownerId: queue.ownerId, level: queue.level, type: queue.type },
      'Queue created',
    );
    return {
      outcome: 'created',
      queue,
      message,
      ownerInstructions: ownerInstructions(),
    };
  }

  async handleButton(request: ButtonRequest): Promise<void> {
    // Acknowledge first: Discord gives us three seconds.
    try {
      await request.interaction.deferUpdate();
    } catch (error) {
      if (
        isDiscordApiError(
          error,
          ApiErrorCode.UnknownInteraction,
          ApiErrorCode.InteractionAlreadyAcknowledged,
        )
      ) {
        this.logger.debug(
          { err: errorToLog(error), queueId: request.queueId },
          'Interaction no longer valid',
        );
        return;
      }
      throw error;
    }

    const active = this.registry.get(request.queueId);
    if (!active) {
      await this.answerForMissingQueue(request);
      return;
    }

    if (this.isOnCooldown(active, request.userId)) {
      await request.notifyUser(COOLDOWN_MESSAGE);
      return;
    }

    const result = this.applyAction(active.queue, request);
    if (!result.ok) {
      this.logger.debug(
        {
          queueId: request.queueId,
          action: request.action,
          userId: request.userId,
          code: result.error.code,
        },
        'Button action rejected',
      );
      await request.notifyUser(result.error.message);
      return;
    }

    await this.commit(active, result.value, request.action, {
      id: request.userId,
      displayName: request.displayName,
    });
  }

  /** Called by the reminder timer; only speaks up if the queue is still open. Never throws. */
  async remindQueue(queueId: string): Promise<void> {
    const active = this.registry.get(queueId);
    if (!active || active.queue.status !== 'open') return;

    this.logger.info({ queueId, players: active.queue.players.length }, 'Queue reminder');
    try {
      await active.channel.send(
        reminderMessage(active.queue, active.message.url, this.reminderLeadMs),
      );
    } catch (error) {
      this.logger.warn({ err: errorToLog(error), queueId }, 'Failed to post queue reminder');
    }
  }

  /**
   * Called by the expiry timer; safe to call for queues that are already gone.
   * Never throws: a timer has nobody to report to, and an unhandled rejection
   * would take the whole bot down.
   */
  async expireQueue(queueId: string): Promise<void> {
    const active = this.registry.get(queueId);
    if (!active) return;

    const queue = expire(active.queue);
    this.registry.remove(queueId, queue);
    this.logger.info({ queueId, players: queue.players.length }, 'Queue expired');

    try {
      const edited = await this.editQueueMessage(active.message, queue);
      if (!edited) return; // the message is gone; nothing to announce against
      await active.channel.send(expiredNotification({ queue, messageUrl: active.message.url }));
    } catch (error) {
      this.logger.warn({ err: errorToLog(error), queueId }, 'Failed to close an expired queue');
    }
  }

  /**
   * Best-effort close of every open queue, used on shutdown. Every queue is
   * attempted whatever happens to the others; nothing new is registered
   * afterwards.
   */
  async closeAll(): Promise<void> {
    this.closing = true;
    const entries = this.registry.drain();
    if (entries.length === 0) return;
    this.logger.info({ count: entries.length }, 'Closing open queues for shutdown');
    await Promise.allSettled(entries.map((entry) => this.closeForShutdown(entry)));
  }

  /** Marks one queue as interrupted on its card and tells its players; both best effort. */
  private async closeForShutdown(entry: ActiveQueue): Promise<void> {
    const queue = interrupt(entry.queue);
    try {
      const edited = await this.editQueueMessage(entry.message, queue);
      if (!edited) return; // the message is gone; nothing to announce against
      await entry.channel.send(interruptedNotification({ queue, messageUrl: entry.message.url }));
    } catch (error) {
      this.logger.warn(
        { err: errorToLog(error), queueId: queue.id },
        'Failed to close a queue for shutdown',
      );
    }
  }

  /**
   * Stores the new queue state, refreshes the queue message and notifies the
   * channel. The state is committed first: the action did succeed, so a failed
   * card refresh is reported as such and the notification (with its pings) still
   * goes out; a failed notification is only logged.
   */
  private async commit(
    active: ActiveQueue,
    next: RedStarQueue,
    action: ButtonAction,
    actor: { readonly id: string; readonly displayName: string },
  ): Promise<RedStarQueue> {
    const notification = transitionNotification({
      before: active.queue,
      after: next,
      action,
      actorId: actor.id,
      displayName: actor.displayName,
      messageUrl: active.message.url,
    });
    const queue = next;

    if (queue.status === 'open') {
      this.registry.update(queue);
    } else {
      this.registry.remove(queue.id, queue);
    }
    this.logger.info(
      { queueId: queue.id, action, status: queue.status, ownerId: queue.ownerId },
      'Queue updated',
    );

    let cardRefreshed: boolean;
    try {
      cardRefreshed = await this.editQueueMessage(active.message, queue);
    } catch (error) {
      this.logger.warn(
        { err: errorToLog(error), queueId: queue.id, action },
        'Queue updated but the card could not be refreshed',
      );
      await this.notify(active, notification, action);
      throw new UserFacingError(CARD_STALE_MESSAGE);
    }
    if (!cardRefreshed) throw new UserFacingError(MESSAGE_DELETED_MESSAGE);

    await this.notify(active, notification, action);
    return queue;
  }

  private async notify(
    active: ActiveQueue,
    notification: Parameters<QueueChannel['send']>[0],
    action: ButtonAction,
  ): Promise<void> {
    try {
      await active.channel.send(notification);
    } catch (error) {
      this.logger.warn(
        { err: errorToLog(error), queueId: active.queue.id, action },
        'Queue updated but the channel notification failed',
      );
    }
  }

  /** One accepted press per user per cooldown window; a refused press does not extend it. */
  private isOnCooldown(active: ActiveQueue, userId: string): boolean {
    if (this.buttonCooldownMs <= 0) return false;
    const now = this.now();
    const last = active.lastPress.get(userId);
    if (last !== undefined && now - last < this.buttonCooldownMs) return true;
    active.lastPress.set(userId, now);
    return false;
  }

  private applyAction(
    queue: RedStarQueue,
    { action, userId, displayName }: ButtonRequest,
  ): Result<RedStarQueue> {
    switch (action) {
      case 'join':
        return join(queue, userId, displayName);
      case 'leave':
        return leave(queue, userId);
      case 'start':
        return start(queue, userId);
      case 'cancel':
        return cancel(queue, userId);
    }
  }

  /**
   * Edits the queue message. Returns false when the message no longer exists
   * (someone deleted it, or its channel), in which case the queue is dropped
   * from the registry. Other failures propagate.
   */
  private async editQueueMessage(message: QueueMessage, queue: RedStarQueue): Promise<boolean> {
    try {
      await message.edit(queueMessage(queue));
      return true;
    } catch (error) {
      if (isDiscordApiError(error, ApiErrorCode.UnknownMessage, ApiErrorCode.UnknownChannel)) {
        this.logger.info({ queueId: queue.id }, 'Queue message was deleted; dropping the queue');
        this.registry.remove(queue.id, expire(queue));
        return false;
      }
      throw error;
    }
  }

  /** A press on a queue that is not active: closed a moment ago, or unknown (restart). */
  private async answerForMissingQueue(request: ButtonRequest): Promise<void> {
    const closed = this.registry.getClosed(request.queueId);
    if (closed) {
      this.logger.debug(
        { queueId: request.queueId, userId: request.userId, status: closed.status },
        'Button on a recently closed queue',
      );
      await request.notifyUser(CLOSED_MESSAGE);
      return;
    }

    this.logger.warn(
      { queueId: request.queueId, userId: request.userId },
      'Button for unknown queue',
    );
    // Only cards from before this process started are ours to retire. A newer
    // one belongs to another instance (deploy overlap) and must not be touched.
    if (request.interaction.message.createdTimestamp < this.bootedAt) {
      try {
        await request.interaction.message.edit(goneMessage());
      } catch (error) {
        this.logger.debug({ err: errorToLog(error) }, 'Could not remove buttons of unknown queue');
      }
    }
    await request.notifyUser(QUEUE_GONE_MESSAGE);
  }
}
