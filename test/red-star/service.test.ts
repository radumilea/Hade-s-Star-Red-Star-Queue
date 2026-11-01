import { MessageFlags } from 'discord.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiErrorCode } from '../../src/discord/api-errors.js';
import { UserFacingError } from '../../src/errors.js';
import type { ButtonAction } from '../../src/red-star/buttons.js';
import { CLOSED_MESSAGE } from '../../src/red-star/queue.js';
import { GONE_TITLE } from '../../src/red-star/render.js';
import {
  CARD_STALE_MESSAGE,
  MESSAGE_DELETED_MESSAGE,
  COOLDOWN_MESSAGE,
  QUEUE_GONE_MESSAGE,
  RESTARTING_MESSAGE,
  type RedStarService,
} from '../../src/red-star/service.js';
import type { RedStarType } from '../../src/red-star/types.js';
import {
  apiError,
  buttonsJson,
  queueView,
  makeChannel,
  makeContext,
  makeMessage,
  type FakeChannel,
  type FakeMessage,
  type TestContextOptions,
} from '../fakes.js';

const TIMEOUT_MS = 60 * 60 * 1000;
const REMINDER_MS = 10 * 60 * 1000;

function setup(options: TestContextOptions = {}) {
  const context = makeContext(options);
  const channel = makeChannel('chan-1');
  return { ...context, channel };
}

async function openQueue(
  service: RedStarService,
  channel: FakeChannel,
  type: RedStarType = 'dark',
  ownerId = 'owner',
  level = 7,
) {
  const result = await service.openQueue({
    ownerId,
    displayName: ownerId.toUpperCase(),
    level,
    type,
    channel,
  });
  return { ...result, message: result.message as FakeMessage };
}

interface PressOptions {
  queueId?: string;
  deferUpdateError?: Error;
}

