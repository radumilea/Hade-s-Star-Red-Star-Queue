import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { ConfigError, loadConfig, toRuntimeConfig } from '../src/config.js';
import {
  AppError,
  GENERIC_USER_MESSAGE,
  UserFacingError,
  errorToLog,
  toUserMessage,
} from '../src/errors.js';
import { createShutdown, installProcessHandlers, withTimeout } from '../src/lifecycle.js';
import { createLogger, createSilentLogger } from '../src/logger.js';
import { startupFailureSummary } from '../src/startup.js';
import { apiError } from './fakes.js';

describe('loadConfig', () => {
  test('applies defaults and reads the token', () => {
    const config = loadConfig({ DISCORD_TOKEN: 'abc' });
    expect(config).toEqual({
      token: 'abc',
      clientId: undefined,
      guildId: undefined,
      commandPrefix: '!',
      logLevel: 'info',
      queueTimeoutMs: 60 * 60 * 1000,
      queueReminderMs: 10 * 60 * 1000,
      legacyTextCommands: false,
      devShutdownPort: undefined,
      isProduction: false,
    });
  });

  test('accepts the legacy token variable and prefers the new one', () => {
    expect(loadConfig({ DISCORDJS_BOT_TOKEN: 'old' }).token).toBe('old');
    expect(loadConfig({ DISCORD_TOKEN: 'new', DISCORDJS_BOT_TOKEN: 'old' }).token).toBe('new');
  });

  test('treats empty optional values as unset (as a copied .env.example produces)', () => {
    const config = loadConfig({
      DISCORD_TOKEN: 'abc',
      DISCORD_CLIENT_ID: '',
      DISCORD_GUILD_ID: '  ',
    });
    expect(config.clientId).toBeUndefined();
    expect(config.guildId).toBeUndefined();
  });

  test('reads every option', () => {
    const config = loadConfig({
      DISCORD_TOKEN: ' t ',
      DISCORD_CLIENT_ID: '123456789012345678',
      DISCORD_GUILD_ID: '876543210987654321',
      COMMAND_PREFIX: ' ? ',
      LOG_LEVEL: 'debug',
      QUEUE_TIMEOUT_MINUTES: '15',
      QUEUE_REMINDER_MINUTES: '0',
      LEGACY_TEXT_COMMANDS: 'false',
      NODE_ENV: 'production',
    });
    expect(config).toEqual({
      token: 't',
      clientId: '123456789012345678',
      guildId: '876543210987654321',
      commandPrefix: '?',
      logLevel: 'debug',
      queueTimeoutMs: 15 * 60 * 1000,
      queueReminderMs: 0,
      legacyTextCommands: false,
      devShutdownPort: undefined,
      isProduction: true,
    });
  });

  test.each([
    ['true', true],
    ['1', true],
    ['yes', true],
    ['false', false],
    ['0', false],
    ['no', false],
  ])('LEGACY_TEXT_COMMANDS=%s → %s', (value, expected) => {
    expect(loadConfig({ DISCORD_TOKEN: 't', LEGACY_TEXT_COMMANDS: value }).legacyTextCommands).toBe(
      expected,
    );
  });

  test('a blank value means "use the default" for every optional variable', () => {
    const config = loadConfig({
      DISCORD_TOKEN: 't',
      COMMAND_PREFIX: '',
      LOG_LEVEL: '',
      QUEUE_TIMEOUT_MINUTES: '',
      QUEUE_REMINDER_MINUTES: ' ',
      LEGACY_TEXT_COMMANDS: '',
      DEV_SHUTDOWN_PORT: '',
      NODE_ENV: '',
    });
    expect(config).toMatchObject({
      commandPrefix: '!',
      logLevel: 'info',
      queueTimeoutMs: 60 * 60 * 1000,
      queueReminderMs: 10 * 60 * 1000,
      legacyTextCommands: false,
      devShutdownPort: undefined,
      isProduction: false,
    });
  });

  test('flags are case-insensitive', () => {
    expect(
      loadConfig({ DISCORD_TOKEN: 't', LEGACY_TEXT_COMMANDS: 'TRUE' }).legacyTextCommands,
    ).toBe(true);
    expect(
      loadConfig({ DISCORD_TOKEN: 't', LEGACY_TEXT_COMMANDS: ' Yes ' }).legacyTextCommands,
    ).toBe(true);
  });

  test('fails fast with a readable message when the token is missing or blank', () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    expect(() => loadConfig({})).toThrow('Missing bot token');
    expect(() => loadConfig({ DISCORD_TOKEN: '   ' })).toThrow('Missing bot token');
  });

  test.each([
    { DISCORD_TOKEN: 't', LOG_LEVEL: 'loud' },
    { DISCORD_TOKEN: 't', QUEUE_TIMEOUT_MINUTES: '0' },
    { DISCORD_TOKEN: 't', QUEUE_TIMEOUT_MINUTES: 'soon' },
    { DISCORD_TOKEN: 't', QUEUE_TIMEOUT_MINUTES: '1.5' },
    { DISCORD_TOKEN: 't', QUEUE_REMINDER_MINUTES: '-1' },
    { DISCORD_TOKEN: 't', QUEUE_REMINDER_MINUTES: '2.5' },
    { DISCORD_TOKEN: 't', QUEUE_REMINDER_MINUTES: '99999' },
    { DISCORD_TOKEN: 't', QUEUE_TIMEOUT_MINUTES: '5', QUEUE_REMINDER_MINUTES: '5' },
    { DISCORD_TOKEN: 't', QUEUE_TIMEOUT_MINUTES: '5', QUEUE_REMINDER_MINUTES: '10' },
    { DISCORD_TOKEN: 't', LEGACY_TEXT_COMMANDS: 'maybe' },
    { DISCORD_TOKEN: 't', COMMAND_PREFIX: 'toolong' },
    { DISCORD_TOKEN: 't', DISCORD_CLIENT_ID: 'not-an-id' },
    { DISCORD_TOKEN: 't', DISCORD_GUILD_ID: '123' },
    { DISCORD_TOKEN: 't', COMMAND_PREFIX: 'toolong' },
    { DISCORD_TOKEN: 't', DEV_SHUTDOWN_PORT: '80' },
    { DISCORD_TOKEN: 't', DEV_SHUTDOWN_PORT: 'abc' },
    { DISCORD_TOKEN: 't', DEV_SHUTDOWN_PORT: '70000' },
    { DISCORD_TOKEN: 't', DEV_SHUTDOWN_PORT: '48771', NODE_ENV: 'production' },
  ])('rejects invalid values %o', (env) => {
    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow('Invalid environment configuration');
  });

  test('a reminder that is not shorter than the timeout names the offending variable', () => {
    expect(() =>
      loadConfig({ DISCORD_TOKEN: 't', QUEUE_TIMEOUT_MINUTES: '5', QUEUE_REMINDER_MINUTES: '5' }),
    ).toThrow('QUEUE_REMINDER_MINUTES must be smaller than QUEUE_TIMEOUT_MINUTES');
  });

  test('DEV_SHUTDOWN_PORT is a local-only loopback port', () => {
    expect(loadConfig({ DISCORD_TOKEN: 't', DEV_SHUTDOWN_PORT: '48771' }).devShutdownPort).toBe(
      48771,
    );
    expect(
      loadConfig({ DISCORD_TOKEN: 't', DEV_SHUTDOWN_PORT: '' }).devShutdownPort,
    ).toBeUndefined();
    expect(() =>
      loadConfig({ DISCORD_TOKEN: 't', DEV_SHUTDOWN_PORT: '48771', NODE_ENV: 'production' }),
    ).toThrow('local development only');
  });

  test('toRuntimeConfig drops the token and nothing else', () => {
    const config = loadConfig({ DISCORD_TOKEN: 'secret', DISCORD_CLIENT_ID: '123456789012345678' });
    const runtime = toRuntimeConfig(config);
    expect(runtime).not.toHaveProperty('token');
    expect(JSON.stringify(runtime)).not.toContain('secret');
    const { token, ...rest } = config;
    expect(token).toBe('secret');
    expect(runtime).toEqual(rest);
  });
});

