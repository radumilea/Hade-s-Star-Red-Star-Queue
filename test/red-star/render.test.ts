import { ButtonStyle, ComponentType, MessageFlags } from 'discord.js';
import { describe, expect, test } from 'vitest';
import { FOOTER_TEXT } from '../../src/red-star/branding.js';
import { queueView, type QueueView } from '../fakes.js';
import { createQueue, join, leave, type RedStarQueue } from '../../src/red-star/queue.js';
import {
  BUTTON_LABELS,
  CLOSE_REASONS,
  COLORS,
  GONE_TITLE,
  QUEUE_GONE_MESSAGE,
  SCROLL_LINK_LABEL,
  STATUS_MARKS,
  cancelledNotification,
  expiredNotification,
  expiryLine,
  interruptedNotification,
  expiryText,
  goneMessage,
  joinedNotification,
  leftNotification,
  notificationPrefix,
  openedAnnouncement,
  ownerInstructions,
  playerList,
  queueComponents,
  queueContainer,
  queueMessage,
  queuePost,
  queueTitle,
  readyNotification,
  reminderMessage,
  slotValue,
  transitionNotification,
} from '../../src/red-star/render.js';
import { RS_STAR_TYPE, type RedStarType } from '../../src/red-star/types.js';

const CREATED_AT = 1_000_000;
const TIMEOUT_MS = 60_000;
const url = 'https://discord.com/channels/g/c/m';
const scrollLink = `[See matchmaking](${url})`;

function make(type: RedStarType = 'classic', players: string[] = []): RedStarQueue {
  let queue = createQueue({
    id: 'q1',
    ownerId: 'owner',
    ownerName: 'Owner',
    level: 7,
    type,
    now: CREATED_AT,
    timeoutMs: TIMEOUT_MS,
  });
  for (const player of players) {
    const result = join(queue, player, player.toUpperCase());
    if (!result.ok) throw result.error;
    queue = result.value;
  }
  return queue;
}

const viewOf = (queue: RedStarQueue): QueueView => queueView(queueMessage(queue));
const slotsOf = (queue: RedStarQueue): string[] =>
  (viewOf(queue).texts[0] ?? '').split('\n').filter((line) => /^\d+\. /.test(line));

describe('queueTitle / notificationPrefix / playerList', () => {
  test('classic', () => {
    expect(queueTitle(make('classic'))).toBe('[1/4] RS 7 Matchmaking');
    expect(queueTitle(make('classic', ['b', 'c']))).toBe('[3/4] RS 7 Matchmaking');
    expect(notificationPrefix(make('classic', ['b']))).toBe('[2/4 RS 7]');
  });

  test('dark', () => {
    expect(queueTitle(make('dark'))).toBe('[1/3] Dark RS 7 Matchmaking');
    expect(notificationPrefix(make('dark', ['b']))).toBe('[2/3 Dark RS 7]');
  });

  test('closed queues are marked CLOSED whatever the count', () => {
    expect(queueTitle(make('dark', ['b', 'c']))).toBe('[CLOSED] Dark RS 7 Matchmaking');
    expect(queueTitle({ ...make('classic'), status: 'cancelled' })).toBe(
      '[CLOSED] RS 7 Matchmaking',
    );
  });

  test('playerList mentions everyone, or says nobody', () => {
    expect(playerList(make('classic', ['b']))).toBe('<@owner>, <@b>');
    expect(playerList({ ...make('classic'), players: [] })).toBe('nobody');
  });
});

describe('expiryText', () => {
  test('uses Discord timestamps so every reader sees their own timezone', () => {
    const unix = Math.floor((CREATED_AT + TIMEOUT_MS) / 1000);
    expect(expiryText(make())).toBe(`<t:${unix}:t> (<t:${unix}:R>)`);
  });
});