function press(
  service: RedStarService,
  message: FakeMessage,
  action: ButtonAction,
  userId: string,
  options: PressOptions = {},
) {
  const notifyUser = vi.fn(async (_content: string) => undefined);
  const deferUpdate = vi.fn(async () => undefined);
  if (options.deferUpdateError) deferUpdate.mockRejectedValue(options.deferUpdateError);
  const done = service.handleButton({
    action,
    queueId: options.queueId ?? 'q1',
    userId,
    displayName: userId.toUpperCase(),
    interaction: { message, deferUpdate },
    notifyUser,
  });
  return { done, notifyUser, deferUpdate };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('openQueue', () => {
  test('posts the queue message, registers the queue and returns the owner briefing', async () => {
    const { service, channel, registry } = setup();
    const result = await openQueue(service, channel, 'classic');

    expect(result.outcome).toBe('created');
    expect(result.queue.id).toBe('q1');
    expect(channel.sent).toHaveLength(2);
    expect(queueView(channel.sent[1]!).title).toBe('[1/4] RS 7 Matchmaking');
    expect(buttonsJson(channel.sent[1]!).map((b) => b.label)).toEqual([
      'Join',
      'Leave',
      'Start',
      'Cancel Matchmaking',
    ]);
    expect(result.message.id).toBe('msg-2');
    expect(registry.get('q1')?.message).toBe(result.message);
    if (result.outcome === 'created') {
      expect(result.ownerInstructions).toContain('Matchmaking posted, you are the owner.');
      expect(result.ownerInstructions).toContain('/help');
    }

    // the announcement comes first and carries the push notification, in plain text;
    // the card right under it is posted silently and never pings
    const card = channel.sent[1]!;
    expect(card.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications);
    expect(card.allowedMentions).toEqual({ parse: [] });
    const announcement = channel.sent[0]!;
    expect(announcement.content).toBe('@everyone OWNER wants to play RS 7! Press Join to team up.');
    expect(announcement.allowedMentions).toEqual({ parse: ['everyone'] });
    expect(announcement.embeds).toBeUndefined();
    expect(announcement.flags).toBeUndefined();
  });

  test('a failed announcement is logged; the queue is still created', async () => {
    const { service, channel, registry, logger } = setup();
    const warn = vi.spyOn(logger, 'warn');
    channel.send.mockRejectedValueOnce(apiError(ApiErrorCode.MissingPermissions));

    const result = await openQueue(service, channel, 'classic');
    expect(result.outcome).toBe('created');
    expect(registry.size).toBe(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'q1' }),
      'Queue announcement failed',
    );
  });

  test('another user opening the same level and type joins the existing queue', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'dark');

    const second = await openQueue(service, channel, 'dark', 'b');
    expect(second.outcome).toBe('joined');
    expect(second.message).toBe(message);
    expect(second.queue.players).toEqual(['owner', 'b']);
    expect(registry.size).toBe(1);
    expect(queueView(message.edits[0]!).title).toBe('[2/3] Dark RS 7 Matchmaking');
    expect(channel.sent[2]!.content).toContain('[2/3 Dark RS 7] B joined the squad.');

    const third = await openQueue(service, channel, 'dark', 'c');
    expect(third.outcome).toBe('joined');
    expect(third.queue.status).toBe('ready');
    expect(registry.size).toBe(0);
    expect(channel.sent[3]!.content).toContain("[3/3 Dark RS 7] Matchmaking ready! Let's play!");
  });

  test('two users opening the same queue at the same time end up in one queue', async () => {
    const { service, channel, registry } = setup();
    const [first, second] = await Promise.all([
      openQueue(service, channel, 'dark', 'owner'),
      openQueue(service, channel, 'dark', 'b'),
    ]);
    expect([first.outcome, second.outcome].sort()).toEqual(['created', 'joined']);
    expect(registry.size).toBe(1);
    expect(registry.get('q1')?.queue.players).toEqual(['owner', 'b']);
    expect(channel.sent).toHaveLength(3); // card, announcement, join notification
  });

  test('a failed creation does not block the next attempt for the same queue', async () => {
    const { service, channel, registry } = setup();
    channel.send
      .mockResolvedValueOnce(makeMessage('msg-0', channel.id))
      .mockRejectedValueOnce(apiError(ApiErrorCode.MissingPermissions));
    await expect(openQueue(service, channel, 'dark')).rejects.toThrow();
    expect(registry.size).toBe(0);
    const retry = await openQueue(service, channel, 'dark');
    expect(retry.outcome).toBe('created');
  });

  test('someone already in the queue gets its link instead', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel);
    await expect(openQueue(service, channel)).rejects.toThrow(UserFacingError);
    await expect(openQueue(service, channel)).rejects.toThrow(
      `You are in the squad, no need to join again. ${message.url}`,
    );
    expect(channel.sent).toHaveLength(2);
    expect(message.edits).toHaveLength(0);
  });

  test('a different level, type or channel gets its own queue', async () => {
    const { service, channel, registry } = setup();
    await openQueue(service, channel, 'dark');
    expect((await openQueue(service, channel, 'classic')).outcome).toBe('created');
    expect((await openQueue(service, channel, 'dark', 'owner', 9)).outcome).toBe('created');
    expect((await openQueue(service, makeChannel('chan-2'), 'dark')).outcome).toBe('created');
    expect(registry.size).toBe(4);
  });

  test('one user cannot own more than the configured number of open queues per channel', async () => {
    const { service, channel } = setup({ service: { maxOpenQueuesPerOwner: 2 } });
    await openQueue(service, channel, 'classic', 'owner', 7);
    await openQueue(service, channel, 'classic', 'owner', 8);
    await expect(openQueue(service, channel, 'classic', 'owner', 9)).rejects.toThrow(
      'You already own 2 open matchmaking queues in this channel.',
    );
    expect((await openQueue(service, makeChannel('chan-2'), 'classic', 'owner', 9)).outcome).toBe(
      'created',
    );
  });

  test('once a queue is closed, the same level and type can be opened again', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'cancel', 'owner').done;
    const again = await openQueue(service, channel, 'dark');
    expect(again.outcome).toBe('created');
    expect(again.queue.id).toBe('q2');
  });

  test('joining through the command when the card was deleted opens a fresh queue instead', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    message.edit.mockRejectedValueOnce(apiError(ApiErrorCode.UnknownMessage));
    const result = await openQueue(service, channel, 'dark', 'b');
    expect(result.outcome).toBe('created');
    expect(result.queue.id).toBe('q2');
    expect(result.queue.ownerId).toBe('b');
    expect(registry.size).toBe(1);
    expect(registry.getClosed('q1')?.status).toBe('expired');
  });

  test('a failed card post deletes the announcement that preceded it', async () => {
    const { service, channel, registry } = setup();
    channel.send
      .mockResolvedValueOnce(makeMessage('announcement', channel.id))
      .mockRejectedValueOnce(apiError(ApiErrorCode.MissingPermissions));
    await expect(openQueue(service, channel, 'dark')).rejects.toThrow('error 50013');
    const announcement = (await channel.send.mock.results[0]!.value) as FakeMessage;
    expect(announcement.delete).toHaveBeenCalledTimes(1);
    expect(registry.size).toBe(0);
  });

  test('after a failed creation, waiting users do not all create their own queue', async () => {
    const { service, channel, registry } = setup();
    channel.send
      .mockResolvedValueOnce(makeMessage('announcement', channel.id))
      .mockRejectedValueOnce(new Error('network'));
    const results = await Promise.allSettled([
      openQueue(service, channel, 'dark', 'owner'),
      openQueue(service, channel, 'dark', 'b'),
      openQueue(service, channel, 'dark', 'c'),
    ]);
    expect(results[0].status).toBe('rejected');
    expect(registry.size).toBe(1);
    expect(registry.get('q2')?.queue.players).toEqual(['b', 'c']);
  });

  test('the owner limit counts queues still being created', async () => {
    const { service, channel } = setup({ service: { maxOpenQueuesPerOwner: 2 } });
    const results = await Promise.allSettled([
      openQueue(service, channel, 'classic', 'owner', 7),
      openQueue(service, channel, 'classic', 'owner', 8),
      openQueue(service, channel, 'classic', 'owner', 9),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
  });
});

