import { describe, expect, test } from 'vitest';
import {
  CLOSED_MESSAGE,
  QueueError,
  cancel,
  createQueue,
  expire,
  hasPlayer,
  interrupt,
  isClosed,
  isFull,
  isOpen,
  isOwner,
  join,
  leave,
  maxPlayers,
  playerName,
  playerCount,
  slotsLeft,
  start,
  type RedStarQueue,
  type Result,
} from '../../src/red-star/queue.js';
import type { RedStarType } from '../../src/red-star/types.js';

function make(type: RedStarType = 'classic'): RedStarQueue {
  return createQueue({
    id: 'q1',
    ownerId: 'owner',
    ownerName: 'Owner',
    level: 7,
    type,
    now: 1_000,
    timeoutMs: 60_000,
  });
}

function unwrap<T>(result: Result<T>): T {
  if (!result.ok) throw result.error;
  return result.value;
}

function failure<T>(result: Result<T>): QueueError {
  if (result.ok) throw new Error('expected a failure');
  return result.error;
}

/** The invariants every queue must satisfy. */
function expectInvariants(queue: RedStarQueue): void {
  expect(queue.players.length).toBeLessThanOrEqual(maxPlayers(queue));
  if (isOpen(queue)) expect(queue.players[0]).toBe(queue.ownerId);
}

describe('createQueue', () => {
  test('starts open with the owner in the first slot', () => {
    const queue = make();
    expect(queue).toEqual({
      id: 'q1',
      creatorId: 'owner',
      ownerId: 'owner',
      level: 7,
      type: 'classic',
      players: ['owner'],
      names: { owner: 'Owner' },
      status: 'open',
      createdAt: 1_000,
      expiresAt: 61_000,
    });
    expect(isOpen(queue)).toBe(true);
    expect(isClosed(queue)).toBe(false);
    expect(isOwner(queue, 'owner')).toBe(true);
    expect(hasPlayer(queue, 'owner')).toBe(true);
    expectInvariants(queue);
  });

  test.each<[RedStarType, number]>([
    ['classic', 4],
    ['dark', 3],
  ])('%s has room for %i players', (type, max) => {
    const queue = make(type);
    expect(maxPlayers(queue)).toBe(max);
    expect(playerCount(queue)).toBe(1);
    expect(slotsLeft(queue)).toBe(max - 1);
    expect(isFull(queue)).toBe(false);
  });
});

describe('playerName', () => {
  test('records each display name on join and keeps it after they leave', () => {
    let queue = make();
    expect(playerName(queue, 'owner')).toBe('Owner');
    expect(playerName(queue, 'ghost')).toBe('ghost');
    queue = unwrap(join(queue, 'b', 'Bee'));
    expect(queue.names).toEqual({ owner: 'Owner', b: 'Bee' });
    queue = unwrap(leave(queue, 'b'));
    expect(playerName(queue, 'b')).toBe('Bee');
  });
});

describe('join', () => {
  test('adds players in order and becomes ready when full (classic: 4)', () => {
    let queue = make('classic');
    queue = unwrap(join(queue, 'b', 'B'));
    queue = unwrap(join(queue, 'c', 'C'));
    expect(queue.status).toBe('open');
    expect(slotsLeft(queue)).toBe(1);
    expectInvariants(queue);

    queue = unwrap(join(queue, 'd', 'D'));
    expect(queue.players).toEqual(['owner', 'b', 'c', 'd']);
    expect(queue.status).toBe('ready');
    expect(isFull(queue)).toBe(true);
    expectInvariants(queue);
  });

  test('dark becomes ready at 3 players', () => {
    let queue = make('dark');
    queue = unwrap(join(queue, 'b', 'B'));
    expect(queue.status).toBe('open');
    queue = unwrap(join(queue, 'c', 'C'));
    expect(queue.status).toBe('ready');
    expect(queue.players).toEqual(['owner', 'b', 'c']);
  });

  test('tells the owner and any member that they are already in', () => {
    const error = failure(join(make(), 'owner', 'OWNER'));
    expect(error.code).toBe('AlreadyJoined');
    expect(error.message).toBe('You are in the squad, no need to join again.');

    const queue = unwrap(join(make(), 'b', 'B'));
    expect(failure(join(queue, 'b', 'B')).code).toBe('AlreadyJoined');
  });

  test('rejects joining a closed queue with the closed message', () => {
    const queue = unwrap(cancel(make(), 'owner'));
    const error = failure(join(queue, 'b', 'B'));
    expect(error.code).toBe('Closed');
    expect(error.message).toBe(CLOSED_MESSAGE);
  });

  test('rejects joining a full queue that is somehow still open', () => {
    const full: RedStarQueue = { ...make('dark'), players: ['owner', 'b', 'c'] };
    expect(failure(join(full, 'd', 'D')).code).toBe('Full');
  });

  test('does not mutate the input', () => {
    const queue = make();
    join(queue, 'b', 'B');
    expect(queue.players).toEqual(['owner']);
  });
});

