import { EventEmitter } from 'node:events';
import {
  ComponentType,
  DiscordAPIError,
  PermissionFlagsBits,
  PermissionsBitField,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIComponentInMessageActionRow,
  type APIContainerComponent,
  type APIMessageTopLevelComponent,
  type ChatInputCommandInteraction,
  type Interaction,
  type Message,
  type MessageCreateOptions,
  type MessageEditOptions,
} from 'discord.js';
import { vi } from 'vitest';
import type { AppContext } from '../src/app-context.js';
import type { RuntimeConfig } from '../src/config.js';
import { createSilentLogger, type Logger } from '../src/logger.js';
import type { QueueChannel, QueueMessage } from '../src/red-star/ports.js';
import { QueueRegistry } from '../src/red-star/queue-registry.js';
import { RedStarService, type RedStarServiceDeps } from '../src/red-star/service.js';

export const TEST_CONFIG: RuntimeConfig = {
  clientId: 'client-1',
  guildId: undefined,
  commandPrefix: '!',
  logLevel: 'silent',
  queueTimeoutMs: 60 * 60 * 1000,
  queueReminderMs: 10 * 60 * 1000,
  legacyTextCommands: true,
  devShutdownPort: undefined,
  isProduction: false,
};

export const silentLogger = createSilentLogger;

/** A DiscordAPIError with the given JSON error code, as discord.js would throw it. */
export function apiError(code: number): DiscordAPIError {
  return new DiscordAPIError(
    { code, message: `error ${code}` },
    code,
    404,
    'PATCH',
    'https://x',
    {},
  );
}

// ---------------------------------------------------------------------------
// Queue message / channel fakes (satisfy the red-star ports)
// ---------------------------------------------------------------------------

export interface FakeMessage extends QueueMessage {
  readonly edits: MessageEditOptions[];
  readonly edit: ReturnType<typeof vi.fn<(options: MessageEditOptions) => Promise<unknown>>>;
  readonly delete: ReturnType<typeof vi.fn<() => Promise<unknown>>>;
}

/** Fake messages are "old": created before any service under test booted (epoch 0). */
export function makeMessage(id = 'msg-1', channelId = 'chan-1', createdTimestamp = 0): FakeMessage {
  const edits: MessageEditOptions[] = [];
  const edit = vi.fn<(options: MessageEditOptions) => Promise<unknown>>(async (options) => {
    edits.push(options);
    return undefined;
  });
  return {
    id,
    url: `https://discord.com/channels/guild-1/${channelId}/${id}`,
    createdTimestamp,
    edits,
    edit,
    delete: vi.fn(async () => undefined),
  };
}

export interface FakeChannel extends QueueChannel {
  readonly sent: MessageCreateOptions[];
  readonly messages: FakeMessage[];
  readonly send: ReturnType<typeof vi.fn<(options: MessageCreateOptions) => Promise<QueueMessage>>>;
  permissions: PermissionsBitField | null;
  permissionsFor(member: { id: string }): Readonly<PermissionsBitField> | null;
  thread: boolean;
  isThread(): boolean;
  sendable: boolean;
  isSendable(): boolean;
  isTextBased(): boolean;
  dm: boolean;
  isDMBased(): boolean;
}

export const FULL_PERMISSIONS = new PermissionsBitField([
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.SendMessagesInThreads,
  PermissionFlagsBits.EmbedLinks,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.MentionEveryone,
]);

export function makeChannel(id = 'chan-1'): FakeChannel {
  const sent: MessageCreateOptions[] = [];
  const messages: FakeMessage[] = [];
  const send = vi.fn<(options: MessageCreateOptions) => Promise<QueueMessage>>(async (options) => {
    sent.push(options);
    const message = makeMessage(`msg-${messages.length + 1}`, id);
    messages.push(message);
    return message;
  });
  const channel: FakeChannel = {
    id,
    sent,
    messages,
    send,
    permissions: new PermissionsBitField(FULL_PERMISSIONS),
    permissionsFor: () => channel.permissions,
    thread: false,
    isThread: () => channel.thread,
    sendable: true,
    isSendable: () => channel.sendable,
    isTextBased: () => true,
    dm: false,
    isDMBased: () => channel.dm,
  };
  return channel;
}

