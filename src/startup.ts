import { ConfigError } from './config.js';
import { errorToLog } from './errors.js';

/** discord.js error code when the token's application lacks a privileged intent. */
const DISALLOWED_INTENTS = 'DisallowedIntents';

export function startupFailureSummary(error: unknown): string {
  if (error instanceof ConfigError) return error.message;
  const details = errorToLog(error);
  const summary = `Fatal startup error: ${String(details['name'])}: ${String(details['message'])}`;
  if (details['code'] === DISALLOWED_INTENTS) {
    return (
      `${summary}\n` +
      'The Message Content intent is not enabled for this application. Either enable it in the ' +
      'Discord developer portal (Bot > Privileged Gateway Intents) or set LEGACY_TEXT_COMMANDS=false.'
    );
  }
  return summary;
}
