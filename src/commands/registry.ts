import { RED_STAR_TYPES } from '../red-star/types.js';
import { createHelpCommand } from './help.js';
import { createRedStarCommand } from './red-star-command.js';
import type { SlashCommand } from './types.js';

export function createCommands(): SlashCommand[] {
  return [...RED_STAR_TYPES.map((type) => createRedStarCommand(type)), createHelpCommand()];
}

export function commandsByName(
  commands: readonly SlashCommand[],
): ReadonlyMap<string, SlashCommand> {
  const map = new Map<string, SlashCommand>();
  for (const command of commands) {
    if (map.has(command.name)) {
      throw new Error(`Duplicate slash command name: ${command.name}`);
    }
    map.set(command.name, command);
  }
  return map;
}