export interface ButtonJson {
  custom_id: string;
  label: string;
  style: number;
  disabled?: boolean;
}

function topLevelComponents(
  options: MessageCreateOptions | MessageEditOptions,
): APIMessageTopLevelComponent[] {
  return (options.components ?? []).map((component) =>
    (component as { toJSON(): APIMessageTopLevelComponent }).toJSON(),
  );
}

/** The buttons of a message, wherever its action row sits. */
export function buttonsJson(options: MessageCreateOptions | MessageEditOptions): ButtonJson[] {
  const row = topLevelComponents(options).find(
    (component): component is APIActionRowComponent<APIComponentInMessageActionRow> =>
      component.type === ComponentType.ActionRow,
  );
  if (!row) throw new Error('no action row in options');
  return row.components.filter(
    (component): component is ButtonJson & APIButtonComponent =>
      component.type === ComponentType.Button && 'custom_id' in component,
  );
}

/** A flattened view of the queue card (component layout) for assertions. */
export interface QueueView {
  /** First heading line, without the markdown `## `. */
  readonly title: string;
  /** Every text block of the container, in reading order. */
  readonly texts: readonly string[];
  readonly accentColor: number | undefined;
  readonly separators: number;
  readonly buttons: readonly ButtonJson[];
  readonly flags: unknown;
}