describe('errors', () => {
  test('toUserMessage shows only user-facing messages', () => {
    expect(toUserMessage(new UserFacingError('be nice'))).toBe('be nice');
    expect(toUserMessage(new AppError('internal detail'))).toBe(GENERIC_USER_MESSAGE);
    expect(toUserMessage(new Error('stack trace'))).toBe(GENERIC_USER_MESSAGE);
    expect(toUserMessage('string')).toBe(GENERIC_USER_MESSAGE);
  });

  test('errorToLog serialises errors, codes and causes', () => {
    const cause = new Error('root');
    const error = Object.assign(new UserFacingError('top', { cause }), { code: 42 });
    const log = errorToLog(error);
    expect(log).toMatchObject({ name: 'UserFacingError', message: 'top', code: 42 });
    expect(log['stack']).toContain('top');
    expect(log['cause']).toMatchObject({ name: 'Error', message: 'root' });
    expect(errorToLog('oops')).toEqual({ value: 'oops' });
    expect(errorToLog(undefined)).toEqual({ value: undefined });
  });

  test('errorToLog keeps the useful HTTP fields of a Discord API error and nothing else', () => {
    const log = errorToLog(apiError(10008));
    expect(log).toMatchObject({ code: 10008, status: 404, method: 'PATCH', url: 'https://x' });
    expect(log).not.toHaveProperty('requestBody');
    expect(log).not.toHaveProperty('rawError');
  });

  test('errorToLog survives a cyclic cause chain', () => {
    const a = new Error('a');
    const b = new Error('b', { cause: a });
    a.cause = b;
    const log = errorToLog(a);
    expect(JSON.stringify(log)).toContain('(cause chain truncated)');
  });

  test('error classes have the right names', () => {
    expect(new AppError('a').name).toBe('AppError');
    expect(new UserFacingError('b').name).toBe('UserFacingError');
    expect(new UserFacingError('b')).toBeInstanceOf(AppError);
  });
});

