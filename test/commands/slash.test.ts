import { GuildMember, MessageFlags, PermissionsBitField } from 'discord.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { HELP_COMMAND_NAME, createHelpCommand, helpText } from '../../src/commands/help.js';
import {
  LEVEL_OPTION,
  createRedStarCommand,
  joinedExistingReply,
} from '../../src/commands/red-star-command.js';
import { commandsByName, createCommands } from '../../src/commands/registry.js';
import { CHANNEL_NOT_SUPPORTED_MESSAGE, startQueue } from '../../src/commands/start-queue.js';
import { TEMPORARY_REPLY_TTL_MS, temporaryMarker } from '../../src/discord/replies.js';
import { UserFacingError } from '../../src/errors.js';
import { RS_STAR_TYPE } from '../../src/red-star/types.js';
import {
  queueView,
  makeChannel,
  makeContext,
  makeSlashInteraction,
  type SlashInteractionOptions,
} from '../fakes.js';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('/rs and /drs definitions', () => {
  test('are guild-only with a required integer level bounded per type', () => {
    const json = createRedStarCommand('dark').toJSON();
    expect(json.name).toBe('drs');
    expect(json.contexts).toEqual([0]);
    expect(json.options).toHaveLength(1);
    expect(json.options?.[0]).toMatchObject({
      name: LEVEL_OPTION,
      required: true,
      min_value: RS_STAR_TYPE.dark.minLevel,
      max_value: RS_STAR_TYPE.dark.maxLevel,
    });
    expect(createRedStarCommand('classic').toJSON().options?.[0]).toMatchObject({
      min_value: RS_STAR_TYPE.classic.minLevel,
      max_value: RS_STAR_TYPE.classic.maxLevel,
    });
  });

  test('registry exposes rs, drs and help with unique names', () => {
    const commands = createCommands();
    const byName = commandsByName(commands);
    expect([...byName.keys()]).toEqual(['rs', 'drs', HELP_COMMAND_NAME]);
    expect(() => commandsByName([...commands, ...commands])).toThrow('Duplicate');
    for (const command of commands) {
      expect(command.toJSON().name).toBe(command.name);
    }
  });
});

