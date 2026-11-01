import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  MessageFlags,
  SeparatorBuilder,
  SeparatorSpacingSize,
  TextDisplayBuilder,
  TimestampStyles,
  escapeMarkdown,
  hyperlink,
  time,
  userMention,
  type MessageCreateOptions,
  type MessageEditOptions,
  type MessageMentionOptions,
} from 'discord.js';
import { FOOTER_TEXT } from './branding.js';
import { encodeButtonId, type ButtonAction } from './buttons.js';
import {
  isOpen,
  maxPlayers,
  playerCount,
  playerName,
  slotsLeft,
  type QueueStatus,
  type RedStarQueue,
} from './queue.js';
import { RS_STAR_TYPE } from './types.js';

/**
 * Pure rendering: a queue value in, Discord builders out. Nothing in here
 * talks to the API, so every function is trivially unit-testable.
 *
 * The queue card uses Discord's component layout ("components v2": a container
 * with text blocks and separators) because an embed has a fixed gap under its
 * title and no dividers. A push notification shows nothing for such a message,
 * so a plain-text announcement is posted first and the card follows silently.
 * Everything else is plain text, which a push shows as is (no markdown).
 * Mentions ping only in plain text, and an unpinged mention renders as a raw
 * id on mobile, so mentions appear only where the players should be pinged
 * and players are otherwise shown by display name.
 */

export const EMPTY_SLOT = '-';
/** Appended after the matchmaking owner's name in the slot list. */
export const OWNER_MARK = '*(owner)*';

export const BUTTON_LABELS = {
  join: 'Join',
  leave: 'Leave',
  start: 'Start',
  cancel: 'Cancel Matchmaking',
} as const;

export const COLORS = {
  closed: 0xa4a4a4,
  good: 0x57f287,
  warning: 0xfee75c,
  success: 0x00a800,
  bad: 0xed4245,
} as const;

/** Mentions ping only when listed here; text blocks ping, so every message states its policy. */
const EVERYONE_MENTIONS: MessageMentionOptions = { parse: ['everyone'] };
const NO_MENTIONS: MessageMentionOptions = { parse: [] };
const onlyUsers = (users: readonly string[]): MessageMentionOptions => ({ parse: [], users });

export const QUEUE_GONE_MESSAGE =
  'I lost track of this matchmaking (I was restarted). Start a new one with /rs or /drs.';
export const GONE_TITLE = '[CLOSED] Matchmaking';
/** Plain `/help`: Discord renders it as a clickable command mention only with an id we do not have here. */
const HELP_MENTION = '/help';
/** Label of the link back to the card at the end of joined / left notices. */
export const SCROLL_LINK_LABEL = 'See matchmaking';

export function queueLabel(queue: RedStarQueue): string {
  return `${RS_STAR_TYPE[queue.type].label} ${queue.level}`;
}

/** "[2/4] RS 7 Matchmaking" or "[CLOSED] RS 7 Matchmaking". */
export function queueTitle(queue: RedStarQueue): string {
  const counter = isOpen(queue) ? `[${playerCount(queue)}/${maxPlayers(queue)}]` : '[CLOSED]';
  return `${counter} ${queueLabel(queue)} Matchmaking`;
}

/** "[2/4 RS 7]" prefix used by every notification. */
export function notificationPrefix(queue: RedStarQueue): string {
  return `[${playerCount(queue)}/${maxPlayers(queue)} ${queueLabel(queue)}]`;
}

/**
 * A display name for plain text that reaches push notifications. Escaping
 * would show backslashes there, so the few sequences that could turn a name
 * into a link or a ping get a zero-width space instead: "](", "://", "@".
 */