describe('queueContainer', () => {
  test('classic: header with expiry, blank line, 4 numbered slots, divider, instructions, footer', () => {
    const queue = make('classic');
    const view = viewOf(queue);
    expect(view.title).toBe('[1/4] RS 7 Matchmaking');
    expect(view.accentColor).toBe(RS_STAR_TYPE.classic.color);
    expect(view.separators).toBe(1);

    // one text block: heading, expiry subtext (reader's own timezone), an empty line, the slots
    expect(view.texts[0]).toBe(
      `## [1/4] RS 7 Matchmaking\n${expiryLine(queue)}\n\n**Squad:**\n1. Owner *(owner)*\n2. -\n3. -\n4. -`,
    );
    expect(expiryLine(queue)).toBe(`-# *Expires at ${expiryText(queue)}*`);

    // plain text, not italic; the owner's controls in small text without naming the owner
    expect(view.texts[1]).toBe(
      'Press **Join** to enter the matchmaking or **Leave** to exit it.\n' +
        '-# The owner can **Start** early with the current squad or **Cancel Matchmaking** to close it.',
    );
    expect(view.texts[1]).not.toContain('(owner)');

    expect(view.texts[2]).toBe(`-# ${FOOTER_TEXT}`);
    expect(view.texts).toHaveLength(3);
  });

  test('the divider separates the slot list from the instructions', () => {
    const json = queueContainer(make('classic')).toJSON();
    expect(json.components.map((c) => c.type)).toEqual([
      ComponentType.TextDisplay, // header + slots
      ComponentType.Separator,
      ComponentType.TextDisplay, // instructions
      ComponentType.TextDisplay, // footer
    ]);
  });

  test('the owner mark follows the current owner, not the creator', () => {
    const queue = { ...make('classic', ['b', 'c']), ownerId: 'b', players: ['b', 'c'] };
    expect(slotsOf(queue)).toEqual(['1. B *(owner)*', '2. C', '3. -', '4. -']);
  });

  test('dark: 3 slots', () => {
    const queue = make('dark', ['b']);
    const view = viewOf(queue);
    expect(view.title).toBe('[2/3] Dark RS 7 Matchmaking');
    expect(view.accentColor).toBe(RS_STAR_TYPE.dark.color);
    expect(slotsOf(queue)).toEqual(['1. Owner *(owner)*', '2. B', '3. -']);
  });

  test('a full (ready) queue says so under the title and drops the instructions', () => {
    const queue = make('dark', ['b', 'c']);
    const view = viewOf(queue);
    expect(view.title).toBe('[CLOSED] Dark RS 7 Matchmaking');
    expect(view.texts[0]).toBe(
      '## [CLOSED] Dark RS 7 Matchmaking\n-# *Full squad. Ready to run.*\n\n**Squad:**\n1. Owner *(owner)*\n2. B\n3. C',
    );
    expect(view.accentColor).toBe(COLORS.closed);
    expect(view.texts).toHaveLength(2); // header + slots, footer
    expect(view.texts.join()).not.toContain('**Join**');
  });

  test.each<[Exclude<RedStarQueue['status'], 'open'>, string]>([
    ['ready', 'Full squad. Ready to run.'],
    ['started', 'The owner started with an incomplete squad.'],
    ['cancelled', 'Cancelled by the owner.'],
    ['expired', 'Expired: the squad did not fill in time.'],
    ['interrupted', 'Closed: the bot restarted.'],
  ])('%s: greyed out, reason under the title, every slot still listed', (status, reason) => {
    const queue = { ...make('classic', ['b']), status };
    const view = viewOf(queue);
    expect(view.accentColor).toBe(COLORS.closed);
    expect(view.texts[0]).toContain(`\n-# *${reason}*\n`);
    expect(CLOSE_REASONS[status]).toBe(reason);
    expect(view.texts.join()).not.toContain('expires');
    // an incomplete squad stays visible as such
    expect(slotsOf(queue)).toEqual(['1. Owner *(owner)*', '2. B', '3. -', '4. -']);
  });

  test('component limits are respected', () => {
    const json = queueContainer(make('classic', ['b', 'c'])).toJSON();
    expect(json.components.length).toBeLessThanOrEqual(40);
    for (const text of viewOf(make('classic', ['b', 'c'])).texts) {
      expect(text.length).toBeLessThanOrEqual(4000);
    }
  });
});

describe('ownerInstructions', () => {
  test('confirms ownership and points to /help, nothing more', () => {
    expect(ownerInstructions()).toBe(
      'Matchmaking posted, you are the owner.\nUse /help if needed.',
    );
  });
});

