import type { Client } from 'discord.js';
import type { AppContext } from './app-context.js';
import { commandsByName, createCommands } from './commands/registry.js';
import { toRuntimeConfig, type AppConfig } from './config.js';
import { startDevControl, type DevControl } from './dev-control.js';
import { createClient } from './discord/client.js';
import { registerEvents } from './discord/events.js';
import { errorToLog } from './errors.js';
import { createShutdown, installProcessHandlers, type Shutdown } from './lifecycle.js';
import type { Logger } from './logger.js';
import { QueueRegistry } from './red-star/queue-registry.js';
import { RedStarService } from './red-star/service.js';

/** Heroku allows 30 s after SIGTERM; closing several cards in one channel can take a few. */
export const SHUTDOWN_TIMEOUT_MS = 15_000;

export interface AppDeps {
  readonly config: AppConfig;
  readonly logger: Logger;
  /** Overridable for tests; defaults to a real discord.js client. */
  readonly createClient?: typeof createClient;
  readonly exit?: (code: number) => void;
  readonly process?: Pick<NodeJS.Process, 'on'>;
}

export interface App {
  readonly client: Client;
  readonly context: AppContext;
  readonly shutdown: Shutdown;
  /** Logs in; on failure the client is destroyed before the error propagates. */
  start(): Promise<void>;
}

/** Wires configuration, services, the Discord client and process lifecycle together. */
export function createApp(deps: AppDeps): App {
  const { config, logger } = deps;
  const runtime = toRuntimeConfig(config);

  const registry = new QueueRegistry();
  const redStar = new RedStarService({
    logger,
    registry,
    queueTimeoutMs: runtime.queueTimeoutMs,
    reminderLeadMs: runtime.queueReminderMs,
  });
  const context: AppContext = { config: runtime, logger, redStar };

  const client = (deps.createClient ?? createClient)({
    legacyTextCommands: runtime.legacyTextCommands,
  });

  let devControl: DevControl | undefined;
  const shutdown = createShutdown({
    logger,
    timeoutMs: SHUTDOWN_TIMEOUT_MS,
    exit: deps.exit ?? ((code) => process.exit(code)),
    cleanup: async () => {
      try {
        await devControl?.close();
        await redStar.closeAll();
      } finally {
        // whatever happened above, log out cleanly
        await client.destroy();
      }
    },
  });

  registerEvents(client, context, {
    commands: commandsByName(createCommands()),
    onFatalDisconnect: (reason) => void shutdown(reason, 1),
  });
  installProcessHandlers({ logger, shutdown, process: deps.process ?? process });

  return {
    client,
    context,
    shutdown,
    async start() {
      logger.info(
        {
          legacyTextCommands: runtime.legacyTextCommands,
          queueTimeoutMs: runtime.queueTimeoutMs,
          queueReminderMs: runtime.queueReminderMs,
          devShutdownPort: runtime.devShutdownPort,
        },
        'Starting bot',
      );
      try {
        await client.login(config.token);
      } catch (error) {
        logger.fatal({ err: errorToLog(error) }, 'Could not log in to Discord');
        // release sockets and worker threads before exiting, otherwise Node aborts on Windows
        await client.destroy();
        throw error;
      }
      if (runtime.devShutdownPort !== undefined) {
        try {
          devControl = await startDevControl({ port: runtime.devShutdownPort, logger, shutdown });
        } catch (error) {
          // a developer convenience; the bot is more important than the endpoint
          logger.warn({ err: errorToLog(error) }, 'Dev shutdown endpoint could not start');
        }
      }
    },
  };
}