describe('logger', () => {
  test('creates json and pretty loggers at the given level', () => {
    expect(createLogger({ level: 'warn', pretty: false }).level).toBe('warn');
    expect(createLogger({ level: 'debug', pretty: true }).level).toBe('debug');
    expect(createSilentLogger().level).toBe('silent');
  });

  test('redacts token-like fields wherever they appear', () => {
    const lines: string[] = [];
    const logger = createLogger({
      level: 'info',
      pretty: false,
      destination: { write: (line: string) => void lines.push(line) },
    });
    logger.info({ token: 'abc', config: { token: 'def' }, nested: { authorization: 'ghi' } }, 'x');
    const [line] = lines;
    expect(line).toBeDefined();
    expect(line).not.toContain('abc');
    expect(line).not.toContain('def');
    expect(line).not.toContain('ghi');
    expect(line).toContain('[redacted]');
  });
});

describe('withTimeout', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('resolves with the value when fast enough', async () => {
    await expect(withTimeout(Promise.resolve(1), 100, 'x')).resolves.toBe(1);
  });

  test('rejects with the original error', async () => {
    await expect(withTimeout(Promise.reject(new Error('inner')), 100, 'x')).rejects.toThrow(
      'inner',
    );
    // a non-Error rejection must still surface as an Error
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors
    await expect(withTimeout(Promise.reject('raw'), 100, 'x')).rejects.toThrow('raw');
  });

  test('rejects when the timeout passes first', async () => {
    const never = new Promise<void>(() => undefined);
    const pending = withTimeout(never, 50, 'Cleanup');
    const assertion = expect(pending).rejects.toThrow('Cleanup timed out after 50ms');
    await vi.advanceTimersByTimeAsync(50);
    await assertion;
  });
});

