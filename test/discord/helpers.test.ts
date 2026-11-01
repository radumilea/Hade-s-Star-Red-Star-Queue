import { GatewayIntentBits, MessageFlags, PermissionsBitField } from 'discord.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ApiErrorCode, isDiscordApiError } from '../../src/discord/api-errors.js';
import { createClient, intentsFor } from '../../src/discord/client.js';
import { runSafely } from '../../src/discord/error-boundary.js';
import {
  missingQueuePermissions,
  requiredQueuePermissions,
} from '../../src/discord/permissions.js';
import { replyEphemeral, sendTemporaryReply, temporaryMarker } from '../../src/discord/replies.js';
import { GENERIC_USER_MESSAGE, UserFacingError } from '../../src/errors.js';
import { apiError, silentLogger } from '../fakes.js';

describe('isDiscordApiError', () => {
  const error = apiError(ApiErrorCode.UnknownMessage);

  test('matches by code', () => {
    expect(isDiscordApiError(error, ApiErrorCode.UnknownMessage)).toBe(true);
    expect(isDiscordApiError(error, ApiErrorCode.UnknownInteraction)).toBe(false);
    expect(
      isDiscordApiError(error, ApiErrorCode.UnknownInteraction, ApiErrorCode.UnknownMessage),
    ).toBe(true);
  });

  test('matches any API error when no code is given', () => {
    expect(isDiscordApiError(error)).toBe(true);
    expect(isDiscordApiError(new Error('x'))).toBe(false);
    expect(isDiscordApiError('string', 10008)).toBe(false);
  });
});

describe('createClient / intentsFor', () => {
  test('requests only Guilds unless legacy text commands are on', () => {
    expect(intentsFor({ legacyTextCommands: false })).toEqual([GatewayIntentBits.Guilds]);
    expect(intentsFor({ legacyTextCommands: true })).toEqual([
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
    ]);
  });

  test('keeps mentions safe by default', async () => {
    const client = createClient({ legacyTextCommands: false });
    expect(client.options.intents.has('Guilds')).toBe(true);
    expect(client.options.intents.has('MessageContent')).toBe(false);
    expect(client.options.allowedMentions).toEqual({ parse: ['users'] });
    await client.destroy();
  });
});

