export type RedStarType = 'classic' | 'dark';

export interface RedStarTypeConfig {
  /** Players needed for the queue to be ready, owner included. */
  readonly maxPlayers: number;
  /** Lowest and highest Red Star level this type exists at. */
  readonly minLevel: number;
  readonly maxLevel: number;
  /** Embed colour while the queue is open. */
  readonly color: number;
  /** Name used in titles before the level, e.g. "Dark RS 7". */
  readonly label: string;
  /** Slash command name. */
  readonly commandName: string;
  readonly description: string;
}

export const RS_STAR_TYPE: Readonly<Record<RedStarType, RedStarTypeConfig>> = {
  classic: {
    maxPlayers: 4,
    minLevel: 3,
    maxLevel: 12,
    color: 0x78d64b,
    label: 'RS',
    commandName: 'rs',
    description: 'Red Star matchmaking (4 players)',
  },
  dark: {
    maxPlayers: 3,
    minLevel: 7,
    maxLevel: 12,
    color: 0xfa4616,
    label: 'Dark RS',
    commandName: 'drs',
    description: 'Dark Red Star matchmaking (3 players)',
  },
};

export const RED_STAR_TYPES: readonly RedStarType[] = ['classic', 'dark'];

export function isValidRedStarLevel(level: unknown, type: RedStarType): level is number {
  const { minLevel, maxLevel } = RS_STAR_TYPE[type];
  return (
    typeof level === 'number' && Number.isInteger(level) && level >= minLevel && level <= maxLevel
  );
}

/** Every level a type exists at, lowest first; one slash command per entry. */
export function levelsOf(type: RedStarType): number[] {
  const { minLevel, maxLevel } = RS_STAR_TYPE[type];
  return Array.from({ length: maxLevel - minLevel + 1 }, (_, i) => minLevel + i);
}

/** Human readable level range for a type, used in help texts and validation messages. */
export function levelRangeText(type: RedStarType): string {
  const { minLevel, maxLevel } = RS_STAR_TYPE[type];
  return `${minLevel}-${maxLevel}`;
}