describe('queueComponents / queueMessage / queuePost', () => {
  test('one row: Join green, Leave grey, Start blue, Cancel red while open', () => {
    const rows = queueComponents(make('classic'));
    expect(rows).toHaveLength(1);
    const buttons = rows[0]!.toJSON().components;
    expect(buttons.map((b) => ('label' in b ? b.label : ''))).toEqual([
      BUTTON_LABELS.join,
      BUTTON_LABELS.leave,
      BUTTON_LABELS.start,
      BUTTON_LABELS.cancel,
    ]);
    expect(buttons.map((b) => ('custom_id' in b ? b.custom_id : ''))).toEqual([
      'rs:join:q1',
      'rs:leave:q1',
      'rs:start:q1',
      'rs:cancel:q1',
    ]);
    expect(buttons.map((b) => b.style)).toEqual([
      ButtonStyle.Success,
      ButtonStyle.Secondary,
      ButtonStyle.Primary,
      ButtonStyle.Danger,
    ]);
    expect(buttons.every((b) => !b.disabled)).toBe(true);
  });

  test.each<RedStarQueue['status']>(['ready', 'started', 'cancelled', 'expired'])(
    'no buttons at all once the queue is %s',
    (status) => {
      expect(queueComponents({ ...make('classic'), status })).toEqual([]);
      const message = queueMessage({ ...make('classic'), status });
      expect(message.components).toHaveLength(1); // the card only
      expect(queueView(message).buttons).toEqual([]);
    },
  );

  test('queueMessage (edits) is a component-layout message: the card, the buttons, no pings', () => {
    const message = queueMessage(make('classic'));
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.embeds).toBeUndefined();
    expect(message.components).toHaveLength(2);
    expect(queueView(message).buttons.map((b) => b.label)).toEqual([
      'Join',
      'Leave',
      'Start',
      'Cancel Matchmaking',
    ]);
    // the card never pings: the opening is announced separately
    expect(message.allowedMentions).toEqual({ parse: [] });
  });

  test('queuePost (first send) is the same card, sent silently so it causes no empty push', () => {
    const post = queuePost(make('classic'));
    expect(post.flags).toBe(MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications);
    expect(queueView(post).title).toBe(queueView(queueMessage(make('classic'))).title);
    expect(post.allowedMentions).toEqual({ parse: [] });
  });

  test('openedAnnouncement pings @everyone in plain prose and names the creator', () => {
    const queue = { ...make('classic', ['b']), ownerId: 'b', players: ['b'] };
    const message = openedAnnouncement(queue);
    expect(message.content).toBe('@everyone Owner wants to play RS 7! Press Join to team up.');
    expect(message.content).not.toMatch(/[*_`]|\]\(|https?:/);
    expect(message.allowedMentions).toEqual({ parse: ['everyone'] });
    expect(message.embeds).toBeUndefined();
    expect(message.flags).toBeUndefined();
  });

  test('goneMessage replaces an unknown queue message, embeds cleared so old messages convert', () => {
    const message = goneMessage();
    expect(message.flags).toBe(MessageFlags.IsComponentsV2);
    expect(message.embeds).toEqual([]);
    const view = queueView(message);
    expect(view.title).toBe(GONE_TITLE);
    expect(view.texts[0]).toContain(QUEUE_GONE_MESSAGE);
    expect(view.buttons).toEqual([]);
    expect(view.accentColor).toBe(COLORS.closed);
  });
});

describe('notifications', () => {
  /** Plain text: a status dot, the title, the squad; mentions only where someone is pinged. */
  test('joined: title and a link back to the card, nobody pinged', () => {
    expect(SCROLL_LINK_LABEL).toBe('See matchmaking');
    const n = joinedNotification({
      queue: make('dark', ['b']),
      messageUrl: url,
      actorId: 'bob',
      displayName: 'Bob',
    });
    expect(n.content).toBe(
      `${STATUS_MARKS.joined} [2/3 Dark RS 7] Bob joined the squad.\n${scrollLink}`,
    );
    expect(n.allowedMentions).toEqual({ parse: [] });
    expect(n.embeds).toBeUndefined();
  });

  test('left: title and a link back to the card, nobody pinged', () => {
    const n = leftNotification({
      queue: make('classic'),
      messageUrl: url,
      actorId: 'bob',
      displayName: 'Bob',
    });
    expect(n.content).toBe(`${STATUS_MARKS.left} [1/4 RS 7] Bob left the squad.\n${scrollLink}`);
    expect(n.allowedMentions).toEqual({ parse: [] });
  });

  test('left with a new owner: the new owner is mentioned and is the only one pinged', () => {
    const queue = { ...make('classic', ['b']), ownerId: 'b', players: ['b'] };
    const n = leftNotification({
      queue,
      messageUrl: url,
      actorId: 'owner',
      displayName: 'Owner',
      newOwnerId: 'b',
    });
    expect(n.content).toBe(
      `${STATUS_MARKS.left} [1/4 RS 7] Owner left the squad.\nOwnership passed to <@b>.\n${scrollLink}`,
    );
    expect(n.allowedMentions).toEqual({ parse: [], users: ['b'] });
  });

  test('ready: every player mentioned and pinged', () => {
    const n = readyNotification({ queue: make('classic', ['b', 'c', 'd']), messageUrl: url });
    expect(n.content).toBe(
      `${STATUS_MARKS.ready} [4/4 RS 7] Matchmaking ready! Let's play!\nSquad: <@owner>, <@b>, <@c>, <@d>`,
    );
    expect(n.allowedMentions).toEqual({ parse: [], users: ['owner', 'b', 'c', 'd'] });
  });

  test('cancelled: every other player told, not the one who closed it', () => {
    const n = cancelledNotification({
      queue: make('classic', ['b']),
      messageUrl: url,
      actorId: 'owner',
      displayName: 'Owner',
    });
    expect(n.content).toBe(
      `${STATUS_MARKS.closed} [2/4 RS 7] Matchmaking cancelled by Owner.\nHeads up, <@b>`,
    );
    expect(n.allowedMentions).toEqual({ parse: [], users: ['b'] });
  });

  test('cancelled with nobody else: no FYI line', () => {
    const queue = { ...make('classic'), players: [], status: 'cancelled' as const };
    const n = cancelledNotification({
      queue,
      messageUrl: url,
      actorId: 'owner',
      displayName: 'Owner',
    });
    expect(n.content).toBe(`${STATUS_MARKS.closed} [0/4 RS 7] Matchmaking cancelled by Owner.`);
    expect(n.allowedMentions).toEqual({ parse: [], users: [] });
  });

  test('expired: every player told', () => {
    const n = expiredNotification({ queue: make('dark', ['b']), messageUrl: url });
    expect(n.content).toBe(
      `${STATUS_MARKS.closed} [2/3 Dark RS 7] Matchmaking expired. Try again with /rs or /drs.\nFYI: <@owner>, <@b>`,
    );
    expect(n.allowedMentions).toEqual({ parse: [], users: ['owner', 'b'] });
  });

  test('interrupted (bot shutdown): every player told to come back', () => {
    const n = interruptedNotification({ queue: make('dark', ['b']), messageUrl: url });
    expect(n.content).toBe(
      `${STATUS_MARKS.closed} [2/3 Dark RS 7] Matchmaking closed, the bot restarted. Open a new one in a few minutes.\nFYI: <@owner>, <@b>`,
    );
    expect(n.allowedMentions).toEqual({ parse: [], users: ['owner', 'b'] });
  });

  test('no markdown or links anywhere: a push notification would show them raw', () => {
    const queue = make('classic', ['b']);
    const all = [
      joinedNotification({ queue, messageUrl: url, actorId: 'b', displayName: 'B' }),
      leftNotification({ queue, messageUrl: url, actorId: 'b', displayName: 'B', newOwnerId: 'b' }),
      readyNotification({ queue, messageUrl: url }),
      cancelledNotification({ queue, messageUrl: url, actorId: 'b', displayName: 'B' }),
      expiredNotification({ queue, messageUrl: url }),
      interruptedNotification({ queue, messageUrl: url }),
    ];
    for (const message of all) {
      // bold/italic/code markers and masked links; "[2/4 RS 7]" brackets are fine.
      // The only exception is the link back to the card on the last line of joined / left.
      const lines = (message.content ?? '').split('\n');
      if (lines[lines.length - 1] === scrollLink) lines.pop();
      expect(lines.join('\n')).not.toMatch(/[*_`]|\]\(|https?:/);
      expect(message.embeds).toBeUndefined();
      expect(message.components).toBeUndefined();
    }
  });

  test('a nickname shaped like a link or a ping cannot become one', () => {
    const queue = {
      ...make('classic'),
      names: { owner: '[Free Nitro](https://evil.example) @everyone' },
    };
    const slot = slotValue(queue, 0);
    expect(slot).toContain(String.fromCharCode(92) + '[Free Nitro]'); // escaped bracket: no link
    for (const text of [
      openedAnnouncement(queue).content ?? '',
      joinedNotification({
        queue,
        messageUrl: url,
        actorId: 'owner',
        displayName: queue.names.owner,
      }).content ?? '',
    ].map((content) => content.split(String.fromCharCode(10))[0] ?? '')) {
      // first line only: the last line is the bot's own "See matchmaking" link
      expect(text).not.toMatch(/\]\(https?:\/\//);
      expect(text).not.toContain(' @everyone');
      expect(text).toContain('Free Nitro');
    }
  });

  test('display names are markdown-escaped in the card, where they are never pushed', () => {
    const queue = { ...make('classic'), names: { owner: '*Ra_du*' } };
    expect(slotValue(queue, 0)).toBe('\\*Ra\\_du\\* *(owner)*');
  });
});

describe('reminderMessage', () => {
  test('pings everyone in plain prose, says how long is left and links the message', () => {
    const queue = make('dark', ['b']);
    const message = reminderMessage(queue, url, 10 * 60_000);
    expect(message.content).toBe(
      `@everyone One slot left in Dark RS 7! It closes in 10 minutes.\n${scrollLink}`,
    );
    // several slots left: a generic call
    expect(reminderMessage(make('classic'), url, 10 * 60_000).content).toBe(
      `@everyone RS 7 closes in 10 minutes. Anyone?\n${scrollLink}`,
    );
    expect(message.allowedMentions).toEqual({ parse: ['everyone'] });
    expect(message.embeds).toBeUndefined();
  });

  test.each([
    [60_000, '1 minute'],
    [90_000, '2 minutes'],
    [1, '1 minute'],
  ])('%i ms reads as "%s"', (leadMs, text) => {
    expect(reminderMessage(make(), url, leadMs).content).toContain(`closes in ${text}.`);
  });
});

describe('transitionNotification', () => {
  const unwrap = (r: ReturnType<typeof join>): RedStarQueue => {
    if (!r.ok) throw r.error;
    return r.value;
  };

  test('a join never pings anyone', () => {
    const two = make('classic', ['b']);
    const three = unwrap(join(two, 'c', 'C'));
    const n = transitionNotification({
      before: two,
      after: three,
      action: 'join',
      actorId: 'c',
      displayName: 'C',
      messageUrl: url,
    });
    expect(n.content).toBe(`${STATUS_MARKS.joined} [3/4 RS 7] C joined the squad.\n${scrollLink}`);
    expect(n.allowedMentions).toEqual({ parse: [] });
  });

  test('leave names the new owner only when ownership moved', () => {
    const before = make('classic', ['b', 'c']);
    const ownerLeft = unwrap(leave(before, 'owner'));
    const moved = transitionNotification({
      before,
      after: ownerLeft,
      action: 'leave',
      actorId: 'owner',
      displayName: 'Owner',
      messageUrl: url,
    });
    expect(moved.content).toContain('\nOwnership passed to <@b>.\n');
    expect(moved.content).not.toContain('Squad');
    expect(moved.allowedMentions).toEqual({ parse: [], users: ['b'] });

    const memberLeft = unwrap(leave(before, 'c'));
    const stayed = transitionNotification({
      before,
      after: memberLeft,
      action: 'leave',
      actorId: 'c',
      displayName: 'C',
      messageUrl: url,
    });
    expect(stayed.content).not.toContain('New owner');
    expect(stayed.content).not.toContain('Squad');
    expect(stayed.allowedMentions).toEqual({ parse: [] });
  });

  test.each<[RedStarQueue['status'], string]>([
    ['ready', "Matchmaking ready! Let's play!"],
    ['started', "Matchmaking ready! Let's play!"],
    ['cancelled', 'Matchmaking cancelled by X.'],
    ['expired', 'Matchmaking expired. Try again with /rs or /drs.'],
    ['interrupted', 'Matchmaking closed, the bot restarted. Open a new one in a few minutes.'],
  ])('%s → "%s"', (status, suffix) => {
    const before = make('classic', ['b']);
    const after = { ...before, status };
    const n = transitionNotification({
      before,
      after,
      action: 'start',
      actorId: 'x',
      displayName: 'X',
      messageUrl: url,
    });
    expect(n.content).toContain(`[2/4 RS 7] ${suffix}`);
    // closing a queue pings every player in it
    expect(n.content).toContain('<@owner>, <@b>');
    expect(n.allowedMentions).toEqual({ parse: [], users: ['owner', 'b'] });
  });
});
