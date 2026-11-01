import { Client, GatewayIntentBits } from 'discord.js';

export interface ClientOptions {
  /**
   * Also listen to guild messages so the retired text commands (!rs7) can be
   * answered with a notice. MessageContent is a privileged intent: it must be
   * enabled in the developer portal, otherwise the gateway refuses the login.
   */
  readonly legacyTextCommands: boolean;
}

export function intentsFor(options: ClientOptions): GatewayIntentBits[] {
  const intents = [GatewayIntentBits.Guilds];
  if (options.legacyTextCommands) {
    intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
  }
  return intents;
}

export function createClient(options: ClientOptions): Client {
  return new Client({
    intents: intentsFor(options),
    // Nothing the bot sends may ping roles or @everyone unless a send explicitly allows it.
    allowedMentions: { parse: ['users'] },
  });
}