describe('handleButton: join and leave', () => {
  test('classic: joins never ping, the queue is ready at 4', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'classic');

    const first = press(service, message, 'join', 'b');
    await first.done;
    expect(first.deferUpdate).toHaveBeenCalledTimes(1);
    expect(first.notifyUser).not.toHaveBeenCalled();
    expect(queueView(message.edits[0]!).title).toBe('[2/4] RS 7 Matchmaking');
    expect(channel.sent[2]!.content).not.toContain('@everyone');
    expect(channel.sent[2]!.allowedMentions).toEqual({ parse: [] });

    await press(service, message, 'join', 'c').done;
    expect(channel.sent[3]!.content).not.toContain('@everyone');
    expect(channel.sent[3]!.allowedMentions).toEqual({ parse: [] });

    await press(service, message, 'leave', 'c').done;
    await press(service, message, 'join', 'c').done;
    expect(channel.sent[5]!.content).not.toContain('@everyone');

    await press(service, message, 'join', 'd').done;
    expect(queueView(message.edits[4]!).title).toBe('[CLOSED] RS 7 Matchmaking');
    expect(queueView(message.edits[4]!).buttons).toEqual([]);
    const ready = channel.sent[6]!;
    expect(ready.content).toContain("[4/4 RS 7] Matchmaking ready! Let's play!");
    expect(ready.content).toContain('Squad: <@owner>, <@b>, <@c>, <@d>');
    expect(ready.allowedMentions).toEqual({ parse: [], users: ['owner', 'b', 'c', 'd'] });
    expect(registry.size).toBe(0);

    // the expiry timer was cancelled
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(channel.sent).toHaveLength(7);
  });

  test('dark: ready at 3', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'join', 'b').done;
    expect(channel.sent[2]!.content).not.toContain('@everyone');
    await press(service, message, 'join', 'c').done;
    expect(channel.sent[3]!.content).toContain("[3/3 Dark RS 7] Matchmaking ready! Let's play!");
    expect(registry.size).toBe(0);
  });

  test('two players pressing Join for the last slot: one joins, the other hears "closed"', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'join', 'b').done;

    const c = press(service, message, 'join', 'c');
    const d = press(service, message, 'join', 'd');
    await Promise.all([c.done, d.done]);

    const notified = [c.notifyUser, d.notifyUser].filter((n) => n.mock.calls.length > 0);
    expect(notified).toHaveLength(1);
    expect(notified[0]).toHaveBeenCalledWith(CLOSED_MESSAGE);
    expect(channel.sent[channel.sent.length - 1]!.content).toContain('Matchmaking ready');
  });

  test('joining twice (owner included) is refused privately', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'join', 'b').done;

    const again = press(service, message, 'join', 'b');
    await again.done;
    expect(again.notifyUser).toHaveBeenCalledWith('You are in the squad, no need to join again.');

    const owner = press(service, message, 'join', 'owner');
    await owner.done;
    expect(owner.notifyUser).toHaveBeenCalledWith('You are in the squad, no need to join again.');

    expect(message.edits).toHaveLength(1);
    expect(channel.sent).toHaveLength(3);
  });

  test('leave frees the slot and notifies', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'join', 'b').done;
    const left = press(service, message, 'leave', 'b');
    await left.done;

    expect(left.notifyUser).not.toHaveBeenCalled();
    expect(queueView(message.edits[1]!).title).toBe('[1/3] Dark RS 7 Matchmaking');
    expect(channel.sent[3]!.content).toContain('[1/3 Dark RS 7] B left the squad.');
    expect(channel.sent[3]!.content).not.toContain('Squad');
    expect(channel.sent[3]!.content).toContain(message.url);
    expect(channel.sent[3]!.allowedMentions).toEqual({ parse: [] });
  });

  test('leaving without being in the queue is refused privately', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    const { done, notifyUser } = press(service, message, 'leave', 'zzz');
    await done;
    expect(notifyUser).toHaveBeenCalledWith('Not your squad (yet). Press Join to get in.');
    expect(message.edits).toHaveLength(0);
  });

  test('when the owner leaves, the next player becomes owner and the channel is told', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'classic');
    await press(service, message, 'join', 'b').done;
    await press(service, message, 'join', 'c').done;
    await press(service, message, 'leave', 'owner').done;

    expect(registry.get('q1')?.queue.ownerId).toBe('b');
    expect(registry.get('q1')?.queue.players).toEqual(['b', 'c']);
    expect(queueView(message.edits[2]!).texts.join()).toContain('B *(owner)*');
    const notification = channel.sent[4]!;
    expect(notification.content).toContain('[2/4 RS 7] OWNER left the squad.');
    expect(notification.content).not.toContain('Squad');
    // only the new owner is pinged, in the plain line that reaches push notifications
    expect(channel.sent[4]!.content).toContain('Ownership passed to <@b>.');
    expect(channel.sent[4]!.allowedMentions).toEqual({ parse: [], users: ['b'] });

    const old = press(service, message, 'start', 'owner');
    await old.done;
    expect(old.notifyUser).toHaveBeenCalledWith(
      '<@b> owns this matchmaking and decides when to start.',
    );
    await press(service, message, 'start', 'b').done;
    expect(registry.size).toBe(0);
  });

  test('a former owner who left can rejoin through the command', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'classic');
    await press(service, message, 'join', 'b').done;
    await press(service, message, 'leave', 'owner').done;
    const back = await openQueue(service, channel, 'classic', 'owner');
    expect(back.outcome).toBe('joined');
    expect(back.queue.players).toEqual(['b', 'owner']);
    expect(back.queue.ownerId).toBe('b');
  });

  test('when the last player leaves, the queue closes as if cancelled', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'leave', 'owner').done;

    expect(registry.size).toBe(0);
    expect(queueView(message.edits[0]!).title).toBe('[CLOSED] Dark RS 7 Matchmaking');
    expect(queueView(message.edits[0]!).buttons).toEqual([]);
    expect(channel.sent[2]!.content).toContain('[1/3 Dark RS 7] Matchmaking cancelled by OWNER.');
    expect(channel.sent[2]!.content).not.toContain('FYI');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(channel.sent).toHaveLength(3);
  });
});

