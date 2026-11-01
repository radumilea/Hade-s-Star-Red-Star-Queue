import { GuildMember } from 'discord.js';
import { describe, expect, test } from 'vitest';
import { displayNameOf } from '../../src/discord/display-name.js';

const user = { displayName: 'Global' };

describe('displayNameOf', () => {
  test('prefers the cached member nickname', () => {
    const member = Object.create(GuildMember.prototype) as GuildMember;
    Object.defineProperty(member, 'displayName', { value: 'Nick' });
    expect(displayNameOf({ member, user })).toBe('Nick');
  });

  test('uses a raw API nick when the member is not cached', () => {
    expect(displayNameOf({ member: { nick: 'Raw' }, user })).toBe('Raw');
  });

  test('falls back to the global display name', () => {
    expect(displayNameOf({ member: null, user })).toBe('Global');
    expect(displayNameOf({ member: { nick: null }, user })).toBe('Global');
    expect(displayNameOf({ member: { nick: '' }, user })).toBe('Global');
    expect(displayNameOf({ member: {}, user })).toBe('Global');
  });
});
