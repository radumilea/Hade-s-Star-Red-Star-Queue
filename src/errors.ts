/** Base class for errors raised by the application itself. */
export class AppError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'AppError';
  }
}

/** An error whose message is safe and useful to show to the Discord user. */
export class UserFacingError extends AppError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UserFacingError';
  }
}

export const GENERIC_USER_MESSAGE =
  'Something went wrong on my side. Please try again in a moment.';

/** Picks the message to show a user for any thrown value. */
export function toUserMessage(error: unknown): string {
  return error instanceof UserFacingError ? error.message : GENERIC_USER_MESSAGE;
}

/** How deep `cause` chains are followed; guards against cyclic causes. */
const MAX_CAUSE_DEPTH = 5;

/** Fields discord.js attaches to API/HTTP errors that are useful and safe to log. */
const HTTP_FIELDS = ['code', 'status', 'method', 'url'] as const;

/**
 * Serialises any thrown value into something a structured logger can print.
 * Never includes request bodies or headers.
 */
export function errorToLog(error: unknown, depth = 0): Record<string, unknown> {
  if (!(error instanceof Error)) return { value: error };

  const details: Record<string, unknown> = {
    name: error.name,
    message: error.message,
    stack: error.stack,
  };
  for (const field of HTTP_FIELDS) {
    if (field in error) {
      const value = (error as unknown as Record<string, unknown>)[field];
      if (typeof value === 'string' || typeof value === 'number') details[field] = value;
    }
  }
  if (error.cause !== undefined) {
    details['cause'] =
      depth < MAX_CAUSE_DEPTH ? errorToLog(error.cause, depth + 1) : '(cause chain truncated)';
  }
  return details;
}