export function plainName(name: string): string {
  return name.replace(/\]\(/g, ']\u200b(').replace(/:\/\//g, ':\u200b//').replace(/@/g, '@\u200b');
}

/** Mentions of every player, for the notifications that ping them. */
export function playerList(queue: RedStarQueue): string {
  if (queue.players.length === 0) return 'nobody';
  return queue.players.map((id) => userMention(id)).join(', ');
}

/** Name of the player in that slot, with the owner marked; "-" for an empty slot. */
export function slotValue(queue: RedStarQueue, index: number): string {
  const playerId = queue.players[index];
  if (playerId === undefined) return EMPTY_SLOT;
  const name = escapeMarkdown(playerName(queue, playerId), { maskedLink: true });
  return playerId === queue.ownerId ? `${name} ${OWNER_MARK}` : name;
}

/**
 * Discord renders `<t:...>` timestamps in each reader's own timezone:
 * "17:15 (in 59 minutes)" for everyone, wherever they are.
 */
export function expiryText(queue: RedStarQueue): string {
  const expiresAt = new Date(queue.expiresAt);
  return `${time(expiresAt, TimestampStyles.ShortTime)} (${time(expiresAt, TimestampStyles.RelativeTime)})`;
}

/** Small subtext right under the title: "Expires at 7:50 PM (in 49 minutes)". */
export function expiryLine(queue: RedStarQueue): string {
  return `-# *Expires at ${expiryText(queue)}*`;
}

/** How to use the buttons; shown while the queue is open. */
export function instructionsText(): string {
  return (
    `Press **${BUTTON_LABELS.join}** to enter the matchmaking or **${BUTTON_LABELS.leave}** to exit it.\n` +
    `-# The owner can **${BUTTON_LABELS.start}** early with the current squad ` +
    `or **${BUTTON_LABELS.cancel}** to close it.`
  );
}

/** Title as a heading, with the expiry (open) or the closing reason tucked right under it. */
export function headerText(queue: RedStarQueue): string {
  return `## ${queueTitle(queue)}\n${statusLine(queue)}`;
}

/** Why a closed queue closed, shown under its title in place of the expiry. */
export const CLOSE_REASONS: Readonly<Record<Exclude<QueueStatus, 'open'>, string>> = {
  ready: 'Full squad. Ready to run.',
  started: 'The owner started with an incomplete squad.',
  cancelled: 'Cancelled by the owner.',
  expired: 'Expired: the squad did not fill in time.',
  interrupted: 'Closed: the bot restarted.',
};

/** The expiry while open; the closing reason afterwards. Same small italic style. */
export function statusLine(queue: RedStarQueue): string {
  return queue.status === 'open' ? expiryLine(queue) : `-# *${CLOSE_REASONS[queue.status]}*`;
}

/**
 * Numbered list of every slot, one line each: "1. RM Test *(owner)*", "2. -".
 * Empty slots stay visible once closed, so an incomplete squad reads as such.
 */
export function slotsText(queue: RedStarQueue): string {
  return Array.from(
    { length: maxPlayers(queue) },
    (_, index) => `${index + 1}. ${slotValue(queue, index)}`,
  ).join('\n');
}

/** Header, an empty line, a "Squad:" label, then the slot list: one text block so the blank line survives. */
export function bodyText(queue: RedStarQueue): string {
  return `${headerText(queue)}\n\n**Squad:**\n${slotsText(queue)}`;
}

/** Branding line at the bottom of the card. */
export function footerText(): string {
  return `-# ${FOOTER_TEXT}`;
}

function divider(): SeparatorBuilder {
  return new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small);
}

function text(content: string): TextDisplayBuilder {
  return new TextDisplayBuilder().setContent(content);
}

/**
 * The queue card: header and slot list, a divider, then the instructions
 * (open queues only) and the footer.
 */
export function queueContainer(queue: RedStarQueue): ContainerBuilder {
  const container = new ContainerBuilder()
    .setAccentColor(isOpen(queue) ? RS_STAR_TYPE[queue.type].color : COLORS.closed)
    .addTextDisplayComponents(text(bodyText(queue)))
    .addSeparatorComponents(divider());
  if (isOpen(queue)) container.addTextDisplayComponents(text(instructionsText()));
  return container.addTextDisplayComponents(text(footerText()));
}

/** Private confirmation for the matchmaking owner (the ephemeral reply to /rs, never in the card). */
export function ownerInstructions(): string {
  return `Matchmaking posted, you are the owner.\nUse ${HELP_MENTION} if needed.`;
}

function buttonRow(queueId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(encodeButtonId('join', queueId))
      .setLabel(BUTTON_LABELS.join)
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(encodeButtonId('leave', queueId))
      .setLabel(BUTTON_LABELS.leave)
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(encodeButtonId('start', queueId))
      .setLabel(BUTTON_LABELS.start)
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(encodeButtonId('cancel', queueId))
      .setLabel(BUTTON_LABELS.cancel)
      .setStyle(ButtonStyle.Danger),
  );
}

/** Button rows of the queue message: the buttons while open, nothing once closed. */
export function queueComponents(queue: RedStarQueue): ActionRowBuilder<ButtonBuilder>[] {
  return isOpen(queue) ? [buttonRow(queue.id)] : [];
}

