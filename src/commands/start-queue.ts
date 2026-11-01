import type { AppContext } from '../app-context.js';
import {
  missingQueuePermissions,
  type PermissionMember,
  type PermissionSource,
} from '../discord/permissions.js';
import { UserFacingError } from '../errors.js';
import type { QueueChannel } from '../red-star/ports.js';
import type { OpenQueueResult } from '../red-star/service.js';
import { isValidRedStarLevel, levelRangeText, type RedStarType } from '../red-star/types.js';

export interface StartQueueInput {
  readonly level: number;
  readonly type: RedStarType;
  readonly ownerId: string;
  readonly displayName: string;
  readonly channel: QueueChannel & PermissionSource;
  /** The bot's own guild member, used for the permission check. */
  readonly me: PermissionMember | null | undefined;
}

export const CHANNEL_NOT_SUPPORTED_MESSAGE = 'This command only works in a server text channel.';

/** Shared use-case behind the /rs and /drs slash commands. */
export async function startQueue(
  ctx: AppContext,
  input: StartQueueInput,
): Promise<OpenQueueResult> {
  if (!isValidRedStarLevel(input.level, input.type)) {
    throw new UserFacingError(`Pick a level between ${levelRangeText(input.type)}.`);
  }

  const missing = missingQueuePermissions(input.channel, input.me);
  if (missing.length > 0) {
    throw new UserFacingError(
      `I cannot post a queue here, I am missing these permissions: ${missing.join(', ')}.`,
    );
  }

  return ctx.redStar.openQueue({
    ownerId: input.ownerId,
    displayName: input.displayName,
    level: input.level,
    type: input.type,
    channel: input.channel,
  });
}
