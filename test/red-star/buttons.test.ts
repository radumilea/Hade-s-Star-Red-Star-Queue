import { describe, expect, test } from 'vitest';
import {
  BUTTON_ACTIONS,
  CUSTOM_ID_MAX_LENGTH,
  encodeButtonId,
  isRedStarButton,
  parseButtonId,
} from '../../src/red-star/buttons.js';

describe('button custom ids', () => {
  test('exposes exactly the join, leave, start and cancel actions', () => {
    expect([...BUTTON_ACTIONS]).toEqual(['join', 'leave', 'start', 'cancel']);
  });

  test.each(BUTTON_ACTIONS)('round-trips the %s action', (action) => {
    const id = encodeButtonId(action, 'abc-123');
    expect(id).toBe(`rs:${action}:abc-123`);
    expect(parseButtonId(id)).toEqual({ action, queueId: 'abc-123' });
    expect(isRedStarButton(id)).toBe(true);
  });

  test('a UUID queue id fits within the Discord limit', () => {
    const id = encodeButtonId('cancel', '123e4567-e89b-12d3-a456-426614174000');
    expect(id.length).toBeLessThanOrEqual(CUSTOM_ID_MAX_LENGTH);
  });

  test('refuses ids that would exceed the limit', () => {
    expect(() => encodeButtonId('join', 'x'.repeat(CUSTOM_ID_MAX_LENGTH))).toThrow(RangeError);
  });

  test('refuses queue ids that could not be parsed back', () => {
    expect(() => encodeButtonId('join', '')).toThrow(RangeError);
    expect(() => encodeButtonId('join', 'a:b')).toThrow(RangeError);
  });

  test.each([
    'other:join:abc',
    'rs:dance:abc',
    'rs:toggle:abc',
    'rs:join',
    'rs:join:',
    'rs:join:abc:extra',
    '',
    'rs',
  ])('ignores %j', (customId) => {
    expect(parseButtonId(customId)).toBeNull();
  });

  test('isRedStarButton is only a namespace check', () => {
    expect(isRedStarButton('rs:anything')).toBe(true);
    expect(isRedStarButton('poll:vote:1')).toBe(false);
  });
});
