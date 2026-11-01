import { Events, GuildMember, MessageFlags, type Client, type Interaction } from 'discord.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { legacyCommandsNotice } from '../../src/commands/help.js';
import { LEGACY_NOTICE_TTL_MS } from '../../src/commands/prefix/handle.js';
import { commandsByName, createCommands } from '../../src/commands/registry.js';
import type { SlashCommand } from '../../src/commands/types.js';
import {
  UNKNOWN_COMMAND_MESSAGE,
  handleInteraction,
  registerEvents,
} from '../../src/discord/events.js';
import { TEMPORARY_REPLY_TTL_MS, temporaryMarker } from '../../src/discord/replies.js';
import { GENERIC_USER_MESSAGE } from '../../src/errors.js';
import { CLOSED_MESSAGE } from '../../src/red-star/queue.js';
import {
  FakeClient,
  queueView,
  makeButtonInteraction,
  makeChannel,
  makeContext,
  makeDiscordMessage,
  makeMessage,
  makeSlashInteraction,
  type FakeChannel,
  type FakeMessage,
  type TestContextOptions,
} from '../fakes.js';

/** Private replies to users are temporary and say so. */
const temp = (text: string) => `${text}\n${temporaryMarker(TEMPORARY_REPLY_TTL_MS)}`;

function setup(options: TestContextOptions = {}) {
  const context = makeContext(options);
  return { ...context, commands: commandsByName(createCommands()) };
}

