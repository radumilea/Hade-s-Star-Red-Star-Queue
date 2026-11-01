import { PermissionFlagsBits, type PermissionsBitField } from 'discord.js';

/**
 * What the bot needs in a channel to post and maintain a queue message, ping
 * the server, and reply to the retired text commands (a reply needs Read
 * Message History). The card is a component layout, so Embed Links is not
 * required. Threads use SendMessagesInThreads instead of SendMessages.
 */
const BASE_PERMISSIONS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.MentionEveryone,
] as const;

export interface PermissionMember {
  readonly id: string;
}

export interface PermissionSource {
  permissionsFor(member: PermissionMember): Readonly<PermissionsBitField> | null;
  isThread(): boolean;
}

export function requiredQueuePermissions(channel: Pick<PermissionSource, 'isThread'>): bigint[] {
  return [
    ...BASE_PERMISSIONS,
    channel.isThread()
      ? PermissionFlagsBits.SendMessagesInThreads
      : PermissionFlagsBits.SendMessages,
  ];
}

/** Names of the required permissions the bot is missing in this channel. */
export function missingQueuePermissions(
  channel: PermissionSource,
  me: PermissionMember | null | undefined,
): string[] {
  if (!me) return ['(bot member unavailable)'];
  const permissions = channel.permissionsFor(me);
  if (!permissions) return ['(permissions unavailable)'];
  return permissions.missing(requiredQueuePermissions(channel));
}
