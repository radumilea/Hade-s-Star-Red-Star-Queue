import { UserFacingError, errorToLog, toUserMessage } from '../errors.js';
import type { Logger } from '../logger.js';

export interface HandlerContext {
  readonly kind: 'command' | 'button' | 'message';
  readonly name: string;
  readonly userId?: string;
  readonly guildId?: string | null;
  readonly channelId?: string;
}

/**
 * Runs a handler so that nothing it throws can escape into the event loop.
 * Expected errors (validation) are logged at info level and relayed to the
 * user; anything else is logged as an error and the user gets a generic reply.
 */
export async function runSafely(
  logger: Logger,
  context: HandlerContext,
  handler: () => Promise<void>,
  notify?: (message: string) => Promise<void>,
): Promise<void> {
  try {
    await handler();
  } catch (error) {
    if (error instanceof UserFacingError) {
      logger.info({ ...context, reason: error.message }, 'Handled user-facing error');
    } else {
      logger.error({ ...context, err: errorToLog(error) }, 'Handler failed');
    }

    if (!notify) return;
    try {
      await notify(toUserMessage(error));
    } catch (notifyError) {
      logger.warn(
        { ...context, err: errorToLog(notifyError) },
        'Could not notify user about error',
      );
    }
  }
}
