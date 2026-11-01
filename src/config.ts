import { z } from 'zod';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

/**
 * `.env` files and hosting dashboards turn `KEY=` into an empty string; treat
 * that as "not set" everywhere, so clearing a variable means "use the default".
 */
const blankToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalText = z.preprocess(blankToUndefined, z.string().trim().min(1).optional());

/** Discord ids ("snowflakes") are 17–20 digit numbers; anything else is a paste mistake. */
const optionalSnowflake = z.preprocess(
  blankToUndefined,
  z
    .string()
    .trim()
    .regex(/^\d{17,20}$/, 'must be a Discord id (17–20 digits)')
    .optional(),
);

/** Local-only TCP port; `.env` leaves it empty in most setups. */
const optionalPort = z.preprocess(
  blankToUndefined,
  z.coerce.number().int().min(1024).max(65535).optional(),
);

const withDefault = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema);

const flag = withDefault(
  z.preprocess(
    (value) => (typeof value === 'string' ? value.trim().toLowerCase() : value),
    z.enum(['true', 'false', '1', '0', 'yes', 'no']).default('false'),
  ),
).transform((value) => value === 'true' || value === '1' || value === 'yes');

const envSchema = z
  .object({
    DISCORD_TOKEN: optionalText,
    /** Legacy name used by the first version of the bot; still accepted. */
    DISCORDJS_BOT_TOKEN: optionalText,
    DISCORD_CLIENT_ID: optionalSnowflake,
    DISCORD_GUILD_ID: optionalSnowflake,
    COMMAND_PREFIX: withDefault(z.string().trim().min(1).max(5).default('!')),
    LOG_LEVEL: withDefault(z.enum(LOG_LEVELS).default('info')),
    QUEUE_TIMEOUT_MINUTES: withDefault(
      z.coerce
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .default(60),
    ),
    /** Minutes before expiry at which an @everyone reminder is posted; 0 disables it. */
    QUEUE_REMINDER_MINUTES: withDefault(
      z.coerce
        .number()
        .int()
        .min(0)
        .max(24 * 60)
        .default(10),
    ),
    /**
     * Answer the retired text commands (!rs7) with a notice. Off by default: it
     * needs the privileged Message Content intent, and without that enabled in
     * the portal the bot cannot log in at all.
     */
    LEGACY_TEXT_COMMANDS: flag,
    /**
     * Local development only: `POST http://127.0.0.1:<port>/shutdown` runs the
     * graceful shutdown, which Windows cannot trigger with a signal.
     */
    DEV_SHUTDOWN_PORT: optionalPort,
    NODE_ENV: optionalText,
  })
  .refine((values) => values.QUEUE_REMINDER_MINUTES < values.QUEUE_TIMEOUT_MINUTES, {
    message: 'QUEUE_REMINDER_MINUTES must be smaller than QUEUE_TIMEOUT_MINUTES',
    path: ['QUEUE_REMINDER_MINUTES'],
  })
  .refine((values) => values.NODE_ENV !== 'production' || values.DEV_SHUTDOWN_PORT === undefined, {
    message: 'DEV_SHUTDOWN_PORT is for local development only; unset it in production',
    path: ['DEV_SHUTDOWN_PORT'],
  });

/** Everything handlers may see. Deliberately excludes the token. */
export interface RuntimeConfig {
  /** Application id; only required by the command deployment script. */
  readonly clientId: string | undefined;
  /** When set, slash commands are deployed to this guild only (instant, good for dev). */
  readonly guildId: string | undefined;
  readonly commandPrefix: string;
  readonly logLevel: LogLevel;
  readonly queueTimeoutMs: number;
  /** How long before expiry the "last chance" reminder is posted; 0 disables it. */
  readonly queueReminderMs: number;
  readonly legacyTextCommands: boolean;
  /** Loopback port of the local shutdown endpoint; unset outside development. */
  readonly devShutdownPort: number | undefined;
  readonly isProduction: boolean;
}

export interface AppConfig extends RuntimeConfig {
  readonly token: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ConfigError(`Invalid environment configuration: ${details}`);
  }

  const values = parsed.data;
  const token = values.DISCORD_TOKEN ?? values.DISCORDJS_BOT_TOKEN;
  if (token === undefined) {
    throw new ConfigError('Missing bot token: set DISCORD_TOKEN in the environment (or in .env).');
  }

  return {
    token,
    clientId: values.DISCORD_CLIENT_ID,
    guildId: values.DISCORD_GUILD_ID,
    commandPrefix: values.COMMAND_PREFIX,
    logLevel: values.LOG_LEVEL,
    queueTimeoutMs: values.QUEUE_TIMEOUT_MINUTES * 60 * 1000,
    queueReminderMs: values.QUEUE_REMINDER_MINUTES * 60 * 1000,
    legacyTextCommands: values.LEGACY_TEXT_COMMANDS,
    devShutdownPort: values.DEV_SHUTDOWN_PORT,
    isProduction: values.NODE_ENV === 'production',
  };
}

/** Strips the token so the rest of the app never holds it. */
export function toRuntimeConfig(config: AppConfig): RuntimeConfig {
  return {
    clientId: config.clientId,
    guildId: config.guildId,
    commandPrefix: config.commandPrefix,
    logLevel: config.logLevel,
    queueTimeoutMs: config.queueTimeoutMs,
    queueReminderMs: config.queueReminderMs,
    legacyTextCommands: config.legacyTextCommands,
    devShutdownPort: config.devShutdownPort,
    isProduction: config.isProduction,
  };
}
