import { errorToLog } from './errors.js';
import type { Logger } from './logger.js';

export interface ShutdownDeps {
  readonly logger: Logger;
  /** Work to do before the process exits (close queues, destroy the client). */
  readonly cleanup: () => Promise<void>;
  readonly exit: (code: number) => void;
  readonly timeoutMs: number;
}

export type Shutdown = (reason: string, code?: number) => Promise<void>;

/** Reasons that mean "an operator wants out": a repeat exits at once. */
const OPERATOR_REASONS = new Set(['SIGTERM', 'SIGINT']);

/** Resolves when the promise settles or the timeout passes, whichever is first. */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

/**
 * Builds a shutdown function. The first call runs the cleanup (bounded by the
 * timeout) and exits with the highest exit code requested so far. A second
 * signal while cleanup is running exits immediately: an operator pressing
 * Ctrl+C twice means "now". Errors raised while cleanup runs only raise the
 * exit code; the cleanup is left to finish.
 */
export function createShutdown(deps: ShutdownDeps): Shutdown {
  let started = false;
  let exitCode = 0;
  const exit = (): void => {
    // the pretty logger writes through a worker thread; give it a chance to drain
    deps.logger.flush();
    deps.exit(exitCode);
  };
  return async (reason, code = 0) => {
    exitCode = Math.max(exitCode, code);
    if (started) {
      if (OPERATOR_REASONS.has(reason)) {
        deps.logger.warn({ reason }, 'Shutdown already in progress; exiting now');
        exit();
      } else {
        deps.logger.warn({ reason, code: exitCode }, 'Shutdown already in progress');
      }
      return;
    }
    started = true;
    deps.logger.info({ reason, code: exitCode }, 'Shutting down');
    try {
      await withTimeout(deps.cleanup(), deps.timeoutMs, 'Shutdown cleanup');
    } catch (error) {
      deps.logger.warn({ err: errorToLog(error) }, 'Cleanup did not finish cleanly');
    }
    exit();
  };
}

export interface ProcessHandlerDeps {
  readonly logger: Logger;
  readonly shutdown: Shutdown;
  readonly process: Pick<NodeJS.Process, 'on'>;
}

/** Wires signals and last-resort error handlers to the shutdown routine. */
export function installProcessHandlers(deps: ProcessHandlerDeps): void {
  const { logger, shutdown } = deps;
  deps.process.on('SIGTERM', () => void shutdown('SIGTERM'));
  deps.process.on('SIGINT', () => void shutdown('SIGINT'));
  deps.process.on('unhandledRejection', (reason) => {
    logger.fatal({ err: errorToLog(reason) }, 'Unhandled promise rejection');
    void shutdown('unhandledRejection', 1);
  });
  deps.process.on('uncaughtException', (error) => {
    logger.fatal({ err: errorToLog(error) }, 'Uncaught exception');
    void shutdown('uncaughtException', 1);
  });
}
