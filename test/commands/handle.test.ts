import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { legacyCommandsNotice } from '../../src/commands/help.js';
import {
  LEGACY_NOTICE_TTL_MS,
  createPrefixMessageHandler,
} from '../../src/commands/prefix/handle.js';
import { temporaryMarker } from '../../src/discord/replies.js';
import { makeContext, makeDiscordMessage } from '../fakes.js';

const NOTICE = `${legacyCommandsNotice()}\n${temporaryMarker(LEGACY_NOTICE_TTL_MS)}`;

function setup(now = () => 0) {
  const context = makeContext();
  return { ...context, handle: createPrefixMessageHandler(context.ctx, { now }) };
}

describe('legacy text commands', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test('ignores bots, non-commands and unknown commands', async () => {
    const { handle, registry } = setup();
    for (const content of ['hello', '!nope', '!rs2', 'rs7', '']) {
      const { message, raw } = makeDiscordMessage({ content });
      await handle(message);
      expect(raw.reply).not.toHaveBeenCalled();
    }
    const bot = makeDiscordMessage({ content: '!rs7', bot: true });
    await handle(bot.message);
    expect(bot.raw.reply).not.toHaveBeenCalled();
    expect(registry.size).toBe(0);
  });

  test.each(['!rs7', '!rsd7', '!curcubeu', '!curcubeu RS 7', '!curcubeu RS abc', '!curcubeu WS'])(
    '%s answers publicly with the slash command notice and starts nothing',
    async (content) => {
      const { handle, registry } = setup();
      const { message, raw, replyDelete } = makeDiscordMessage({ content });
      await handle(message);

      expect(registry.size).toBe(0);
      expect(raw.reply).toHaveBeenCalledTimes(1);
      expect(raw.reply).toHaveBeenCalledWith(NOTICE);

      // the notice is temporary; the user message stays
      await vi.advanceTimersByTimeAsync(LEGACY_NOTICE_TTL_MS - 1);
      expect(replyDelete).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(replyDelete).toHaveBeenCalledTimes(1);
      expect(raw.delete).not.toHaveBeenCalled();
    },
  );

  test('the notice is posted at most once per channel while the previous one is visible', async () => {
    let now = 0;
    const { handle } = setup(() => now);
    const first = makeDiscordMessage({ content: '!rs7', channelId: 'a' });
    const second = makeDiscordMessage({ content: '!rsd9', channelId: 'a' });
    const elsewhere = makeDiscordMessage({ content: '!rs7', channelId: 'b' });

    await handle(first.message);
    now += 1_000;
    await handle(second.message);
    await handle(elsewhere.message);
    expect(first.raw.reply).toHaveBeenCalledTimes(1);
    expect(second.raw.reply).not.toHaveBeenCalled();
    expect(elsewhere.raw.reply).toHaveBeenCalledTimes(1);

    now += LEGACY_NOTICE_TTL_MS;
    const later = makeDiscordMessage({ content: '!rs7', channelId: 'a' });
    await handle(later.message);
    expect(later.raw.reply).toHaveBeenCalledTimes(1);
  });

  test('the notice lists the slash commands', () => {
    const notice = legacyCommandsNotice();
    expect(notice).toContain('/rs level:<3-12>');
    expect(notice).toContain('/drs level:<7-12>');
    expect(notice).toContain('/help');
    expect(notice).not.toContain('!rs');
  });
});
