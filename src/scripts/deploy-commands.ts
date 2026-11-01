import 'dotenv/config';
import { REST } from 'discord.js';
import { ConfigError, loadConfig } from '../config.js';
import { deployCommands } from '../discord/deploy-commands.js';
import { errorToLog } from '../errors.js';
import { createLogger } from '../logger.js';

/**
 * CLI entry: `npm run deploy-commands`. Run it once after changing a command
 * definition. With DISCORD_GUILD_ID set the commands appear instantly in that
 * guild; without it they are deployed globally (can take up to an hour).
 * `npm run deploy-commands -- --clear-guild` removes the guild-scoped set, so
 * a development guild stops showing duplicates once the global set is live.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger({ level: config.logLevel, pretty: !config.isProduction });
  try {
    await deployCommands({
      rest: new REST().setToken(config.token),
      logger,
      clientId: config.clientId,
      guildId: config.guildId,
      clearGuild: process.argv.includes('--clear-guild'),
    });
  } catch (error) {
    // keep the Discord error code and status: "Missing Access" alone does not say
    // whether the id is wrong or the bot is not in that guild
    logger.fatal({ err: errorToLog(error) }, 'Command deployment failed');
    throw error;
  }
}

main().catch((error: unknown) => {
  if (error instanceof ConfigError) process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
