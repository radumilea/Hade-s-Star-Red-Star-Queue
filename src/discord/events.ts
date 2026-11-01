import { Events, type Client, type Interaction, type Message } from 'discord.js';
import type { AppContext } from '../app-context.js';
import { createPrefixMessageHandler } from '../commands/prefix/handle.js';
import type { SlashCommand } from '../commands/types.js';
import { errorToLog } from '../errors.js';
import { parseButtonId } from '../red-star/buttons.js';
import { displayNameOf } from './display-name.js';
import { runSafely } from './error-boundary.js';
import {
  PUBLIC_TIP_TTL_MS,
  TEMPORARY_REPLY_TTL_MS,
  replyEphemeral,
  sendTemporaryReply,
} from './replies.js';

export const UNKNOWN_COMMAND_MESSAGE =
  'Unknown command. An admin may need to redeploy the slash commands.';

export type CommandLookup = ReadonlyMap<string, SlashCommand>;

export async function handleInteraction(
  interaction: Interaction,
  ctx: AppContext,
  commands: CommandLookup,
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    const context = {
      kind: 'command' as const,
      name: interaction.commandName,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    };
    const notify = (content: string) =>
      replyEphemeral(interaction, content, { ttlMs: TEMPORARY_REPLY_TTL_MS });

    const command = commands.get(interaction.commandName);
    if (!command) {
      ctx.logger.warn(context, 'Unknown slash command');
      await runSafely(ctx.logger, context, () => notify(UNKNOWN_COMMAND_MESSAGE));
      return;
    }

    await runSafely(ctx.logger, context, () => command.execute(interaction, ctx), notify);
    return;
  }

  if (interaction.isButton()) {
    const parsed = parseButtonId(interaction.customId);
    if (!parsed) return;

    const context = {
      kind: 'button' as const,
      name: interaction.customId,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
    };
    const notify = (content: string) =>
      replyEphemeral(interaction, content, { ttlMs: TEMPORARY_REPLY_TTL_MS, afterUpdate: true });

    await runSafely(
      ctx.logger,
      context,
      () =>
        ctx.redStar.handleButton({
          action: parsed.action,
          queueId: parsed.queueId,
          userId: interaction.user.id,
          displayName: displayNameOf(interaction),
          interaction,
          notifyUser: notify,
        }),
      notify,
    );
  }
}

export interface EventDeps {
  readonly commands: CommandLookup;
  /** Called when the gateway connection is lost for good (bad token, disallowed intents). */
  readonly onFatalDisconnect: (reason: string) => void;
}

export function registerEvents(client: Client, ctx: AppContext, deps: EventDeps): void {
  const { logger } = ctx;

  client.once(Events.ClientReady, (readyClient) => {
    logger.info(
      { tag: readyClient.user.tag, guilds: readyClient.guilds.cache.size },
      'Logged in to Discord',
    );
  });

  client.on(Events.Error, (error) => {
    logger.error({ err: errorToLog(error) }, 'Discord client error');
  });

  client.on(Events.Warn, (warning) => {
    logger.warn({ warning }, 'Discord client warning');
  });

  client.on(Events.ShardReconnecting, (shardId) => {
    logger.warn({ shardId }, 'Shard reconnecting');
  });

  client.on(Events.ShardError, (error, shardId) => {
    logger.error({ err: errorToLog(error), shardId }, 'Shard error');
  });

  // discord.js only emits this when it will NOT reconnect: let the host restart us visibly.
  client.on(Events.ShardDisconnect, (event, shardId) => {
    logger.fatal({ code: event.code, shardId }, 'Shard disconnected and will not reconnect');
    deps.onFatalDisconnect(`shard disconnect ${event.code}`);
  });

  client.on(Events.InteractionCreate, (interaction) => {
    void handleInteraction(interaction, ctx, deps.commands);
  });

  if (ctx.config.legacyTextCommands) {
    const handlePrefixMessage = createPrefixMessageHandler(ctx);
    client.on(Events.MessageCreate, (message: Message) => {
      void runSafely(
        logger,
        {
          kind: 'message',
          name: 'legacy-text-command',
          userId: message.author.id,
          guildId: message.guildId,
          channelId: message.channelId,
        },
        () => handlePrefixMessage(message),
        (content) =>
          sendTemporaryReply(message, content, {
            ttlMs: PUBLIC_TIP_TTL_MS,
            deleteSource: false,
            logger,
          }),
      );
    });
  }
}