describe('handleButton: start and cancel', () => {
  test('the owner can start early', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'classic');
    await press(service, message, 'join', 'b').done;
    await press(service, message, 'start', 'owner').done;

    expect(queueView(message.edits[1]!).title).toBe('[CLOSED] RS 7 Matchmaking');
    expect(queueView(message.edits[1]!).buttons).toEqual([]);
    expect(channel.sent[3]!.content).toContain("[2/4 RS 7] Matchmaking ready! Let's play!");
    expect(registry.size).toBe(0);
  });

  test('the owner can cancel; the expiry and reminder timers are dropped', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'cancel', 'owner').done;

    expect(queueView(message.edits[0]!).title).toBe('[CLOSED] Dark RS 7 Matchmaking');
    expect(channel.sent[2]!.content).toContain('[1/3 Dark RS 7] Matchmaking cancelled by OWNER.');
    expect(registry.size).toBe(0);
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(channel.sent).toHaveLength(3);
  });

  test('other users are refused privately with the owner named', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');

    const strangerStart = press(service, message, 'start', 'b');
    await strangerStart.done;
    expect(strangerStart.notifyUser).toHaveBeenCalledWith(
      '<@owner> owns this matchmaking and decides when to start.',
    );

    const strangerCancel = press(service, message, 'cancel', 'b');
    await strangerCancel.done;
    expect(strangerCancel.notifyUser).toHaveBeenCalledWith(
      '<@owner> owns this matchmaking and is the only one who can close it.',
    );
    expect(message.edits).toHaveLength(0);
    expect(channel.sent).toHaveLength(2);
  });
});