describe('runSafely', () => {
  test('runs the handler and does nothing else on success', async () => {
    const logger = silentLogger();
    const notify = vi.fn(async () => undefined);
    const handler = vi.fn(async () => undefined);
    await runSafely(logger, { kind: 'command', name: 'x' }, handler, notify);
    expect(handler).toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  test('relays user-facing errors at info level', async () => {
    const logger = silentLogger();
    const info = vi.spyOn(logger, 'info');
    const error = vi.spyOn(logger, 'error');
    const notify = vi.fn(async () => undefined);
    await runSafely(
      logger,
      { kind: 'command', name: 'x' },
      async () => {
        throw new UserFacingError('nope');
      },
      notify,
    );
    expect(notify).toHaveBeenCalledWith('nope');
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'nope' }),
      'Handled user-facing error',
    );
    expect(error).not.toHaveBeenCalled();
  });

  test('logs unexpected errors and sends the generic message', async () => {
    const logger = silentLogger();
    const error = vi.spyOn(logger, 'error');
    const notify = vi.fn(async () => undefined);
    await runSafely(
      logger,
      { kind: 'message', name: 'z' },
      async () => {
        throw new TypeError('bad');
      },
      notify,
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'message',
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        err: expect.objectContaining({ name: 'TypeError' }),
      }),
      'Handler failed',
    );
    expect(notify).toHaveBeenCalledWith(GENERIC_USER_MESSAGE);
  });

  test('never throws, even when notifying fails or nothing can notify', async () => {
    const logger = silentLogger();
    const warn = vi.spyOn(logger, 'warn');
    await expect(
      runSafely(logger, { kind: 'command', name: 'x' }, async () => {
        throw new Error('a');
      }),
    ).resolves.toBeUndefined();
    await expect(
      runSafely(
        logger,
        { kind: 'command', name: 'x' },
        async () => {
          throw new Error('a');
        },
        async () => {
          throw new Error('cannot reply');
        },
      ),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('temporaryMarker', () => {
  test('is Discord subtext naming the lifetime', () => {
    expect(temporaryMarker(60_000)).toBe('-# Temporary message, it disappears in 60 seconds.');
    expect(temporaryMarker(5 * 60_000)).toBe('-# Temporary message, it disappears in 5 minutes.');
    expect(temporaryMarker(120_000)).toBe('-# Temporary message, it disappears in 2 minutes.');
  });
});

describe('replyEphemeral', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeInteraction(state: { deferred?: boolean; replied?: boolean } = {}) {
    return {
      deferred: state.deferred ?? false,
      replied: state.replied ?? false,
      reply: vi.fn(async (_options: unknown) => undefined),
      editReply: vi.fn(async (_options: unknown) => undefined),
      followUp: vi.fn(async (_options: unknown) => ({ id: 'follow-up-1' })),
      deleteReply: vi.fn(async (_id?: string) => undefined),
    };
  }

  test('replies when fresh, edits when deferred, follows up when replied', async () => {
    const fresh = makeInteraction();
    await replyEphemeral(fresh, 'hi');
    expect(fresh.reply).toHaveBeenCalledWith({
      content: 'hi',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });

    const deferred = makeInteraction({ deferred: true });
    await replyEphemeral(deferred, 'hi');
    expect(deferred.editReply).toHaveBeenCalledWith({
      content: 'hi',
      allowedMentions: { parse: [] },
    });
    expect(deferred.reply).not.toHaveBeenCalled();

    const replied = makeInteraction({ deferred: true, replied: true });
    await replyEphemeral(replied, 'hi');
    expect(replied.followUp).toHaveBeenCalledWith({
      content: 'hi',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    expect(replied.editReply).not.toHaveBeenCalled();
  });

  test('follows up, never edits, after a deferUpdate (that would overwrite the queue message)', async () => {
    const updated = makeInteraction({ deferred: true });
    await replyEphemeral(updated, 'hi', { afterUpdate: true });
    expect(updated.followUp).toHaveBeenCalledWith({
      content: 'hi',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    expect(updated.editReply).not.toHaveBeenCalled();

    // not yet acknowledged at all: a plain reply is still right
    const fresh = makeInteraction();
    await replyEphemeral(fresh, 'hi', { afterUpdate: true });
    expect(fresh.reply).toHaveBeenCalledWith({
      content: 'hi',
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
  });

  test('is permanent without a ttl', async () => {
    const interaction = makeInteraction();
    await replyEphemeral(interaction, 'keep me');
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(interaction.deleteReply).not.toHaveBeenCalled();
  });

  test('deletes the original reply after the ttl and says so in the message', async () => {
    const interaction = makeInteraction();
    await replyEphemeral(interaction, 'bye', { ttlMs: 1_000 });
    expect(interaction.reply).toHaveBeenCalledWith({
      content: `bye\n${temporaryMarker(1_000)}`,
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(interaction.deleteReply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(interaction.deleteReply).toHaveBeenCalledWith(undefined);
  });

  test('deletes the follow-up by id after the ttl and ignores deletion failures', async () => {
    const interaction = makeInteraction({ replied: true });
    interaction.deleteReply.mockRejectedValue(new Error('already gone'));
    await replyEphemeral(interaction, 'bye', { ttlMs: 1_000 });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(interaction.deleteReply).toHaveBeenCalledWith('follow-up-1');
  });

  test('accepts a custom scheduler', async () => {
    const interaction = makeInteraction();
    const schedule = vi.fn((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    });
    await replyEphemeral(interaction, 'bye', { ttlMs: 5, setTimeoutFn: schedule });
    expect(schedule).toHaveBeenCalled();
    expect(interaction.deleteReply).toHaveBeenCalled();
  });
});

describe('sendTemporaryReply', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('marks the reply as temporary and deletes it after the ttl, optionally with the source', async () => {
    const logger = silentLogger();
    const replyDelete = vi.fn(async () => undefined);
    const target = {
      reply: vi.fn(async () => ({ delete: replyDelete })),
      delete: vi.fn(async () => undefined),
    };

    await sendTemporaryReply(target, 'tip', { ttlMs: 1_000, deleteSource: true, logger });
    expect(target.reply).toHaveBeenCalledWith(`tip\n${temporaryMarker(1_000)}`);
    expect(replyDelete).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(replyDelete).toHaveBeenCalledTimes(1);
    expect(target.delete).toHaveBeenCalledTimes(1);
  });

  test('leaves the source alone when not asked and swallows delete failures', async () => {
    const logger = silentLogger();
    const debug = vi.spyOn(logger, 'debug');
    const target = {
      reply: vi.fn(async () => ({
        delete: vi.fn(async () => {
          throw new Error('gone');
        }),
      })),
      delete: vi.fn(async () => {
        throw new Error('gone too');
      }),
    };
    await sendTemporaryReply(target, 'tip', { ttlMs: 10, deleteSource: false, logger });
    await vi.advanceTimersByTimeAsync(10);
    expect(target.delete).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith(expect.anything(), 'Could not delete temporary reply');

    await sendTemporaryReply(target, 'tip', { ttlMs: 10, deleteSource: true, logger });
    await vi.advanceTimersByTimeAsync(10);
    expect(target.delete).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith(expect.anything(), 'Could not delete user message');
  });

  test('accepts a custom scheduler', async () => {
    const logger = silentLogger();
    const schedule = vi.fn((cb: () => void) => {
      cb();
      return 0 as unknown as NodeJS.Timeout;
    });
    const replyDelete = vi.fn(async () => undefined);
    const target = {
      reply: vi.fn(async () => ({ delete: replyDelete })),
      delete: vi.fn(async () => undefined),
    };
    await sendTemporaryReply(target, 'tip', {
      ttlMs: 5,
      deleteSource: false,
      logger,
      setTimeoutFn: schedule,
    });
    expect(schedule).toHaveBeenCalled();
    expect(replyDelete).toHaveBeenCalled();
  });
});

describe('permissions', () => {
  const all = new PermissionsBitField([
    PermissionsBitField.Flags.ViewChannel,
    PermissionsBitField.Flags.SendMessages,
    PermissionsBitField.Flags.SendMessagesInThreads,
    PermissionsBitField.Flags.ReadMessageHistory,
    PermissionsBitField.Flags.MentionEveryone,
  ]);
  const channel = (thread: boolean, permissions: PermissionsBitField | null = all) => ({
    permissionsFor: () => permissions,
    isThread: () => thread,
  });

  test('requires SendMessages in channels and SendMessagesInThreads in threads', () => {
    expect(requiredQueuePermissions(channel(false))).toContain(
      PermissionsBitField.Flags.SendMessages,
    );
    expect(requiredQueuePermissions(channel(false))).not.toContain(
      PermissionsBitField.Flags.SendMessagesInThreads,
    );
    expect(requiredQueuePermissions(channel(true))).toContain(
      PermissionsBitField.Flags.SendMessagesInThreads,
    );
    expect(requiredQueuePermissions(channel(true))).not.toContain(
      PermissionsBitField.Flags.SendMessages,
    );
  });

  test('empty when everything is granted', () => {
    expect(missingQueuePermissions(channel(false), { id: 'bot' })).toEqual([]);
    expect(missingQueuePermissions(channel(true), { id: 'bot' })).toEqual([]);
  });

  test('lists what is missing, MentionEveryone included; EmbedLinks is not needed', () => {
    expect(requiredQueuePermissions(channel(false))).not.toContain(
      PermissionsBitField.Flags.EmbedLinks,
    );
    const some = new PermissionsBitField(PermissionsBitField.Flags.ViewChannel);
    expect(missingQueuePermissions(channel(false, some), { id: 'bot' })).toEqual([
      'SendMessages',
      'ReadMessageHistory',
      'MentionEveryone',
    ]);
  });

  test('explains when the member or permissions are unavailable', () => {
    expect(missingQueuePermissions(channel(false), null)).toEqual(['(bot member unavailable)']);
    expect(missingQueuePermissions(channel(false, null), { id: 'bot' })).toEqual([
      '(permissions unavailable)',
    ]);
  });
});