/** Options accepted by both `channel.send` and `message.edit` for a component-layout message. */
export type LayoutMessageOptions = Pick<
  MessageCreateOptions & MessageEditOptions,
  'components' | 'allowedMentions' | 'embeds'
> & { readonly flags: MessageFlags.IsComponentsV2 };

/**
 * The queue message as it is edited over its life: the card and, while open,
 * the buttons. It never pings: players are shown by name and the opening is
 * announced by `openedAnnouncement`, whose plain text reaches push notifications.
 */
export function queueMessage(queue: RedStarQueue): LayoutMessageOptions {
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [queueContainer(queue), ...queueComponents(queue)],
    allowedMentions: NO_MENTIONS,
  };
}

/**
 * The queue message as first posted. A component layout has no plain text, so
 * a push for it would be empty: it is sent silently and the announcement
 * before it carries the notification. (Edits never notify, and Discord does not
 * accept the silent flag on an edit, hence the separate function.)
 */
export function queuePost(queue: RedStarQueue): MessageCreateOptions {
  return {
    ...queueMessage(queue),
    flags: MessageFlags.IsComponentsV2 | MessageFlags.SuppressNotifications,
  };
}

/**
 * Replacement for a queue message the bot no longer knows (it restarted).
 * Also valid as an edit of a message posted by an older, embed-based version:
 * switching a message to the component layout only needs its embeds cleared.
 */
export function goneMessage(): LayoutMessageOptions {
  return {
    flags: MessageFlags.IsComponentsV2,
    embeds: [],
    components: [
      new ContainerBuilder()
        .setAccentColor(COLORS.closed)
        .addTextDisplayComponents(text(`## ${GONE_TITLE}\n-# ${QUEUE_GONE_MESSAGE}`)),
    ],
    allowedMentions: NO_MENTIONS,
  };
}

export interface NotificationInput {
  readonly queue: RedStarQueue;
  readonly messageUrl: string;
}

export interface PlayerNotificationInput extends NotificationInput {
  /** Who pressed the button. */
  readonly actorId: string;
  readonly displayName: string;
}

export interface LeftNotificationInput extends PlayerNotificationInput {
  /** Set when the player who left was the owner and someone else inherited the queue. */
  readonly newOwnerId?: string;
}

/**
 * Status marks that stand in for the embed colours of the old bot. Plain text
 * has no colour, and emoji survive both the channel and a push notification.
 */
export const STATUS_MARKS = {
  joined: '🟢',
  left: '🟡',
  ready: '✅',
  closed: '🔴',
} as const;

interface Notification {
  readonly mark: string;
  readonly title: string;
  /** Second line, e.g. the squad or the new owner; mentions only where someone should be pinged. */
  readonly body?: string | undefined;
  readonly allowedMentions: MessageMentionOptions;
  /** Url of the queue message; rendered as a "See matchmaking" link on the last line. */
  readonly link?: string | undefined;
}

/**
 * Notifications are plain text: a mobile push shows exactly the text, renders
 * no markdown, and shows nothing of a component layout. So: no markdown in the
 * lines a push shows first, and display names are not escaped (a backslash
 * would show in the push). The only markdown is the "See matchmaking"
 * link on the last line. Mentions appear only where the players concerned
 * should be pinged.
 */
function notification(input: Notification): MessageCreateOptions {
  const lines = [`${input.mark} ${input.title}`];
  if (input.body !== undefined) lines.push(input.body);
  if (input.link !== undefined) lines.push(hyperlink(SCROLL_LINK_LABEL, input.link));
  return { content: lines.join('\n'), allowedMentions: input.allowedMentions };
}

/** Someone joined: nobody pinged; links back to the card. */
export function joinedNotification(input: PlayerNotificationInput): MessageCreateOptions {
  const { queue } = input;
  return notification({
    mark: STATUS_MARKS.joined,
    title: `${notificationPrefix(queue)} ${plainName(input.displayName)} joined the squad.`,
    allowedMentions: NO_MENTIONS,
    link: input.messageUrl,
  });
}

/** Someone left: a new owner is mentioned and pinged; links back to the card. */
export function leftNotification(input: LeftNotificationInput): MessageCreateOptions {
  const { queue } = input;
  return notification({
    mark: STATUS_MARKS.left,
    title: `${notificationPrefix(queue)} ${plainName(input.displayName)} left the squad.`,
    body:
      input.newOwnerId === undefined
        ? undefined
        : `Ownership passed to ${userMention(input.newOwnerId)}.`,
    allowedMentions: input.newOwnerId === undefined ? NO_MENTIONS : onlyUsers([input.newOwnerId]),
    link: input.messageUrl,
  });
}

