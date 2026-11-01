import type {
  ButtonInteraction,
  ChatInputCommandInteraction,
  Message,
  TextChannel,
  ThreadChannel,
} from 'discord.js';
import { describe, expectTypeOf, test } from 'vitest';
import type { PermissionSource } from '../src/discord/permissions.js';
import type { EphemeralReplier, TemporaryReplyTarget } from '../src/discord/replies.js';
import type { ButtonPort, QueueChannel, QueueMessage } from '../src/red-star/ports.js';

/**
 * The app talks to discord.js through small structural ports. These checks
 * fail at `npm run typecheck` if a discord.js upgrade stops satisfying them.
 */
describe('discord.js objects satisfy the ports', () => {
  test('channels', () => {
    expectTypeOf<TextChannel>().toMatchTypeOf<QueueChannel & PermissionSource>();
    expectTypeOf<ThreadChannel>().toMatchTypeOf<QueueChannel & PermissionSource>();
  });

  test('messages', () => {
    expectTypeOf<Message>().toMatchTypeOf<QueueMessage>();
    expectTypeOf<Message>().toMatchTypeOf<TemporaryReplyTarget>();
  });

  test('interactions', () => {
    expectTypeOf<ButtonInteraction>().toMatchTypeOf<ButtonPort & EphemeralReplier>();
    expectTypeOf<ChatInputCommandInteraction>().toMatchTypeOf<EphemeralReplier>();
  });
});
