import type { Message } from 'discord.js';
import type { AppContext } from '../../app-context.js';
import { sendTemporaryReply } from '../../discord/replies.js';
import { legacyCommandsNotice } from '../help.js';
import { parsePrefixCommand } from './parse.js';

/** How long the public "use the slash commands" notice stays in the channel. */
export const LEGACY_NOTICE_TTL_MS = 5 * 60 * 1000;

export type PrefixMessageHandler = (message: Message) => Promise<void>;

export interface PrefixHandlerOptions {
  readonly now?: () => number;
}

/**
 * The legacy "!" commands no longer do anything: anyone who still uses one gets
 * a public, temporary reply pointing at the slash commands. The notice is
 * posted at most once per channel while a previous one is still visible, so
 * repeating the command cannot flood the channel.
 */
export function createPrefixMessageHandler(
  ctx: AppContext,
  options: PrefixHandlerOptions = {},
): PrefixMessageHandler {
  const prefix = ctx.config.commandPrefix;
  const now = options.now ?? (() => Date.now());
  const lastNoticeAt = new Map<string, number>();

  return async (message) => {
    if (message.author.bot) return;

    const command = parsePrefixCommand(message.content, prefix);
    if (!command) return;

    ctx.logger.info(
      { userId: message.author.id, channelId: message.channelId, kind: command.kind },
      'Legacy text command used',
    );

    const last = lastNoticeAt.get(message.channelId);
    const current = now();
    if (last !== undefined && current - last < LEGACY_NOTICE_TTL_MS) return;

    await sendTemporaryReply(message, legacyCommandsNotice(), {
      ttlMs: LEGACY_NOTICE_TTL_MS,
      deleteSource: false,
      logger: ctx.logger,
    });
    // only a notice that went out counts; a failed one must not silence the channel
    lastNoticeAt.set(message.channelId, current);
  };
}
