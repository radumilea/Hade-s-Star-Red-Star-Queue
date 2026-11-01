import { describe, expect, test } from 'vitest';
import { parsePrefixCommand } from '../../src/commands/prefix/parse.js';

const parse = (content: string) => parsePrefixCommand(content, '!');

describe('quick search shortcuts', () => {
  test.each([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])('!rs%i → classic', (level) => {
    expect(parse(`!rs${level}`)).toEqual({ kind: 'redStar', level, type: 'classic' });
  });

  test.each([7, 8, 9, 10, 11, 12])('!rsd%i → dark', (level) => {
    expect(parse(`!rsd${level}`)).toEqual({ kind: 'redStar', level, type: 'dark' });
  });

  test('is case-insensitive', () => {
    expect(parse('!RS7')).toEqual({ kind: 'redStar', level: 7, type: 'classic' });
    expect(parse('!Rs7')).toEqual({ kind: 'redStar', level: 7, type: 'classic' });
    expect(parse('!RSD7')).toEqual({ kind: 'redStar', level: 7, type: 'dark' });
    expect(parse('!Rsd7')).toEqual({ kind: 'redStar', level: 7, type: 'dark' });
  });

  test('tolerates trailing whitespace', () => {
    expect(parse('!rs7  ')).toEqual({ kind: 'redStar', level: 7, type: 'classic' });
    expect(parse('!rsd7 ')).toEqual({ kind: 'redStar', level: 7, type: 'dark' });
  });

  test('!rsd is never mistaken for a classic !rs', () => {
    expect(parse('!rsd7')).toMatchObject({ type: 'dark' });
    expect(parse('!rs4')).toMatchObject({ type: 'classic' });
  });

  test.each([
    '!rs',
    '!rsd',
    '!rs2',
    '!rsd2',
    '!rsd3',
    '!rsd6',
    '!rs13',
    '!rsd13',
    '!rs0',
    '!rsx',
    '!rsdx',
    '!rs7extra',
    '!rsd7extra',
    '!rs77777',
    '!r7',
    '!xyz',
    '!',
    '!rs 7',
    '!rsd 7',
  ])('%s is ignored silently', (content) => {
    expect(parse(content)).toBeNull();
  });
});

describe('!curcubeu long form', () => {
  test('no arguments → help', () => {
    expect(parse('!curcubeu')).toEqual({ kind: 'help' });
    expect(parse('!curcubeu   ')).toEqual({ kind: 'help' });
  });

  test.each([3, 7, 12])('RS %i → classic', (level) => {
    expect(parse(`!curcubeu RS ${level}`)).toEqual({ kind: 'redStar', level, type: 'classic' });
  });

  test.each([7, 10, 12])('RSD %i → dark', (level) => {
    expect(parse(`!curcubeu RSD ${level}`)).toEqual({ kind: 'redStar', level, type: 'dark' });
  });

  test('mode is case-insensitive and extra spaces are fine', () => {
    expect(parse('!curcubeu rs 7')).toEqual({ kind: 'redStar', level: 7, type: 'classic' });
    expect(parse('!curcubeu   rsd   7')).toEqual({ kind: 'redStar', level: 7, type: 'dark' });
  });

  test.each([
    ['!curcubeu RS', 'classic'],
    ['!curcubeu RS abc', 'classic'],
    ['!curcubeu RS 2', 'classic'],
    ['!curcubeu RS 13', 'classic'],
    ['!curcubeu RSD', 'dark'],
    ['!curcubeu rsd 99', 'dark'],
    ['!curcubeu RSD 3', 'dark'],
    ['!curcubeu RSD 6', 'dark'],
  ])('%s → invalid level', (content, type) => {
    expect(parse(content)).toEqual({ kind: 'invalidLevel', type });
  });

  test('unknown modes, including the removed WS, → invalid mode', () => {
    expect(parse('!curcubeu XX')).toEqual({ kind: 'invalidMode', mode: 'XX' });
    expect(parse('!curcubeu WS 2026-01-01')).toEqual({ kind: 'invalidMode', mode: 'WS' });
    expect(parse('!curcubeu RSX 7')).toEqual({ kind: 'invalidMode', mode: 'RSX' });
  });

  test('the command name itself is case-sensitive, as before', () => {
    expect(parse('!CURCUBEU RS 7')).toBeNull();
  });
});

describe('non-commands and prefixes', () => {
  test.each(['hello', 'rs7', 'curcubeu RS 7', '', ' !rs7'])('%j → null', (content) => {
    expect(parse(content)).toBeNull();
  });

  test('honours a custom prefix', () => {
    expect(parsePrefixCommand('?rs7', '?')).toEqual({ kind: 'redStar', level: 7, type: 'classic' });
    expect(parsePrefixCommand('!rs7', '?')).toBeNull();
    expect(parsePrefixCommand('$$curcubeu', '$$')).toEqual({ kind: 'help' });
  });
});
