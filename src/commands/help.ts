import { SlashCommandBuilder } from 'discord.js';
import type { RuntimeConfig } from '../config.js';
import { TEMPORARY_REPLY_TTL_MS, replyEphemeral } from '../discord/replies.js';
import { BUTTON_LABELS } from '../red-star/render.js';
import { DEFAULT_BUTTON_COOLDOWN_MS } from '../red-star/service.js';
import { RED_STAR_TYPES, RS_STAR_TYPE, levelRangeText } from '../red-star/types.js';
import { LEVEL_OPTION, levelCommandName } from './red-star-command.js';
import type { SlashCommand } from './types.js';

export const HELP_COMMAND_NAME = 'help';

/** One line per type, showing the shortcut for its lowest level, e.g. `/drs7`. */
function commandLines(): string[] {
  return RED_STAR_TYPES.map((type) => {
    const config = RS_STAR_TYPE[type];
    const example = levelCommandName(type, config.minLevel);
    return `• \`/${example}\` – ${config.description}, levels ${levelRangeText(type)}`;
  });
}

/** How to get a slash command sent; the picker and the Space step confuse newcomers. */
export const TYPING_HINT =
  'Type the command and press Enter; it pops up as you type. ' +
  `\`/${RS_STAR_TYPE.classic.commandName} ${LEVEL_OPTION}:7\` and ` +
  `\`/${RS_STAR_TYPE.dark.commandName} ${LEVEL_OPTION}:9\` work too: ` +
  `type \`/${RS_STAR_TYPE.classic.commandName}\`, press Space, type the level, press Enter.`;

/** The timings `/help` quotes, taken from the configuration so the text never drifts. */
export type HelpConfig = Pick<RuntimeConfig, 'queueTimeoutMs' | 'queueReminderMs'>;

const minutes = (ms: number): string => `${Math.round(ms / 60_000)} minutes`;
const seconds = (ms: number): string => `${Math.round(ms / 1000)} seconds`;

export function helpText(config: HelpConfig): string {
  const { join, leave, start, cancel } = BUTTON_LABELS;
  const expiry =
    config.queueReminderMs > 0 && config.queueReminderMs < config.queueTimeoutMs
      ? `A matchmaking expires after ${minutes(config.queueTimeoutMs)}; the channel is reminded ` +
        `${minutes(config.queueReminderMs)} before.`
      : `A matchmaking expires after ${minutes(config.queueTimeoutMs)}.`;
  return [
    '**Red Star Matchmaking**',
    '',
    '**Start a matchmaking**',
    ...commandLines(),
    TYPING_HINT,
    'One matchmaking per level and type per channel: if one is already open, the command joins it.',
    '',
    '**Buttons on the card**',
    `• **${join}** / **${leave}** – anyone`,
    `• **${start}** – owner only, runs with the current squad`,
    `• **${cancel}** – owner only, closes the matchmaking`,
    '',
    '**Good to know**',
    '• Whoever opens the matchmaking is its owner. If the owner leaves, the next player takes ' +
      'over; if the last player leaves, the matchmaking closes.',
    '• A full squad closes the matchmaking and tags everyone in it.',
    `• ${expiry}`,
    `• The bot's private replies disappear after ${seconds(TEMPORARY_REPLY_TTL_MS)}.`,
    `• Buttons accept one press every ${seconds(DEFAULT_BUTTON_COOLDOWN_MS)} per player.`,
  ].join('\n');
}

/** Shown publicly when someone uses one of the retired text commands (!rs7, !curcubeu …). */
export function legacyCommandsNotice(): string {
  return [
    'The text commands were replaced by slash commands:',
    ...commandLines(),
    `• \`/${HELP_COMMAND_NAME}\` for details`,
    TYPING_HINT,
  ].join('\n');
}

export function createHelpCommand(): SlashCommand {
  const data = new SlashCommandBuilder()
    .setName(HELP_COMMAND_NAME)
    .setDescription('How to use the Red Star Matchmaking bot');

  return {
    name: HELP_COMMAND_NAME,
    toJSON: () => data.toJSON(),
    async execute(interaction, ctx) {
      await replyEphemeral(interaction, helpText(ctx.config));
    },
  };
}