describe('/rs execute', () => {
  test('defers first, creates the queue, then edits the deferred reply into the permanent briefing', async () => {
    const { ctx, registry } = makeContext();
    const { interaction, raw, channel } = makeSlashInteraction({ level: 9 });
    await createRedStarCommand('classic').execute(interaction, ctx);

    expect(raw.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(raw.deferReply.mock.invocationCallOrder[0]).toBeLessThan(
      channel!.send.mock.invocationCallOrder[0]!,
    );
    expect(registry.size).toBe(1);
    expect(queueView(channel!.sent[1]!).title).toBe('[1/4] RS 9 Matchmaking');

    expect(raw.reply).not.toHaveBeenCalled();
    expect(raw.editReply).toHaveBeenCalledTimes(1);
    const reply = raw.editReply.mock.calls[0]![0] as { content: string };
    expect(reply.content).toContain('Matchmaking posted, you are the owner.');
    expect(reply.content).toContain('/help');

    await vi.advanceTimersByTimeAsync(TEMPORARY_REPLY_TTL_MS * 10);
    expect(raw.deleteReply).not.toHaveBeenCalled();
  });

  test('joins an existing queue for the same level and says so with a temporary reply', async () => {
    const { ctx, registry } = makeContext();
    const channel = makeChannel('chan-1');
    await ctx.redStar.openQueue({
      ownerId: 'someone-else',
      displayName: 'Else',
      level: 7,
      type: 'classic',
      channel,
    });

    const { interaction, raw } = makeSlashInteraction({ level: 7, channel });
    await createRedStarCommand('classic').execute(interaction, ctx);

    expect(registry.size).toBe(1);
    expect(registry.get('q1')?.queue.players).toEqual(['someone-else', 'owner']);
    expect(channel.sent[2]!.content).toContain('[2/4 RS 7] Owner joined the squad.');
    expect(raw.editReply).toHaveBeenCalledWith({
      content: `${joinedExistingReply(channel.messages[1]!.url)}\n${temporaryMarker(TEMPORARY_REPLY_TTL_MS)}`,
      allowedMentions: { parse: [] },
    });
    await vi.advanceTimersByTimeAsync(TEMPORARY_REPLY_TTL_MS);
    expect(raw.deleteReply).toHaveBeenCalledWith(undefined);
  });

  test('uses the server nickname when the member is cached', async () => {
    const { ctx } = makeContext();
    const channel = makeChannel('chan-1');
    await ctx.redStar.openQueue({
      ownerId: 'x',
      displayName: 'X',
      level: 7,
      type: 'classic',
      channel,
    });
    const member = Object.create(GuildMember.prototype) as GuildMember;
    Object.defineProperty(member, 'displayName', { value: 'Nick' });
    const { interaction } = makeSlashInteraction({ level: 7, channel, member });
    await createRedStarCommand('classic').execute(interaction, ctx);
    expect(channel.sent[2]!.content).toContain('Nick joined');
  });

  test('fetches the bot member when it is not cached', async () => {
    const { ctx, registry } = makeContext();
    const { interaction, raw } = makeSlashInteraction({ me: null });
    await createRedStarCommand('classic').execute(interaction, ctx);
    expect(raw.guild.members.fetchMe).toHaveBeenCalled();
    expect(registry.size).toBe(1);
  });

  test.each<[string, SlashInteractionOptions]>([
    ['outside a guild', { inGuild: false }],
    ['without a channel', { channel: null }],
  ])('refuses %s', async (_label, options) => {
    const { ctx } = makeContext();
    const { interaction } = makeSlashInteraction(options);
    await expect(createRedStarCommand('dark').execute(interaction, ctx)).rejects.toThrow(
      CHANNEL_NOT_SUPPORTED_MESSAGE,
    );
  });

  test('refuses a channel the bot cannot send to', async () => {
    const { ctx } = makeContext();
    const channel = makeChannel();
    channel.sendable = false;
    const { interaction } = makeSlashInteraction({ channel });
    await expect(createRedStarCommand('dark').execute(interaction, ctx)).rejects.toThrow(
      CHANNEL_NOT_SUPPORTED_MESSAGE,
    );
  });
});

describe('startQueue use-case', () => {
  const base = {
    level: 7,
    type: 'classic' as const,
    ownerId: 'a',
    displayName: 'A',
    me: { id: 'bot' },
  };

  test('rejects an invalid level before touching Discord', async () => {
    const { ctx } = makeContext();
    const channel = makeChannel();
    await expect(startQueue(ctx, { ...base, level: 99, channel })).rejects.toThrow(UserFacingError);
    await expect(startQueue(ctx, { ...base, level: 3, type: 'dark', channel })).rejects.toThrow(
      'between 7-12',
    );
    expect(channel.sent).toHaveLength(0);
  });

  test('reports missing permissions by name, including MentionEveryone', async () => {
    const { ctx } = makeContext();
    const channel = makeChannel();
    channel.permissions = new PermissionsBitField(PermissionsBitField.Flags.ViewChannel);
    await expect(startQueue(ctx, { ...base, channel })).rejects.toThrow(
      'SendMessages, ReadMessageHistory, MentionEveryone',
    );
  });

  test('checks SendMessagesInThreads in a thread', async () => {
    const { ctx } = makeContext();
    const channel = makeChannel();
    channel.thread = true;
    channel.permissions = new PermissionsBitField([
      PermissionsBitField.Flags.ViewChannel,
      PermissionsBitField.Flags.EmbedLinks,
      PermissionsBitField.Flags.MentionEveryone,
      PermissionsBitField.Flags.SendMessages,
    ]);
    await expect(startQueue(ctx, { ...base, channel })).rejects.toThrow('SendMessagesInThreads');
  });

  test('reports when the bot member or its permissions are unavailable', async () => {
    const { ctx } = makeContext();
    const channel = makeChannel();
    await expect(startQueue(ctx, { ...base, channel, me: null })).rejects.toThrow(
      'bot member unavailable',
    );
    channel.permissions = null;
    await expect(startQueue(ctx, { ...base, channel })).rejects.toThrow('permissions unavailable');
  });
});

describe('/help', () => {
  test('is described as the Red Star Matchmaking help', () => {
    expect(createHelpCommand().toJSON().description).toBe(
      'How to use the Red Star Matchmaking bot',
    );
  });

  test('replies privately with the help text', async () => {
    const { ctx } = makeContext();
    const { interaction, raw } = makeSlashInteraction();
    await createHelpCommand().execute(interaction, ctx);
    expect(raw.reply).toHaveBeenCalledWith({
      content: helpText(ctx.config),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  test('help text covers the commands, the buttons and the configured timings', () => {
    const text = helpText({ queueTimeoutMs: 60 * 60_000, queueReminderMs: 10 * 60_000 });
    expect(text).toContain('/rs level:<3-12>');
    expect(text).toContain('/drs level:<7-12>');
    expect(text).toContain('**Join**');
    expect(text).toContain('**Leave**');
    expect(text).toContain('**Start**');
    expect(text).toContain('**Cancel Matchmaking**');
    expect(text).toContain('the next player takes over');
    expect(text).toContain(
      'A matchmaking expires after 60 minutes; the channel is reminded 10 minutes before.',
    );
    expect(text).toContain('private replies disappear after 60 seconds.');
    expect(text).toContain('one press every 3 seconds per player.');
    expect(text.startsWith('**Red Star Matchmaking**')).toBe(true);
    expect(text).not.toContain('/help');
    expect(text.toLowerCase()).not.toContain('queue');
  });

  test('help text skips the reminder when it is disabled', () => {
    const text = helpText({ queueTimeoutMs: 45 * 60_000, queueReminderMs: 0 });
    expect(text).toContain('A matchmaking expires after 45 minutes.');
    expect(text).not.toContain('reminded');
  });
});
