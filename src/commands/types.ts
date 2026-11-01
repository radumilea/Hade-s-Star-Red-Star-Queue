import type {
  ChatInputCommandInteraction,
  RESTPostAPIChatInputApplicationCommandsJSONBody,
} from 'discord.js';
import type { AppContext } from '../app-context.js';

export interface SlashCommand {
  readonly name: string;
  /** Definition sent to Discord by the deployment script. */
  toJSON(): RESTPostAPIChatInputApplicationCommandsJSONBody;
  execute(interaction: ChatInputCommandInteraction, ctx: AppContext): Promise<void>;
}
