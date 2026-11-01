import {
  InteractionContextType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
} from 'discord.js';
import type { AppContext } from '../app-context.js';
import { displayNameOf } from '../discord/display-name.js';
import { TEMPORARY_REPLY_TTL_MS, replyEphemeral } from '../discord/replies.js';
import { UserFacingError } from '../errors.js';
import { RS_STAR_TYPE, levelRangeText, type RedStarType } from '../red-star/types.js';
import { CHANNEL_NOT_SUPPORTED_MESSAGE, startQueue } from './start-queue.js';
import type { SlashCommand } from './types.js';

export const LEVEL_OPTION = 'level';

export function joinedExistingReply(messageUrl: string): string {
  return `A matchmaking for this level was already open here, so you joined it: ${messageUrl}`;
}

/** Name of the per-level shortcut command, e.g. `drs9`. */
export function levelCommandName(type: RedStarType, level: number): string {
  return `${RS_STAR_TYPE[type].commandName}${level}`;
}

/** What `/rs level:7` and `/rs7` both do once the level is known. */
async function openFromInteraction(
  interaction: ChatInputCommandInteraction,
  ctx: AppContext,
  type: RedStarType,
  level: number,
): Promise<void> {
  const channel = interaction.channel;
  if (!interaction.inGuild() || !channel || !channel.isSendable() || !channel.isTextBased()) {
    throw new UserFacingError(CHANNEL_NOT_SUPPORTED_MESSAGE);
  }
  if (channel.isDMBased()) throw new UserFacingError(CHANNEL_NOT_SUPPORTED_MESSAGE);

  const me = interaction.guild?.members.me ?? (await interaction.guild?.members.fetchMe());
  const result = await startQueue(ctx, {
    level,
    type,
    ownerId: interaction.user.id,
    displayName: displayNameOf(interaction),
    channel,
    me,
  });

  // The private reply doubles as the owner's permanent instructions;
  // a plain "joined" confirmation disappears on its own.
  if (result.outcome === 'created') {
    await replyEphemeral(interaction, result.ownerInstructions);
  } else {
    await replyEphemeral(interaction, joinedExistingReply(result.message.url), {
      ttlMs: TEMPORARY_REPLY_TTL_MS,
    });
  }
}

/** Builds the /rs and /drs commands; they differ only by red star type. */
export function createRedStarCommand(type: RedStarType): SlashCommand {
  const typeConfig = RS_STAR_TYPE[type];
  const data = new SlashCommandBuilder()
    .setName(typeConfig.commandName)
    .setDescription(typeConfig.description)
    .setContexts(InteractionContextType.Guild)
    .addIntegerOption((option) =>
      option
        .setName(LEVEL_OPTION)
        .setDescription(`Red Star level (${levelRangeText(type)})`)
        .setRequired(true)
        .setMinValue(typeConfig.minLevel)
        .setMaxValue(typeConfig.maxLevel),
    );

  return {
    name: typeConfig.commandName,
    toJSON: () => data.toJSON(),
    async execute(interaction, ctx) {
      // Acknowledge within Discord's 3-second window before any REST round-trip.
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const level = interaction.options.getInteger(LEVEL_OPTION, true);
      await openFromInteraction(interaction, ctx, type, level);
    },
  };
}

/**
 * Builds a per-level shortcut such as `/drs9`: the level sits in the name, so
 * typing it the way the old `!rsd9` was typed and pressing Enter is enough.
 */
export function createRedStarLevelCommand(type: RedStarType, level: number): SlashCommand {
  const typeConfig = RS_STAR_TYPE[type];
  const name = levelCommandName(type, level);
  const data = new SlashCommandBuilder()
    .setName(name)
    .setDescription(`${typeConfig.label} ${level} matchmaking (${typeConfig.maxPlayers} players)`)
    .setContexts(InteractionContextType.Guild);

  return {
    name,
    toJSON: () => data.toJSON(),
    async execute(interaction, ctx) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await openFromInteraction(interaction, ctx, type, level);
    },
  };
}
