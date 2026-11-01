import { RS_STAR_TYPE, type RedStarType } from './types.js';

/**
 * Pure matchmaking domain. No Discord types in here: a queue is a plain
 * immutable value and every transition returns a new value or a QueueError.
 *
 * Invariants (checked by the tests in test/red-star/queue.test.ts):
 * - while the queue is open, the owner is always `players[0]`;
 * - `players.length` never exceeds the type's `maxPlayers`;
 * - a closed queue (any status but `open`) never changes again.
 */

export type QueueStatus = 'open' | 'ready' | 'started' | 'cancelled' | 'expired' | 'interrupted';

export interface RedStarQueue {
  readonly id: string;
  /** Who opened the queue; named in the card text for its whole life. */
  readonly creatorId: string;
  /** The matchmaking owner: the creator, or whoever inherited it when the creator left. */
  readonly ownerId: string;
  readonly level: number;
  readonly type: RedStarType;
  /** Player ids in join order; the owner is first while the queue is open. */
  readonly players: readonly string[];
  /**
   * Display name of each player as it was when they joined. Shown instead of
   * mentions wherever the bot must not ping (the card, join/leave notices):
   * Discord mobile renders an unpinged mention of an uncached user as a raw id.
   */
  readonly names: Readonly<Record<string, string>>;
  readonly status: QueueStatus;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export type QueueErrorCode = 'AlreadyJoined' | 'Full' | 'NotInQueue' | 'NotOwner' | 'Closed';

/** A rejected transition. Its message is written for the user who pressed the button. */
export class QueueError extends Error {
  constructor(
    readonly code: QueueErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'QueueError';
  }
}

export type Result<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: QueueError };

const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const fail = <T>(code: QueueErrorCode, message: string): Result<T> => ({
  ok: false,
  error: new QueueError(code, message),
});

/** Discord user mention; kept here so error messages can name the owner. */
const mention = (userId: string): string => `<@${userId}>`;

export const CLOSED_MESSAGE = 'This matchmaking ended already.';

export interface CreateQueueInput {
  readonly id: string;
  readonly ownerId: string;
  readonly ownerName: string;
  readonly level: number;
  readonly type: RedStarType;
  readonly now: number;
  readonly timeoutMs: number;
}

export function createQueue(input: CreateQueueInput): RedStarQueue {
  return {
    id: input.id,
    creatorId: input.ownerId,
    ownerId: input.ownerId,
    level: input.level,
    type: input.type,
    players: [input.ownerId],
    names: { [input.ownerId]: input.ownerName },
    status: 'open',
    createdAt: input.now,
    expiresAt: input.now + input.timeoutMs,
  };
}

export function maxPlayers(queue: Pick<RedStarQueue, 'type'>): number {
  return RS_STAR_TYPE[queue.type].maxPlayers;
}

export function playerCount(queue: RedStarQueue): number {
  return queue.players.length;
}

export function slotsLeft(queue: RedStarQueue): number {
  return maxPlayers(queue) - playerCount(queue);
}

export function isFull(queue: RedStarQueue): boolean {
  return slotsLeft(queue) <= 0;
}

export function isOpen(queue: RedStarQueue): boolean {
  return queue.status === 'open';
}

export function isClosed(queue: RedStarQueue): boolean {
  return !isOpen(queue);
}

export function hasPlayer(queue: RedStarQueue, userId: string): boolean {
  return queue.players.includes(userId);
}

export function isOwner(queue: RedStarQueue, userId: string): boolean {
  return queue.ownerId === userId;
}

/** The display name recorded for a player; the id when none is known. */
export function playerName(queue: RedStarQueue, userId: string): string {
  return queue.names[userId] ?? userId;
}

export function join(
  queue: RedStarQueue,
  userId: string,
  displayName: string,
): Result<RedStarQueue> {
  if (isClosed(queue)) return fail('Closed', CLOSED_MESSAGE);
  if (hasPlayer(queue, userId)) {
    return fail('AlreadyJoined', 'You are in the squad, no need to join again.');
  }
  if (isFull(queue)) return fail('Full', 'Too late, the squad is complete.');

  const players = [...queue.players, userId];
  const names = { ...queue.names, [userId]: displayName };
  const status: QueueStatus = players.length >= maxPlayers(queue) ? 'ready' : 'open';
  return ok({ ...queue, players, names, status });
}

/**
 * Anyone in the queue can leave. When the owner leaves, the next player in
 * join order becomes the owner. When the last player leaves, the queue is
 * cancelled as if they had pressed Cancel: they stay listed as its owner.
 */
export function leave(queue: RedStarQueue, userId: string): Result<RedStarQueue> {
  if (isClosed(queue)) return fail('Closed', CLOSED_MESSAGE);
  if (!hasPlayer(queue, userId)) {
    return fail('NotInQueue', 'Not your squad (yet). Press Join to get in.');
  }

  const players = queue.players.filter((id) => id !== userId);
  const nextOwner = players[0];
  if (nextOwner === undefined) {
    return ok({ ...queue, status: 'cancelled' });
  }
  const ownerId = isOwner(queue, userId) ? nextOwner : queue.ownerId;
  return ok({ ...queue, players, ownerId });
}

export function start(queue: RedStarQueue, userId: string): Result<RedStarQueue> {
  if (isClosed(queue)) return fail('Closed', CLOSED_MESSAGE);
  if (!isOwner(queue, userId)) {
    return fail(
      'NotOwner',
      `${mention(queue.ownerId)} owns this matchmaking and decides when to start.`,
    );
  }
  return ok({ ...queue, status: 'started' });
}

export function cancel(queue: RedStarQueue, userId: string): Result<RedStarQueue> {
  if (isClosed(queue)) return fail('Closed', CLOSED_MESSAGE);
  if (!isOwner(queue, userId)) {
    return fail(
      'NotOwner',
      `${mention(queue.ownerId)} owns this matchmaking and is the only one who can close it.`,
    );
  }
  return ok({ ...queue, status: 'cancelled' });
}

/** Expiring is idempotent: an already closed queue is returned unchanged. */
export function expire(queue: RedStarQueue): RedStarQueue {
  if (isClosed(queue)) return queue;
  return { ...queue, status: 'expired' };
}

/** The bot is shutting down with the queue still open; idempotent like `expire`. */
export function interrupt(queue: RedStarQueue): RedStarQueue {
  if (isClosed(queue)) return queue;
  return { ...queue, status: 'interrupted' };
}
