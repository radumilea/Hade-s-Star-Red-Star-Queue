import { MessageFlags, type InteractionReplyOptions, type MessageMentionOptions } from 'discord.js';
import { errorToLog } from '../errors.js';
import type { Logger } from '../logger.js';
import { defaultScheduler, type Scheduler } from '../scheduler.js';

/** How long a throwaway private message (validation errors, confirmations) stays visible. */
export const TEMPORARY_REPLY_TTL_MS = 60_000;
/** How long a public tip (error on a text command, legacy notice) stays visible. */
export const PUBLIC_TIP_TTL_MS = 3 * 60_000;

/** Private replies name people (the owner) but must never ping them. */
export const NO_PINGS: MessageMentionOptions = { parse: [] };

/** A deletion timer must never keep the process alive. */
function unref(timer: unknown): void {
  if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
    (timer as { unref(): void }).unref();
  }
}

/** Footer line (Discord "subtext" markdown) telling the reader the message will vanish. */
export function temporaryMarker(ttlMs: number): string {
  const seconds = Math.round(ttlMs / 1000);
  const minutes = Math.round(seconds / 60);
  const duration =
    seconds < 120 ? `${seconds} seconds` : `${minutes} minute${minutes === 1 ? '' : 's'}`;
  return `-# Temporary message, it disappears in ${duration}.`;
}

function withMarker(content: string, ttlMs: number): string {
  return `${content}\n${temporaryMarker(ttlMs)}`;
}

/** The subset of a repliable interaction that the helpers below need. */
export interface EphemeralReplier {
  readonly deferred: boolean;
  readonly replied: boolean;
  reply(options: InteractionReplyOptions): Promise<unknown>;
  editReply(options: {
    content: string;
    allowedMentions?: MessageMentionOptions;
  }): Promise<unknown>;
  followUp(options: InteractionReplyOptions): Promise<{ readonly id: string }>;
  /** Deletes the original reply, or the follow-up with the given id. */
  deleteReply(messageId?: string): Promise<unknown>;
}

export interface EphemeralOptions {
  /** Delete the message after this long; omit for a permanent message. */
  readonly ttlMs?: number;
  /**
   * The interaction was acknowledged with `deferUpdate` (a button press).
   * Discord then treats the component's own message as the "original
   * reply", so an `editReply` would overwrite the public queue message;
   * the private note must go out as a follow-up instead.
   */
  readonly afterUpdate?: boolean;
  readonly setTimeoutFn?: Scheduler;
}

/**
 * Sends a private message to the user whatever the interaction's state:
 * a fresh reply, the edit of a deferred reply, or a follow-up once replied
 * (or deferred through `deferUpdate`, see `afterUpdate`).
 * With `ttlMs` the message says so and is removed afterwards (best effort:
 * the user may have dismissed it already).
 */
export async function replyEphemeral(
  interaction: EphemeralReplier,
  content: string,
  options: EphemeralOptions = {},
): Promise<void> {
  const text = options.ttlMs === undefined ? content : withMarker(content, options.ttlMs);
  let messageId: string | undefined;
  const mustFollowUp =
    interaction.replied || (interaction.deferred && options.afterUpdate === true);
  const payload: InteractionReplyOptions = {
    content: text,
    flags: MessageFlags.Ephemeral,
    allowedMentions: NO_PINGS,
  };
  if (mustFollowUp) {
    messageId = (await interaction.followUp(payload)).id;
  } else if (interaction.deferred) {
    await interaction.editReply({ content: text, allowedMentions: NO_PINGS });
  } else {
    await interaction.reply(payload);
  }

  if (options.ttlMs === undefined) return;
  const schedule = options.setTimeoutFn ?? defaultScheduler;
  unref(
    schedule(() => {
      void interaction.deleteReply(messageId).catch(() => undefined);
    }, options.ttlMs),
  );
}

export interface TemporaryReplyTarget {
  reply(content: string): Promise<{ delete(): Promise<unknown> }>;
  delete(): Promise<unknown>;
}

export interface TemporaryReplyOptions {
  readonly ttlMs: number;
  /** Also delete the user's own message when the reply expires. */
  readonly deleteSource: boolean;
  readonly logger: Logger;
  readonly setTimeoutFn?: Scheduler;
}

/**
 * Replies publicly to a message, says the reply is temporary, and removes it
 * (and optionally the user's message) after a delay. Deletions are best-effort:
 * a message that is already gone must not surface as an error.
 */
export async function sendTemporaryReply(
  target: TemporaryReplyTarget,
  content: string,
  options: TemporaryReplyOptions,
): Promise<void> {
  const reply = await target.reply(withMarker(content, options.ttlMs));
  const schedule = options.setTimeoutFn ?? defaultScheduler;
  unref(
    schedule(() => {
      void reply.delete().catch((error: unknown) => {
        options.logger.debug({ err: errorToLog(error) }, 'Could not delete temporary reply');
      });
      if (options.deleteSource) {
        void target.delete().catch((error: unknown) => {
          options.logger.debug({ err: errorToLog(error) }, 'Could not delete user message');
        });
      }
    }, options.ttlMs),
  );
}
