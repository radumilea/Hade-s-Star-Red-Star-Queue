import {
  Routes,
  type REST,
  type RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import { createCommands } from '../commands/registry.js';
import { ConfigError } from '../config.js';
import type { Logger } from '../logger.js';

export interface DeployCommandsDeps {
  readonly rest: Pick<REST, 'put'>;
  readonly logger: Logger;
  readonly clientId: string | undefined;
  /** When set, commands are registered in this guild only (instant); otherwise globally. */
  readonly guildId: string | undefined;
  /**
   * Remove the guild-scoped set instead of deploying. Guild and global sets are
   * independent, so a guild used for development keeps showing its own copy of
   * every command next to the global one until it is cleared.
   */
  readonly clearGuild?: boolean;
}

export interface DeployResult {
  readonly scope: 'global' | 'guild' | 'guild-cleared';
  readonly commands: readonly RESTPostAPIChatInputApplicationCommandsJSONBody[];
}

/**
 * Registers the slash commands with Discord. PUT replaces the full set within
 * its scope, so a renamed or removed command disappears from Discord too.
 */
export async function deployCommands(deps: DeployCommandsDeps): Promise<DeployResult> {
  if (deps.clientId === undefined) {
    throw new ConfigError('DISCORD_CLIENT_ID (the application id) is required to deploy commands.');
  }

  if (deps.clearGuild === true) {
    if (deps.guildId === undefined) {
      throw new ConfigError('DISCORD_GUILD_ID is required to clear the guild commands.');
    }
    await deps.rest.put(Routes.applicationGuildCommands(deps.clientId, deps.guildId), {
      body: [],
    });
    deps.logger.info({ guildId: deps.guildId }, 'Guild slash commands cleared');
    return { scope: 'guild-cleared', commands: [] };
  }

  const body = createCommands().map((command) => command.toJSON());
  const route =
    deps.guildId === undefined
      ? Routes.applicationCommands(deps.clientId)
      : Routes.applicationGuildCommands(deps.clientId, deps.guildId);

  await deps.rest.put(route, { body });
  const scope = deps.guildId === undefined ? 'global' : 'guild';
  deps.logger.info(
    { count: body.length, scope, guildId: deps.guildId, names: body.map((c) => c.name) },
    'Slash commands deployed',
  );
  return { scope, commands: body };
}
