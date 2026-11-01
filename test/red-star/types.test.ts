import { describe, expect, test } from 'vitest';
import {
  RED_STAR_TYPES,
  RS_STAR_TYPE,
  isValidRedStarLevel,
  levelRangeText,
} from '../../src/red-star/types.js';

describe('red star types', () => {
  test('classic takes 4 players from level 3; dark takes 3 from level 7', () => {
    expect(RS_STAR_TYPE.classic).toMatchObject({
      maxPlayers: 4,
      minLevel: 3,
      maxLevel: 12,
      label: 'RS',
      commandName: 'rs',
    });
    expect(RS_STAR_TYPE.dark).toMatchObject({
      maxPlayers: 3,
      minLevel: 7,
      maxLevel: 12,
      label: 'Dark RS',
      commandName: 'drs',
    });
  });

  test('every type has a distinct command name and a sane level range', () => {
    const names = RED_STAR_TYPES.map((type) => RS_STAR_TYPE[type].commandName);
    expect(new Set(names).size).toBe(names.length);
    for (const type of RED_STAR_TYPES) {
      expect(RS_STAR_TYPE[type].minLevel).toBeLessThanOrEqual(RS_STAR_TYPE[type].maxLevel);
    }
  });
});

describe('isValidRedStarLevel', () => {
  test.each([3, 7, 12])('classic accepts %i', (level) => {
    expect(isValidRedStarLevel(level, 'classic')).toBe(true);
  });

  test.each([7, 10, 12])('dark accepts %i', (level) => {
    expect(isValidRedStarLevel(level, 'dark')).toBe(true);
  });

  test.each([3, 4, 5, 6])('dark rejects %i (too low for a dark red star)', (level) => {
    expect(isValidRedStarLevel(level, 'dark')).toBe(false);
  });

  test.each([2, 13, 0, -3, 7.5, NaN, Infinity, '7', null, undefined])('rejects %p', (level) => {
    expect(isValidRedStarLevel(level, 'classic')).toBe(false);
    expect(isValidRedStarLevel(level, 'dark')).toBe(false);
  });

  test('levelRangeText follows the type', () => {
    expect(levelRangeText('classic')).toBe('3-12');
    expect(levelRangeText('dark')).toBe('7-12');
  });
});