describe('handleButton: cooldown', () => {
  test('a second press within the cooldown is refused without touching the queue', async () => {
    let now = 1_000;
    const { service, channel, registry } = setup({
      service: { buttonCooldownMs: 3_000, now: () => now },
    });
    const { message } = await openQueue(service, channel, 'dark');

    await press(service, message, 'join', 'b').done;
    now += 1_000;
    const fast = press(service, message, 'leave', 'b');
    await fast.done;
    expect(fast.notifyUser).toHaveBeenCalledWith(COOLDOWN_MESSAGE);
    expect(registry.get('q1')?.queue.players).toEqual(['owner', 'b']);

    now += 3_000;
    const slow = press(service, message, 'leave', 'b');
    await slow.done;
    expect(slow.notifyUser).not.toHaveBeenCalled();
    expect(registry.get('q1')?.queue.players).toEqual(['owner']);
  });

  test('the cooldown is per user: others are not affected', async () => {
    const { service, channel, registry } = setup({
      service: { buttonCooldownMs: 3_000, now: () => 1_000 },
    });
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'join', 'b').done;
    const other = press(service, message, 'join', 'c');
    await other.done;
    expect(other.notifyUser).not.toHaveBeenCalled();
    expect(registry.size).toBe(0); // dark filled at 3
  });
});

