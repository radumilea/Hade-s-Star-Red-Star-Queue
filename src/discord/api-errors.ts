import { DiscordAPIError, RESTJSONErrorCodes } from 'discord.js';

/** The API error codes this bot reacts to specifically. */
export const ApiErrorCode = {
  UnknownChannel: RESTJSONErrorCodes.UnknownChannel,
  UnknownMessage: RESTJSONErrorCodes.UnknownMessage,
  UnknownInteraction: RESTJSONErrorCodes.UnknownInteraction,
  MissingPermissions: RESTJSONErrorCodes.MissingPermissions,
  InteractionAlreadyAcknowledged: RESTJSONErrorCodes.InteractionHasAlreadyBeenAcknowledged,
} as const;

export function isDiscordApiError(error: unknown, ...codes: readonly number[]): boolean {
  if (!(error instanceof DiscordAPIError)) return false;
  if (codes.length === 0) return true;
  return typeof error.code === 'number' && codes.includes(error.code);
}