/** The squad is complete or started early: every player is pinged. */
export function readyNotification(input: NotificationInput): MessageCreateOptions {
  const { queue } = input;
  return notification({
    mark: STATUS_MARKS.ready,
    title: `${notificationPrefix(queue)} Matchmaking ready! Let's play!`,
    body: `Squad: ${playerList(queue)}`,
    allowedMentions: onlyUsers(queue.players),
  });
}

/** Closed by its owner: the other players are told; the closer already knows. */
export function cancelledNotification(input: PlayerNotificationInput): MessageCreateOptions {
  const { queue } = input;
  const others = queue.players.filter((id) => id !== input.actorId);
  return notification({
    mark: STATUS_MARKS.closed,
    title: `${notificationPrefix(queue)} Matchmaking cancelled by ${plainName(input.displayName)}.`,
    body:
      others.length === 0
        ? undefined
        : `Heads up, ${others.map((id) => userMention(id)).join(', ')}`,
    allowedMentions: onlyUsers(others),
  });
}

/** Timed out: every player is told. */
export function expiredNotification(input: NotificationInput): MessageCreateOptions {
  const { queue } = input;
  return notification({
    mark: STATUS_MARKS.closed,
    title: `${notificationPrefix(queue)} Matchmaking expired. Try again with /rs or /drs.`,
    body: `FYI: ${playerList(queue)}`,
    allowedMentions: onlyUsers(queue.players),
  });
}

/** The bot shut down with the queue open: every player is told to come back shortly. */
export function interruptedNotification(input: NotificationInput): MessageCreateOptions {
  const { queue } = input;
  return notification({
    mark: STATUS_MARKS.closed,
    title: `${notificationPrefix(queue)} Matchmaking closed, the bot restarted. Open a new one in a few minutes.`,
    body: `FYI: ${playerList(queue)}`,
    allowedMentions: onlyUsers(queue.players),
  });
}

/**
 * Posted right before the queue card. The card itself cannot carry plain text,
 * and a push notification only shows plain text or an embed, so this is what
 * reaches phones when a queue opens. Prose without markdown: a push shows it raw.
 */
export function openedAnnouncement(queue: RedStarQueue): MessageCreateOptions {
  const creator = plainName(playerName(queue, queue.creatorId));
  return {
    content:
      `@everyone ${creator} wants to play ${queueLabel(queue)}! ` +
      `Press ${BUTTON_LABELS.join} to team up.`,
    allowedMentions: EVERYONE_MENTIONS,
  };
}

/**
 * Public "last chance" reminder posted `leadMs` before an open queue expires.
 * Plain prose for the push body, then the "See matchmaking" link back to the card.
 */
export function reminderMessage(
  queue: RedStarQueue,
  messageUrl: string,
  leadMs: number,
): MessageCreateOptions {
  const minutes = Math.max(1, Math.round(leadMs / 60_000));
  const left = `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
  const call =
    slotsLeft(queue) === 1
      ? `@everyone One slot left in ${queueLabel(queue)}! It closes in ${left}.`
      : `@everyone ${queueLabel(queue)} closes in ${left}. Anyone?`;
  return {
    content: `${call}\n${hyperlink(SCROLL_LINK_LABEL, messageUrl)}`,
    allowedMentions: EVERYONE_MENTIONS,
  };
}

/** One applied button action: the queue before and after, who did it. */
export interface QueueTransition {
  readonly before: RedStarQueue;
  readonly after: RedStarQueue;
  readonly action: ButtonAction;
  readonly actorId: string;
  readonly displayName: string;
  readonly messageUrl: string;
}

/** The public notification for a transition. */
export function transitionNotification(transition: QueueTransition): MessageCreateOptions {
  const { before, after, action, actorId, displayName, messageUrl } = transition;
  const player = { queue: after, messageUrl, actorId, displayName };
  switch (after.status) {
    case 'open': {
      if (action === 'leave') {
        const ownerChanged = after.ownerId !== before.ownerId;
        return leftNotification(ownerChanged ? { ...player, newOwnerId: after.ownerId } : player);
      }
      return joinedNotification(player);
    }
    case 'ready':
    case 'started':
      return readyNotification(player);
    case 'cancelled':
      return cancelledNotification(player);
    case 'expired':
      return expiredNotification(player);
    case 'interrupted':
      return interruptedNotification(player);
  }
}