describe('handleButton: closed, unknown and failing queues', () => {
  test('a press on a recently closed queue says it is closed, not that the bot restarted', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'cancel', 'owner').done;

    const late = press(service, message, 'join', 'b');
    await late.done;
    expect(late.notifyUser).toHaveBeenCalledWith(CLOSED_MESSAGE);
    expect(message.edits).toHaveLength(1); // no second edit
  });

  test('a press on an unknown queue removes the buttons and explains', async () => {
    const { service, channel } = setup();
    const stale = makeMessage('old');
    const { done, notifyUser, deferUpdate } = press(service, stale, 'join', 'b', {
      queueId: 'unknown',
    });
    await done;

    expect(deferUpdate).toHaveBeenCalled();
    expect(queueView(stale.edits[0]!).title).toBe(GONE_TITLE);
    expect(queueView(stale.edits[0]!).texts.join()).toContain(QUEUE_GONE_MESSAGE);
    expect(stale.edits[0]!.embeds).toEqual([]);
    expect(notifyUser).toHaveBeenCalledWith(QUEUE_GONE_MESSAGE);
    expect(channel.sent).toHaveLength(0);
  });

  test('still explains when the stale message cannot be edited', async () => {
    const { service } = setup();
    const stale = makeMessage('old');
    stale.edit.mockRejectedValue(apiError(ApiErrorCode.UnknownMessage));
    const { done, notifyUser } = press(service, stale, 'join', 'b', { queueId: 'unknown' });
    await done;
    expect(notifyUser).toHaveBeenCalledWith(QUEUE_GONE_MESSAGE);
  });

  test.each([ApiErrorCode.UnknownInteraction, ApiErrorCode.InteractionAlreadyAcknowledged])(
    'gives up quietly when deferUpdate fails with %i',
    async (code) => {
      const { service, channel } = setup();
      const { message } = await openQueue(service, channel, 'dark');
      const { done, notifyUser } = press(service, message, 'join', 'b', {
        deferUpdateError: apiError(code),
      });
      await done;
      expect(notifyUser).not.toHaveBeenCalled();
      expect(message.edits).toHaveLength(0);
    },
  );

  test('propagates unexpected errors from deferUpdate', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    const { done } = press(service, message, 'join', 'b', {
      deferUpdateError: new Error('network'),
    });
    await expect(done).rejects.toThrow('network');
  });

  test('a deleted queue message closes the queue with a clear error', async () => {
    const { service, channel, registry } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    message.edit.mockRejectedValue(apiError(ApiErrorCode.UnknownMessage));

    const { done } = press(service, message, 'join', 'b');
    await expect(done).rejects.toThrow(MESSAGE_DELETED_MESSAGE);
    expect(registry.size).toBe(0);
    expect(channel.sent).toHaveLength(2);
  });

  test('when the card cannot be refreshed, the action still counts and the notice still goes out', async () => {
    const { service, channel, registry, logger } = setup();
    const warn = vi.spyOn(logger, 'warn');
    const { message } = await openQueue(service, channel, 'dark');
    message.edit.mockRejectedValue(apiError(ApiErrorCode.MissingPermissions));
    const { done } = press(service, message, 'join', 'b');
    await expect(done).rejects.toThrow(CARD_STALE_MESSAGE);
    expect(registry.get('q1')?.queue.players).toEqual(['owner', 'b']);
    expect(channel.sent[2]!.content).toContain('B joined the squad.');
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'q1', action: 'join' }),
      'Queue updated but the card could not be refreshed',
    );
  });

  test('a card newer than this process is left alone when its queue is unknown', async () => {
    const { service, channel } = setup({ service: { now: () => 5_000 } });
    const fresh = makeMessage('fresh', channel.id, 6_000);
    const { done, notifyUser } = press(service, fresh, 'join', 'b', { queueId: 'unknown' });
    await done;
    expect(fresh.edit).not.toHaveBeenCalled();
    expect(notifyUser).toHaveBeenCalledWith(QUEUE_GONE_MESSAGE);
  });

  test('a refused press does not extend the cooldown', async () => {
    let now = 1_000;
    const { service, channel, registry } = setup({
      service: { buttonCooldownMs: 3_000, now: () => now },
    });
    const { message } = await openQueue(service, channel, 'dark');
    await press(service, message, 'join', 'b').done;
    now += 2_000;
    await press(service, message, 'leave', 'b').done; // refused: 2 s after the join
    now += 1_500;
    const third = press(service, message, 'leave', 'b'); // 3.5 s after the join: allowed
    await third.done;
    expect(third.notifyUser).not.toHaveBeenCalled();
    expect(registry.get('q1')?.queue.players).toEqual(['owner']);
  });

  test('a failed notification is logged, the action still counts', async () => {
    const { service, channel, registry, logger } = setup();
    const warn = vi.spyOn(logger, 'warn');
    const { message } = await openQueue(service, channel, 'dark');
    channel.send.mockRejectedValueOnce(apiError(ApiErrorCode.MissingPermissions));

    const { done, notifyUser } = press(service, message, 'join', 'b');
    await expect(done).resolves.toBeUndefined();
    expect(notifyUser).not.toHaveBeenCalled();
    expect(registry.get('q1')?.queue.players).toEqual(['owner', 'b']);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'q1', action: 'join' }),
      'Queue updated but the channel notification failed',
    );
  });
});