describe('createShutdown', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('runs cleanup once and exits with the given code', async () => {
    const cleanup = vi.fn(async () => undefined);
    const exit = vi.fn();
    const shutdown = createShutdown({
      logger: createSilentLogger(),
      cleanup,
      exit,
      timeoutMs: 100,
    });
    await shutdown('SIGTERM');
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('a second request during cleanup exits immediately with the highest code', async () => {
    const exit = vi.fn();
    let finish: () => void = () => undefined;
    const cleanup = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)));
    const shutdown = createShutdown({
      logger: createSilentLogger(),
      cleanup,
      exit,
      timeoutMs: 1_000,
    });

    const first = shutdown('SIGTERM');
    // an error during cleanup only raises the exit code; the cleanup is left to finish
    await shutdown('unhandledRejection', 1);
    expect(exit).not.toHaveBeenCalled();
    // a second signal means "now"
    await shutdown('SIGINT');
    expect(exit).toHaveBeenCalledWith(1);
    finish();
    await first;
    expect(exit).toHaveBeenCalledTimes(2);
    expect(exit).toHaveBeenLastCalledWith(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  test('still exits when cleanup fails or hangs, and logs why', async () => {
    const exit = vi.fn();
    const logger = createSilentLogger();
    const warn = vi.spyOn(logger, 'warn');
    const failing = createShutdown({
      logger,
      cleanup: async () => {
        throw new Error('nope');
      },
      exit,
      timeoutMs: 100,
    });
    await failing('unhandledRejection', 1);
    expect(exit).toHaveBeenCalledWith(1);
    expect(warn).toHaveBeenCalledWith(expect.anything(), 'Cleanup did not finish cleanly');

    const hanging = createShutdown({
      logger,
      cleanup: () => new Promise(() => undefined),
      exit,
      timeoutMs: 100,
    });
    const pending = hanging('SIGTERM');
    await vi.advanceTimersByTimeAsync(100);
    await pending;
    expect(exit).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledTimes(2);
  });
});

describe('startupFailureSummary', () => {
  test('config errors are printed as they are', () => {
    expect(startupFailureSummary(new ConfigError('bad env'))).toBe('bad env');
  });

  test('a missing privileged intent gets an actionable hint', () => {
    const error = Object.assign(new Error('Used disallowed intents'), {
      code: 'DisallowedIntents',
    });
    const summary = startupFailureSummary(error);
    expect(summary).toContain('Fatal startup error: Error: Used disallowed intents');
    expect(summary).toContain('Message Content intent');
    expect(summary).toContain('LEGACY_TEXT_COMMANDS=false');
    expect(startupFailureSummary(new Error('other'))).not.toContain('intent');
  });
});

describe('installProcessHandlers', () => {
  test('maps signals and fatal errors to shutdown', () => {
    const shutdown = vi.fn(async () => undefined);
    const fakeProcess = new EventEmitter();
    const logger = createSilentLogger();
    const fatal = vi.spyOn(logger, 'fatal');
    installProcessHandlers({ logger, shutdown, process: fakeProcess as unknown as NodeJS.Process });

    fakeProcess.emit('SIGTERM');
    fakeProcess.emit('SIGINT');
    fakeProcess.emit('unhandledRejection', new Error('rej'));
    fakeProcess.emit('uncaughtException', new Error('exc'));

    expect(shutdown).toHaveBeenNthCalledWith(1, 'SIGTERM');
    expect(shutdown).toHaveBeenNthCalledWith(2, 'SIGINT');
    expect(shutdown).toHaveBeenNthCalledWith(3, 'unhandledRejection', 1);
    expect(shutdown).toHaveBeenNthCalledWith(4, 'uncaughtException', 1);
    expect(fatal).toHaveBeenCalledTimes(2);
  });
});