describe('leave', () => {
  test('removes the player and keeps the order of the others', () => {
    let queue = make();
    queue = unwrap(join(queue, 'b', 'B'));
    queue = unwrap(join(queue, 'c', 'C'));
    queue = unwrap(leave(queue, 'b'));
    expect(queue.players).toEqual(['owner', 'c']);
    expect(queue.ownerId).toBe('owner');
    expect(queue.status).toBe('open');
    expectInvariants(queue);
  });

  test('a freed slot can be taken again', () => {
    let queue = make('dark');
    queue = unwrap(join(queue, 'b', 'B'));
    queue = unwrap(leave(queue, 'b'));
    queue = unwrap(join(queue, 'c', 'C'));
    expect(queue.players).toEqual(['owner', 'c']);
  });

  test('when the owner leaves, ownership moves down the join order', () => {
    let queue = make();
    queue = unwrap(join(queue, 'b', 'B'));
    queue = unwrap(join(queue, 'c', 'C'));
    queue = unwrap(leave(queue, 'owner'));
    expect(queue.players).toEqual(['b', 'c']);
    expect(queue.ownerId).toBe('b');
    expect(queue.status).toBe('open');
    expectInvariants(queue);

    queue = unwrap(leave(queue, 'b'));
    expect(queue.ownerId).toBe('c');
    expect(queue.players).toEqual(['c']);
    expectInvariants(queue);

    expect(unwrap(start(queue, 'c')).status).toBe('started');
    expect(failure(start(queue, 'owner')).code).toBe('NotOwner');
    expect(failure(start(queue, 'b')).code).toBe('NotOwner');
  });

  test('when the last player leaves, the queue is cancelled with them still listed', () => {
    const queue = unwrap(leave(make(), 'owner'));
    expect(queue.players).toEqual(['owner']);
    expect(queue.ownerId).toBe('owner');
    expect(queue.status).toBe('cancelled');
    expect(isClosed(queue)).toBe(true);
  });

  test('tells someone who is not in the queue how to join', () => {
    const error = failure(leave(make(), 'zzz'));
    expect(error.code).toBe('NotInQueue');
    expect(error.message).toBe('Not your squad (yet). Press Join to get in.');
  });

  test('rejects leaving a closed queue', () => {
    const queue = unwrap(start(unwrap(join(make(), 'b', 'B')), 'owner'));
    expect(failure(leave(queue, 'b')).code).toBe('Closed');
  });
});

describe('start and cancel', () => {
  test('only the owner can start; others are told who the owner is', () => {
    const queue = unwrap(join(make(), 'b', 'B'));
    const error = failure(start(queue, 'b'));
    expect(error.code).toBe('NotOwner');
    expect(error.message).toBe('<@owner> owns this matchmaking and decides when to start.');
    expect(unwrap(start(queue, 'owner')).status).toBe('started');
  });

  test('only the owner can cancel; others are told who the owner is', () => {
    const queue = unwrap(join(make(), 'b', 'B'));
    const error = failure(cancel(queue, 'b'));
    expect(error.code).toBe('NotOwner');
    expect(error.message).toBe(
      '<@owner> owns this matchmaking and is the only one who can close it.',
    );
    expect(unwrap(cancel(queue, 'owner')).status).toBe('cancelled');
  });

  test('a closed queue never changes again', () => {
    const started = unwrap(start(make(), 'owner'));
    expect(failure(start(started, 'owner')).code).toBe('Closed');
    expect(failure(cancel(started, 'owner')).code).toBe('Closed');
    expect(failure(join(started, 'b', 'B')).code).toBe('Closed');
    expect(failure(leave(started, 'owner')).code).toBe('Closed');
    expect(expire(started)).toBe(started);
  });
});

describe('expire', () => {
  test('closes an open queue', () => {
    expect(expire(make()).status).toBe('expired');
  });
});

describe('interrupt', () => {
  test('closes an open queue and leaves a closed one untouched', () => {
    expect(interrupt(make()).status).toBe('interrupted');
    const cancelled = unwrap(cancel(make(), 'owner'));
    expect(interrupt(cancelled)).toBe(cancelled);
    expect(failure(join(interrupt(make()), 'b', 'B')).code).toBe('Closed');
  });
});

describe('QueueError', () => {
  test('carries a code and a readable message', () => {
    const error = new QueueError('Full', 'full');
    expect(error.name).toBe('QueueError');
    expect(error.code).toBe('Full');
    expect(error.message).toBe('full');
    expect(error).toBeInstanceOf(Error);
  });
});