export function queueView(options: MessageCreateOptions | MessageEditOptions): QueueView {
  const top = topLevelComponents(options);
  const container = top.find(
    (component): component is APIContainerComponent => component.type === ComponentType.Container,
  );
  if (!container) throw new Error('no container in options');
  const texts: string[] = [];
  let separators = 0;
  for (const child of container.components) {
    if (child.type === ComponentType.TextDisplay) texts.push(child.content);
    if (child.type === ComponentType.Separator) separators += 1;
  }
  const row = top.some((c) => c.type === ComponentType.ActionRow);
  return {
    title: (texts[0] ?? '').split('\n')[0]!.replace(/^#{1,3} /, ''),
    texts,
    accentColor: container.accent_color ?? undefined,
    separators,
    buttons: row ? buttonsJson(options) : [],
    flags: options.flags,
  };
}

// ---------------------------------------------------------------------------
// Application context
// ---------------------------------------------------------------------------

export interface TestContext {
  readonly ctx: AppContext;
  readonly logger: Logger;
  readonly registry: QueueRegistry;
  readonly service: RedStarService;
}

export interface TestContextOptions {
  readonly config?: Partial<RuntimeConfig>;
  readonly service?: Partial<Omit<RedStarServiceDeps, 'logger' | 'registry'>>;
}

/** Builds a real service over a fresh registry with a silent logger, configurable per test. */
export function makeContext(options: TestContextOptions = {}): TestContext {
  const logger = silentLogger();
  const config: RuntimeConfig = { ...TEST_CONFIG, ...options.config };
  const registry = new QueueRegistry();
  let nextId = 0;
  const service = new RedStarService({
    logger,
    registry,
    queueTimeoutMs: config.queueTimeoutMs,
    reminderLeadMs: config.queueReminderMs,
    buttonCooldownMs: 0,
    newId: () => `q${++nextId}`,
    ...options.service,
  });
  return { ctx: { config, logger, redStar: service }, logger, registry, service };
}

// ---------------------------------------------------------------------------
// Interaction fakes (cast to discord.js types at the call site)
// ---------------------------------------------------------------------------

interface RepliableFake {
  deferred: boolean;
  replied: boolean;
  readonly reply: ReturnType<typeof vi.fn<(options: unknown) => Promise<unknown>>>;
  readonly editReply: ReturnType<typeof vi.fn<(options: unknown) => Promise<unknown>>>;
  readonly followUp: ReturnType<typeof vi.fn<(options: unknown) => Promise<{ id: string }>>>;
  readonly deleteReply: ReturnType<typeof vi.fn<(id?: string) => Promise<unknown>>>;
}

function repliable(): RepliableFake {
  const fake: RepliableFake = {
    deferred: false,
    replied: false,
    reply: vi.fn(async (_options: unknown) => {
      fake.replied = true;
      return undefined;
    }),
    editReply: vi.fn(async (_options: unknown) => undefined),
    followUp: vi.fn(async (_options: unknown) => ({ id: 'follow-up-1' })),
    deleteReply: vi.fn(async (_id?: string) => undefined),
  };
  return fake;
}

export interface SlashInteractionOptions {
  readonly commandName?: string;
  readonly level?: number;
  readonly userId?: string;
  readonly inGuild?: boolean;
  readonly channel?: FakeChannel | null;
  readonly me?: { id: string } | null;
  /** The member as discord.js hands it over: a cached GuildMember, raw API data, or null. */
  readonly member?: unknown;
}

export function makeSlashInteraction(options: SlashInteractionOptions = {}) {
  const channel = options.channel === undefined ? makeChannel('chan-1') : options.channel;
  const me = options.me === undefined ? { id: 'bot' } : options.me;
  const raw = {
    ...repliable(),
    isChatInputCommand: () => true,
    isButton: () => false,
    commandName: options.commandName ?? 'rs',
    user: { id: options.userId ?? 'owner', displayName: 'Owner' },
    member: options.member ?? null,
    guildId: 'guild-1',
    channelId: channel?.id ?? 'chan-1',
    options: { getInteger: vi.fn(() => options.level ?? 7) },
    inGuild: () => options.inGuild ?? true,
    guild: { members: { me, fetchMe: vi.fn(async () => ({ id: 'bot' })) } },
    channel,
    deferReply: vi.fn(async (_options: unknown) => undefined),
  };
  raw.deferReply.mockImplementation(async () => {
    raw.deferred = true;
  });
  return {
    interaction: raw as unknown as ChatInputCommandInteraction & Interaction,
    raw,
    channel,
  };
}

export interface ButtonInteractionOptions {
  readonly userId?: string;
  readonly member?: unknown;
}

export function makeButtonInteraction(
  customId: string,
  message: FakeMessage,
  options: ButtonInteractionOptions = {},
) {
  const raw = {
    ...repliable(),
    isChatInputCommand: () => false,
    isButton: () => true,
    customId,
    user: { id: options.userId ?? 'b', displayName: 'Bee' },
    member: options.member ?? null,
    guildId: 'guild-1',
    channelId: 'chan-1',
    message,
    deferUpdate: vi.fn(async () => undefined),
  };
  raw.deferUpdate.mockImplementation(async () => {
    raw.deferred = true;
  });
  return { interaction: raw as unknown as Interaction, raw };
}

// ---------------------------------------------------------------------------
// Message fake for the legacy text command path
// ---------------------------------------------------------------------------

export interface DiscordMessageOptions {
  readonly content?: string;
  readonly bot?: boolean;
  readonly channelId?: string;
}

export function makeDiscordMessage(options: DiscordMessageOptions = {}) {
  const replyDelete = vi.fn(async () => undefined);
  const raw = {
    content: options.content ?? '',
    channelId: options.channelId ?? 'chan-1',
    guildId: 'guild-1',
    author: { id: 'author', displayName: 'Author', bot: options.bot ?? false },
    reply: vi.fn(async (_content: string) => ({ delete: replyDelete })),
    delete: vi.fn(async () => undefined),
  };
  return { message: raw as unknown as Message, raw, replyDelete };
}

// ---------------------------------------------------------------------------
// Client fake
// ---------------------------------------------------------------------------

export class FakeClient extends EventEmitter {
  readonly user = { tag: 'Bot#0001' };
  readonly guilds = { cache: new Map() };
  readonly login = vi.fn(async (_token: string) => 'token');
  readonly destroy = vi.fn(async () => undefined);
}
