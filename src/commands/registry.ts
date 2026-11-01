import { RED_STAR_TYPES, levelsOf } from '../red-star/types.js';
import { createHelpCommand } from './help.js';
import { createRedStarCommand, createRedStarLevelCommand } from './red-star-command.js';
import type { SlashCommand } from './types.js';

/** The generic command precedes its level shortcuts so the picker lists `/rs` first. */
export function createCommands(): SlashCommand[] {
  return [
    ...RED_STAR_TYPES.flatMap((type) => [
      createRedStarCommand(type),
      ...levelsOf(type).map((level) => createRedStarLevelCommand(type, level)),
    ]),
    createHelpCommand(),
  ];
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
