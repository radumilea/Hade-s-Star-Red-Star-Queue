import 'dotenv/config';
import { createApp } from './app.js';
import { ConfigError, loadConfig } from './config.js';
import { errorToLog } from './errors.js';
import { createLogger } from './logger.js';

/** discord.js error code when the token's application lacks a privileged intent. */
const DISALLOWED_INTENTS = 'DisallowedIntents';

export function startupFailureSummary(error: unknown): string {
  if (error instanceof ConfigError) return error.message;
  const details = errorToLog(error);
  const summary = `Fatal startup error: ${String(details['name'])}: ${String(details['message'])}`;
  if (details['code'] === DISALLOWED_INTENTS) {
    return (
      `${summary}\n` +
      'The Message Content intent is not enabled for this application. Either enable it in the ' +
      'Discord developer portal (Bot > Privileged Gateway Intents) or set LEGACY_TEXT_COMMANDS=false.'
    );
  }
  return summary;
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: !config.isProduction });
  await createApp({ config, logger }).start();
}

main().catch((error: unknown) => {
  process.stderr.write(`${startupFailureSummary(error)}\n`);
  // let open handles drain instead of calling process.exit(): on Windows a hard exit
  // while sockets are closing aborts the process with a libuv assertion
  process.exitCode = 1;
});
