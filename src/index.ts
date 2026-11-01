import 'dotenv/config';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { startupFailureSummary } from './startup.js';

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
