import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createQueue, type RedStarQueue } from '../../src/red-star/queue.js';
import {
  QueueRegistry,
  TOMBSTONE_TTL_MS,
  queueKeyOf,
  type ActiveQueue,
} from '../../src/red-star/queue-registry.js';
import type { RedStarType } from '../../src/red-star/types.js';
import { makeChannel, makeMessage } from '../fakes.js';

function entry(
  id: string,
  overrides: Partial<ActiveQueue> = {},
  level = 7,
  type: RedStarType = 'classic',
): ActiveQueue {
  const queue: RedStarQueue = createQueue({
    id,
    ownerId: 'owner',
    ownerName: 'Owner',
    level,
    type,
    now: 0,
    timeoutMs: 1_000,
  });
  return {
    queue,
    channel: makeChannel('chan-1'),
    message: makeMessage(`m-${id}`),
    timer: undefined,
    reminderTimer: undefined,
    lastPress: new Map(),
    ...overrides,
  };
}

describe('QueueRegistry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('queueKeyOf identifies a channel, type and level', () => {
    expect(queueKeyOf({ channelId: 'c', level: 7, type: 'dark' })).toBe('c:dark:7');
  });

  test('adds, gets, updates and removes entries', () => {
    const registry = new QueueRegistry();
    registry.add(entry('a'));
    expect(registry.size).toBe(1);
    expect(registry.get('a')?.queue.id).toBe('a');

    const updated = registry.update({ ...registry.get('a')!.queue, players: ['owner', 'b'] });
    expect(updated?.queue.players).toEqual(['owner', 'b']);
    expect(registry.get('a')?.queue.players).toEqual(['owner', 'b']);

    expect(registry.remove('a')?.queue.id).toBe('a');
    expect(registry.size).toBe(0);
    expect(registry.remove('a')).toBeUndefined();
    expect(registry.update(entry('a').queue)).toBeUndefined();
  });

  test('removing an entry clears both its timers', () => {
    const registry = new QueueRegistry();
    const expiry = vi.fn();
    const reminder = vi.fn();
    registry.add(
      entry('a', { timer: setTimeout(expiry, 1_000), reminderTimer: setTimeout(reminder, 500) }),
    );
    registry.remove('a');
    vi.advanceTimersByTime(2_000);
    expect(expiry).not.toHaveBeenCalled();
    expect(reminder).not.toHaveBeenCalled();
  });

  test('re-adding the same id replaces the entry and clears the old timers', () => {
    const registry = new QueueRegistry();
    const first = vi.fn();
    const second = vi.fn();
    registry.add(entry('a', { timer: setTimeout(first, 1_000) }));
    registry.add(entry('a', { timer: setTimeout(second, 1_000) }));
    vi.advanceTimersByTime(2_000);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(1);
  });

  test('a removed queue is remembered as a tombstone for a while', () => {
    const registry = new QueueRegistry();
    registry.add(entry('a'));
    const closed = { ...registry.get('a')!.queue, status: 'cancelled' as const };
    registry.remove('a', closed);

    expect(registry.get('a')).toBeUndefined();
    expect(registry.getClosed('a')).toEqual(closed);
    vi.advanceTimersByTime(TOMBSTONE_TTL_MS - 1);
    expect(registry.getClosed('a')).toEqual(closed);
    vi.advanceTimersByTime(1);
    expect(registry.getClosed('a')).toBeUndefined();
  });

  test('removing without a closed value leaves no tombstone', () => {
    const registry = new QueueRegistry();
    registry.add(entry('a'));
    registry.remove('a');
    expect(registry.getClosed('a')).toBeUndefined();
  });

  test('findOpen matches only open queues of that level and type in that channel', () => {
    const registry = new QueueRegistry();
    registry.add(entry('a'));
    registry.add(entry('b', { channel: makeChannel('chan-2') }));
    registry.add(entry('c', { queue: { ...entry('c').queue, status: 'cancelled' } }, 9));
    registry.add(entry('d', {}, 9, 'dark'));
    registry.add(entry('e', {}, 10));

    expect(registry.findOpen({ channelId: 'chan-1', level: 7, type: 'classic' })?.queue.id).toBe(
      'a',
    );
    expect(registry.findOpen({ channelId: 'chan-2', level: 7, type: 'classic' })?.queue.id).toBe(
      'b',
    );
    expect(registry.findOpen({ channelId: 'chan-1', level: 9, type: 'classic' })).toBeUndefined();
    expect(registry.findOpen({ channelId: 'chan-1', level: 9, type: 'dark' })?.queue.id).toBe('d');
    expect(registry.findOpen({ channelId: 'chan-1', level: 10, type: 'classic' })?.queue.id).toBe(
      'e',
    );
    expect(registry.findOpen({ channelId: 'chan-3', level: 7, type: 'classic' })).toBeUndefined();
  });

  test('countOpenByOwner counts open queues of that owner in that channel', () => {
    const registry = new QueueRegistry();
    registry.add(entry('a'));
    registry.add(entry('b', {}, 9));
    registry.add(entry('c', { channel: makeChannel('chan-2') }, 10));
    registry.add(entry('d', { queue: { ...entry('d').queue, ownerId: 'other' } }, 11));
    registry.add(entry('e', { queue: { ...entry('e').queue, status: 'started' } }, 12));

    expect(registry.countOpenByOwner('owner', 'chan-1')).toBe(2);
    expect(registry.countOpenByOwner('owner', 'chan-2')).toBe(1);
    expect(registry.countOpenByOwner('other', 'chan-1')).toBe(1);
    expect(registry.countOpenByOwner('nobody', 'chan-1')).toBe(0);
  });

  test('clear returns everything and stops all timers and tombstones', () => {
    const registry = new QueueRegistry();
    const callback = vi.fn();
    registry.add(entry('a', { timer: setTimeout(callback, 1_000) }));
    registry.add(entry('b'));
    registry.remove('b', { ...entry('b').queue, status: 'expired' });
    const removed = registry.clear();
    expect(registry.getClosed('a')).toBeUndefined();
    expect(removed.map((e) => e.queue.id)).toEqual(['a']);
    expect(registry.all()).toEqual([]);
    expect(registry.getClosed('b')).toBeUndefined();
    vi.advanceTimersByTime(2_000);
    expect(callback).not.toHaveBeenCalled();
  });
});

describe('drain', () => {
  test('takes every queue out, clears its timers and leaves an interrupted tombstone', () => {
    const registry = new QueueRegistry();
    const timer = setTimeout(() => undefined, 60_000);
    registry.add(entry('a', { timer }));
    registry.add(entry('b'));
    const drained = registry.drain();
    expect(drained.map((e) => e.queue.id)).toEqual(['a', 'b']);
    expect(registry.size).toBe(0);
    expect(registry.getClosed('a')?.status).toBe('interrupted');
    expect(registry.getClosed('b')?.status).toBe('interrupted');
    clearTimeout(timer);
  });
});