async function openQueue(ctx: ReturnType<typeof setup>['ctx'], channel: FakeChannel) {
  const { queue, message } = await ctx.redStar.openQueue({
    ownerId: 'owner',
    displayName: 'Owner',
    level: 7,
    type: 'dark',
    channel,
  });
  return { queue, message: message as FakeMessage };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('handleInteraction: slash commands', () => {
  test('routes to the command and the command runs end to end', async () => {
    const { ctx, commands, registry } = setup();
    const { interaction, raw, channel } = makeSlashInteraction({ commandName: 'drs' });
    await handleInteraction(interaction, ctx, commands);
    expect(registry.size).toBe(1);
    expect(queueView(channel!.sent[1]!).title).toBe('[1/3] Dark RS 7 Matchmaking');
    expect(raw.editReply).toHaveBeenCalledTimes(1);
  });

  test('unknown command gets a temporary ephemeral explanation', async () => {
    const { ctx, commands } = setup();
    const { interaction, raw } = makeSlashInteraction({ commandName: 'ghost' });
    await handleInteraction(interaction, ctx, commands);
    expect(raw.reply).toHaveBeenCalledWith({
      content: temp(UNKNOWN_COMMAND_MESSAGE),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    await vi.advanceTimersByTimeAsync(TEMPORARY_REPLY_TTL_MS);
    expect(raw.deleteReply).toHaveBeenCalled();
  });

  test('a user-facing error from a deferred command edits the deferred reply', async () => {
    const { ctx, commands } = setup();
    const { interaction, raw } = makeSlashInteraction({ channel: null });
    await handleInteraction(interaction, ctx, commands);
    expect(raw.editReply).toHaveBeenCalledWith({
      content: temp('This command only works in a server text channel.'),
      allowedMentions: { parse: [] },
    });
  });

  test('an unexpected error is logged and the user gets a generic message', async () => {
    const { ctx, logger } = setup();
    const errorSpy = vi.spyOn(logger, 'error');
    const broken: SlashCommand = {
      name: 'rs',
      toJSON: () => ({ name: 'rs', description: 'x' }),
      execute: async () => {
        throw new Error('kaboom');
      },
    };
    const { interaction, raw } = makeSlashInteraction();
    await handleInteraction(interaction, ctx, new Map([['rs', broken]]));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'command', name: 'rs', userId: 'owner' }),
      'Handler failed',
    );
    expect(raw.reply).toHaveBeenCalledWith({
      content: temp(GENERIC_USER_MESSAGE),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  test('uses followUp when the interaction was already replied to', async () => {
    const { ctx, commands } = setup();
    const { interaction, raw } = makeSlashInteraction({ commandName: 'ghost' });
    raw.replied = true;
    await handleInteraction(interaction, ctx, commands);
    expect(raw.followUp).toHaveBeenCalledWith({
      content: temp(UNKNOWN_COMMAND_MESSAGE),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    expect(raw.reply).not.toHaveBeenCalled();
  });
});

describe('handleInteraction: buttons', () => {
  test('a join button goes through the service', async () => {
    const { ctx, commands } = setup();
    const channel = makeChannel();
    const { queue, message } = await openQueue(ctx, channel);
    const { interaction, raw } = makeButtonInteraction(`rs:join:${queue.id}`, message);
    await handleInteraction(interaction, ctx, commands);
    expect(raw.deferUpdate).toHaveBeenCalled();
    expect(channel.sent[2]!.content).toContain('[2/3 Dark RS 7] Bee joined the squad.');
  });

  test('uses the guild nickname when the member is a GuildMember, or the raw nick', async () => {
    const { ctx, commands } = setup();
    const channel = makeChannel();
    const { queue, message } = await openQueue(ctx, channel);

    const member = Object.create(GuildMember.prototype) as GuildMember;
    Object.defineProperty(member, 'displayName', { value: 'Nick' });
    await handleInteraction(
      makeButtonInteraction(`rs:join:${queue.id}`, message, { member }).interaction,
      ctx,
      commands,
    );
    expect(channel.sent[2]!.content).toContain('Nick joined');

    const raw = { nick: 'RawNick' };
    await handleInteraction(
      makeButtonInteraction(`rs:leave:${queue.id}`, message, { member: raw }).interaction,
      ctx,
      commands,
    );
    expect(channel.sent[3]!.content).toContain('RawNick left');
  });

  test('a rejected action is relayed privately via followUp after deferUpdate', async () => {
    const { ctx, commands } = setup();
    const channel = makeChannel();
    const { queue, message } = await openQueue(ctx, channel);
    const { interaction, raw } = makeButtonInteraction(`rs:start:${queue.id}`, message);
    await handleInteraction(interaction, ctx, commands);
    expect(raw.followUp).toHaveBeenCalledWith({
      content: temp('<@owner> owns this matchmaking and decides when to start.'),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    expect(channel.sent).toHaveLength(2);
  });

  test('the owner can cancel from the public button', async () => {
    const { ctx, commands, registry } = setup();
    const channel = makeChannel();
    const { queue, message } = await openQueue(ctx, channel);
    const { interaction } = makeButtonInteraction(`rs:cancel:${queue.id}`, message, {
      userId: 'owner',
    });
    await handleInteraction(interaction, ctx, commands);
    expect(registry.size).toBe(0);
    expect(queueView(message.edits[0]!).title).toBe('[CLOSED] Dark RS 7 Matchmaking');
  });

  test('a press on a queue that just closed gets the closed message', async () => {
    const { ctx, commands } = setup();
    const channel = makeChannel();
    const { queue, message } = await openQueue(ctx, channel);
    await handleInteraction(
      makeButtonInteraction(`rs:cancel:${queue.id}`, message, { userId: 'owner' }).interaction,
      ctx,
      commands,
    );
    const { interaction, raw } = makeButtonInteraction(`rs:join:${queue.id}`, message);
    await handleInteraction(interaction, ctx, commands);
    expect(raw.followUp).toHaveBeenCalledWith({
      content: temp(CLOSED_MESSAGE),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  test('buttons from other features are ignored', async () => {
    const { ctx, commands } = setup();
    const { interaction, raw } = makeButtonInteraction('poll:vote:1', makeMessage());
    await handleInteraction(interaction, ctx, commands);
    expect(raw.deferUpdate).not.toHaveBeenCalled();
    expect(raw.reply).not.toHaveBeenCalled();
  });

  test('a failing button handler is logged and answered generically', async () => {
    const { ctx, commands, logger } = setup();
    const errorSpy = vi.spyOn(logger, 'error');
    const { interaction, raw } = makeButtonInteraction('rs:join:q', makeMessage());
    raw.deferUpdate.mockRejectedValue(new Error('network'));
    await handleInteraction(interaction, ctx, commands);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'button' }),
      'Handler failed',
    );
    expect(raw.reply).toHaveBeenCalledWith({
      content: temp(GENERIC_USER_MESSAGE),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  test('other interaction kinds are ignored', async () => {
    const { ctx, commands } = setup();
    const other = {
      isChatInputCommand: () => false,
      isButton: () => false,
    } as unknown as Interaction;
    await expect(handleInteraction(other, ctx, commands)).resolves.toBeUndefined();
  });
});

describe('registerEvents', () => {
  function wire(options: TestContextOptions = {}) {
    const context = setup(options);
    const client = new FakeClient();
    const onFatalDisconnect = vi.fn();
    registerEvents(client as unknown as Client, context.ctx, {
      commands: context.commands,
      onFatalDisconnect,
    });
    return { ...context, client, onFatalDisconnect };
  }

  test('logs ready, error, warn and shard events; a final disconnect is fatal', () => {
    const { client, logger, onFatalDisconnect } = wire();
    const info = vi.spyOn(logger, 'info');
    const error = vi.spyOn(logger, 'error');
    const warn = vi.spyOn(logger, 'warn');
    const fatal = vi.spyOn(logger, 'fatal');

    client.emit(Events.ClientReady, client);
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ tag: 'Bot#0001' }),
      'Logged in to Discord',
    );

    client.emit(Events.Error, new Error('socket'));
    expect(error).toHaveBeenCalledWith(expect.anything(), 'Discord client error');

    client.emit(Events.Warn, 'careful');
    expect(warn).toHaveBeenCalledWith({ warning: 'careful' }, 'Discord client warning');

    client.emit(Events.ShardReconnecting, 0);
    expect(warn).toHaveBeenCalledWith({ shardId: 0 }, 'Shard reconnecting');

    client.emit(Events.ShardError, new Error('ws'), 0);
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ shardId: 0 }), 'Shard error');

    client.emit(Events.ShardDisconnect, { code: 4014 }, 0);
    expect(fatal).toHaveBeenCalledWith(
      { code: 4014, shardId: 0 },
      'Shard disconnected and will not reconnect',
    );
    expect(onFatalDisconnect).toHaveBeenCalledWith('shard disconnect 4014');
  });

  test('routes interactions and answers legacy text commands', async () => {
    const { client, registry } = wire();
    const channel = makeChannel();
    const { interaction } = makeSlashInteraction({ channel });
    client.emit(Events.InteractionCreate, interaction);
    await vi.waitFor(() => expect(registry.size).toBe(1));

    const { message, raw } = makeDiscordMessage({ content: '!rsd7' });
    client.emit(Events.MessageCreate, message);
    await vi.waitFor(() => expect(raw.reply).toHaveBeenCalledTimes(1));
    expect(raw.reply).toHaveBeenCalledWith(
      `${legacyCommandsNotice()}\n${temporaryMarker(LEGACY_NOTICE_TTL_MS)}`,
    );
    expect(registry.size).toBe(1);
  });

  test('a failure to answer a legacy command is logged and replied to once more, temporarily', async () => {
    const { client, logger } = wire();
    const errorSpy = vi.spyOn(logger, 'error');
    const { message, raw } = makeDiscordMessage({ content: '!rs7' });
    raw.reply.mockRejectedValueOnce(new Error('cannot send'));
    client.emit(Events.MessageCreate, message);
    await vi.waitFor(() => expect(raw.reply).toHaveBeenCalledTimes(2));
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'message' }),
      'Handler failed',
    );
    expect(raw.reply.mock.calls[1]![0]).toContain(GENERIC_USER_MESSAGE);
  });

  test('does not listen to messages when legacy text commands are disabled', () => {
    const { client } = wire({ config: { legacyTextCommands: false } });
    expect(client.listenerCount(Events.MessageCreate)).toBe(0);
    expect(client.listenerCount(Events.InteractionCreate)).toBe(1);
  });
});