describe('timers: reminder and expiry', () => {
  test('expires the queue after the timeout and removes the buttons', async () => {
    const { service, channel, registry } = setup({ config: { queueReminderMs: 0 } });
    const { message } = await openQueue(service, channel);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
    expect(registry.size).toBe(1);
    expect(channel.sent).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1);
    expect(registry.size).toBe(0);
    expect(registry.getClosed('q1')?.status).toBe('expired');
    expect(queueView(message.edits[0]!).title).toBe('[CLOSED] Dark RS 7 Matchmaking');
    expect(queueView(message.edits[0]!).buttons).toEqual([]);
    expect(channel.sent[2]!.content).toContain(
      '[1/3 Dark RS 7] Matchmaking expired. Try again with /rs or /drs.',
    );
  });

  test.each<RedStarType>(['classic', 'dark'])(
    '%s: pings @everyone 10 minutes before expiry while the queue is open',
    async (type) => {
      const { service, channel } = setup();
      const { message } = await openQueue(service, channel, type);

      await vi.advanceTimersByTimeAsync(TIMEOUT_MS - REMINDER_MS - 1);
      expect(channel.sent).toHaveLength(2);

      await vi.advanceTimersByTimeAsync(1);
      expect(channel.sent).toHaveLength(3);
      const reminder = channel.sent[2]!;
      expect(reminder.content).toContain(
        type === 'dark' ? '@everyone Dark RS 7 closes' : '@everyone RS 7 closes',
      );
      expect(reminder.content).toContain('in 10 minutes. Anyone?');
      expect(reminder.content).toContain(message.url);
      expect(reminder.allowedMentions).toEqual({ parse: ['everyone'] });

      await vi.advanceTimersByTimeAsync(REMINDER_MS);
      expect(channel.sent).toHaveLength(4);
      expect(channel.sent[3]!.content).toContain('Matchmaking expired');
    },
  );

  test.each<[string, (s: RedStarService, m: FakeMessage) => Promise<unknown>]>([
    ['cancelled', (s, m) => press(s, m, 'cancel', 'owner').done],
    ['started', (s, m) => press(s, m, 'start', 'owner').done],
    ['emptied', (s, m) => press(s, m, 'leave', 'owner').done],
    [
      'filled',
      async (s, m) => {
        await press(s, m, 'join', 'b').done;
        await press(s, m, 'join', 'c').done;
      },
    ],
  ])('neither reminder nor expiry fire for a queue that was %s', async (_label, close) => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await close(service, message);
    const sentBefore = channel.sent.length;
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(channel.sent).toHaveLength(sentBefore);
  });

  test('a queue cancelled between the reminder and the expiry gets no expiry notice', async () => {
    const { service, channel } = setup();
    const { message } = await openQueue(service, channel, 'dark');
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - REMINDER_MS);
    expect(channel.sent).toHaveLength(3);
    await press(service, message, 'cancel', 'owner').done;
    await vi.advanceTimersByTimeAsync(REMINDER_MS + 1);
    expect(channel.sent).toHaveLength(4); // card, announcement, reminder, cancelled
  });

  test.each([0, TIMEOUT_MS, TIMEOUT_MS + 1])(
    'the reminder is disabled when the lead is %i ms',
    async (lead) => {
      const { service, channel } = setup({ config: { queueReminderMs: lead } });
      expect(service.remindsBeforeExpiry).toBe(false);
      await openQueue(service, channel, 'dark');
      await vi.advanceTimersByTimeAsync(TIMEOUT_MS - 1);
      expect(channel.sent).toHaveLength(2);
    },
  );

  test('a failed reminder is logged and does not stop the expiry', async () => {
    const { service, channel, logger } = setup();
    const warn = vi.spyOn(logger, 'warn');
    await openQueue(service, channel, 'dark');
    channel.send.mockRejectedValueOnce(new Error('rate limited'));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS - REMINDER_MS);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'q1' }),
      'Failed to post queue reminder',
    );
    await vi.advanceTimersByTimeAsync(REMINDER_MS);
    expect(channel.sent[channel.sent.length - 1]!.content).toContain('Matchmaking expired');
  });

  test('expiry of a queue whose message was deleted is quiet and logged at info', async () => {
    const { service, channel, registry, logger } = setup({ config: { queueReminderMs: 0 } });
    const info = vi.spyOn(logger, 'info');
    const error = vi.spyOn(logger, 'error');
    const { message } = await openQueue(service, channel, 'dark');
    message.edit.mockRejectedValue(apiError(ApiErrorCode.UnknownMessage));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(registry.size).toBe(0);
    expect(channel.sent).toHaveLength(2);
    expect(info).toHaveBeenCalledWith(
      { queueId: 'q1' },
      'Queue message was deleted; dropping the queue',
    );
    expect(error).not.toHaveBeenCalled();
  });

  test('a failed expiry announcement is logged as a warning', async () => {
    const { service, channel, logger } = setup({ config: { queueReminderMs: 0 } });
    const warn = vi.spyOn(logger, 'warn');
    await openQueue(service, channel, 'dark');
    channel.send.mockRejectedValueOnce(new Error('boom'));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'q1' }),
      'Failed to close an expired queue',
    );
  });

  test('an expiry whose card edit fails is logged, never thrown', async () => {
    const { service, channel, logger } = setup({ config: { queueReminderMs: 0 } });
    const warn = vi.spyOn(logger, 'warn');
    const { message } = await openQueue(service, channel, 'dark');
    message.edit.mockRejectedValue(apiError(ApiErrorCode.MissingPermissions));
    await expect(service.expireQueue('q1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'q1' }),
      'Failed to close an expired queue',
    );
    expect(channel.sent).toHaveLength(2); // card + announcement only
  });

  test('a deleted channel counts as a deleted card', async () => {
    const { service, channel, registry } = setup({ config: { queueReminderMs: 0 } });
    const { message } = await openQueue(service, channel, 'dark');
    message.edit.mockRejectedValue(apiError(ApiErrorCode.UnknownChannel));
    await vi.advanceTimersByTimeAsync(TIMEOUT_MS);
    expect(registry.size).toBe(0);
    expect(channel.sent).toHaveLength(2);
  });

  test('expireQueue and remindQueue are no-ops for unknown ids', async () => {
    const { service, channel } = setup();
    await expect(service.expireQueue('nope')).resolves.toBeUndefined();
    await expect(service.remindQueue('nope')).resolves.toBeUndefined();
    expect(channel.sent).toHaveLength(0);
  });
});

