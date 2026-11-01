import { RED_STAR_TYPES, isValidRedStarLevel, type RedStarType } from '../../red-star/types.js';

/**
 * Recogniser for the retired text commands. The rules are the ones the
 * original bot used, so every message that used to trigger it still gets the
 * "use the slash commands" notice, and nothing else does:
 *   !curcubeu                → help
 *   !curcubeu RS 7           → classic queue   (mode is case-insensitive)
 *   !curcubeu RSD 7          → dark queue
 *   !rs7 / !rsd7 / !RS7      → shortcuts, only for command names of up to 5 characters
 * Shortcuts with a bad level (`!rs2`) were silently ignored and still are.
 * The `kind` only ends up in a log line; the user always sees the same notice.
 */

export const PREFIX_MAIN_COMMAND = 'curcubeu';
export const SHORTCUT_MAX_LENGTH = 5;

/** The names the retired text commands used; independent of the slash command names. */
export const LEGACY_COMMAND_NAMES: Readonly<Record<RedStarType, string>> = {
  classic: 'rs',
  dark: 'rsd',
};

export type PrefixCommand =
  | { readonly kind: 'help' }
  | { readonly kind: 'redStar'; readonly level: number; readonly type: RedStarType }
  | { readonly kind: 'invalidLevel'; readonly type: RedStarType }
  | { readonly kind: 'invalidMode'; readonly mode: string };

/** Longest command names first so that "RSD7" is never read as "RS" + "D7". */
const TYPES_BY_COMMAND_LENGTH: readonly RedStarType[] = [...RED_STAR_TYPES].sort(
  (a, b) => LEGACY_COMMAND_NAMES[b].length - LEGACY_COMMAND_NAMES[a].length,
);

function parseLevel(raw: string | undefined, type: RedStarType): number | null {
  if (raw === undefined) return null;
  const level = parseInt(raw, 10);
  return isValidRedStarLevel(level, type) ? level : null;
}

function typeForMode(mode: string): RedStarType | undefined {
  return RED_STAR_TYPES.find((type) => LEGACY_COMMAND_NAMES[type].toUpperCase() === mode);
}

export function parsePrefixCommand(content: string, prefix: string): PrefixCommand | null {
  if (!content.startsWith(prefix)) return null;

  const [commandName = '', ...args] = content.trim().slice(prefix.length).split(/\s+/);

  if (commandName === PREFIX_MAIN_COMMAND) {
    const mode = args[0];
    if (mode === undefined || mode === '') return { kind: 'help' };

    const type = typeForMode(mode.toUpperCase());
    if (type === undefined) return { kind: 'invalidMode', mode };

    const level = parseLevel(args[1], type);
    return level === null ? { kind: 'invalidLevel', type } : { kind: 'redStar', level, type };
  }

  if (commandName.length === 0 || commandName.length > SHORTCUT_MAX_LENGTH) return null;

  const upper = commandName.toUpperCase();
  for (const type of TYPES_BY_COMMAND_LENGTH) {
    const shortcut = LEGACY_COMMAND_NAMES[type].toUpperCase();
    if (!upper.includes(shortcut)) continue;
    const level = parseLevel(upper.replace(shortcut, ''), type);
    return level === null ? null : { kind: 'redStar', level, type };
  }

  return null;
}
