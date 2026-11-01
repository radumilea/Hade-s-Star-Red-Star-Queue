import { pino, type DestinationStream, type Logger } from 'pino';

export type { Logger };

export interface LoggerOptions {
  readonly level: string;
  /** Human readable output for local development; JSON otherwise. */
  readonly pretty: boolean;
  /** Where JSON lines go; defaults to stdout. Ignored when `pretty` is set. */
  readonly destination?: DestinationStream;
}

/** Keys that must never reach a log line, wherever they appear in a log object. */
const REDACTED_PATHS = ['token', '*.token', 'config.token', 'authorization', '*.authorization'];

export function createLogger(options: LoggerOptions): Logger {
  const base = { level: options.level, redact: { paths: REDACTED_PATHS, censor: '[redacted]' } };
  if (options.pretty) {
    return pino({
      ...base,
      transport: {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'SYS:standard' },
      },
    });
  }
  return options.destination ? pino(base, options.destination) : pino(base);
}

/** Logger that discards everything; used by tests. */
export function createSilentLogger(): Logger {
  return pino({ level: 'silent' });
}
