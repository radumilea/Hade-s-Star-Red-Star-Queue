/**
 * Encoding of button custom ids. Discord limits custom ids to 100 characters;
 * a UUID queue id plus the prefix and action stays well under that.
 */

export const BUTTON_NAMESPACE = 'rs';
export const CUSTOM_ID_MAX_LENGTH = 100;
const SEPARATOR = ':';

export const BUTTON_ACTIONS = ['join', 'leave', 'start', 'cancel'] as const;
export type ButtonAction = (typeof BUTTON_ACTIONS)[number];

export interface ParsedButtonId {
  readonly action: ButtonAction;
  readonly queueId: string;
}

function isButtonAction(value: string): value is ButtonAction {
  return (BUTTON_ACTIONS as readonly string[]).includes(value);
}

export function encodeButtonId(action: ButtonAction, queueId: string): string {
  if (queueId.length === 0 || queueId.includes(SEPARATOR)) {
    throw new RangeError(`Queue id must be non-empty and must not contain "${SEPARATOR}"`);
  }
  const id = [BUTTON_NAMESPACE, action, queueId].join(SEPARATOR);
  if (id.length > CUSTOM_ID_MAX_LENGTH) {
    throw new RangeError(`Button custom id exceeds ${CUSTOM_ID_MAX_LENGTH} characters: ${id}`);
  }
  return id;
}

/** Returns null for ids that do not belong to this feature. */
export function parseButtonId(customId: string): ParsedButtonId | null {
  const [namespace, action, queueId, ...rest] = customId.split(SEPARATOR);
  if (namespace !== BUTTON_NAMESPACE || rest.length > 0) return null;
  if (action === undefined || !isButtonAction(action)) return null;
  if (queueId === undefined || queueId.length === 0) return null;
  return { action, queueId };
}

/** Whether a custom id was minted by this feature (cheap pre-check before parsing). */
export function isRedStarButton(customId: string): boolean {
  return customId.startsWith(`${BUTTON_NAMESPACE}${SEPARATOR}`);
}