describe('closeAll', () => {
  test('marks every open queue as interrupted, tells the players, drops timers', async () => {
    const { service, channel, registry } = setup();
    const { message: first } = await openQueue(service, channel, 'dark');
    await press(service, first, 'join', 'b').done;
    const other = makeChannel('chan-2');
    const { message: second } = await openQueue(service, other, 'classic');
    second.edit.mockRejectedValue(apiError(ApiErrorCode.UnknownMessage));

    await service.closeAll();
    expect(registry.size).toBe(0);
    const card = queueView(first.edits[1]!);
    expect(card.title).toBe('[CLOSED] Dark RS 7 Matchmaking');
    expect(card.texts[0]).toContain('Closed: the bot restarted.');
    expect(card.buttons).toEqual([]);

    // one notice per queue, tagging its players; none for the queue whose message is gone
    const notice = channel.sent[3]!;
    expect(notice.content).toBe(
      '🔴 [2/3 Dark RS 7] Matchmaking closed, the bot restarted. Open a new one in a few minutes.\nFYI: <@owner>, <@b>',
    );
    expect(notice.allowedMentions).toEqual({ parse: [], users: ['owner', 'b'] });
    expect(second.edit).toHaveBeenCalled();
    expect(other.sent).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(TIMEOUT_MS + 1);
    expect(channel.sent).toHaveLength(4);
    expect(other.sent).toHaveLength(2);
  });

  test('one card that cannot be edited does not stop the other queues from closing', async () => {
    const { service, channel, registry } = setup();
    const { message: broken } = await openQueue(service, channel, 'dark');
    const { message: fine } = await openQueue(service, channel, 'classic');
    broken.edit.mockRejectedValue(apiError(ApiErrorCode.MissingPermissions));

    await expect(service.closeAll()).resolves.toBeUndefined();
    expect(registry.size).toBe(0);
    expect(queueView(fine.edits[0]!).title).toBe('[CLOSED] RS 7 Matchmaking');
    // the presses that land in the shutdown window still hear "closed", not "unknown"
    expect(registry.getClosed('q1')?.status).toBe('interrupted');
    expect(registry.getClosed('q2')?.status).toBe('interrupted');
    // and nothing new opens any more
    await expect(openQueue(service, channel, 'dark', 'c')).rejects.toThrow(RESTARTING_MESSAGE);
  });

  test('a failed shutdown notice is logged and does not stop the others', async () => {
    const { service, channel, logger } = setup();
    const warn = vi.spyOn(logger, 'warn');
    await openQueue(service, channel, 'dark');
    channel.send.mockRejectedValueOnce(new Error('rate limited'));
    await expect(service.closeAll()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ queueId: 'q1' }),
      'Failed to close a queue for shutdown',
    );
  });

  test('closeAll with nothing open does nothing', async () => {
    const { service } = setup();
    await expect(service.closeAll()).resolves.toBeUndefined();
  });
});
