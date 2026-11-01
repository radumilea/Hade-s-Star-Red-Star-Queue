import { Routes } from 'discord.js';
import { describe, expect, test, vi } from 'vitest';
import { createCommands } from '../../src/commands/registry.js';
import { ConfigError } from '../../src/config.js';
import { deployCommands } from '../../src/discord/deploy-commands.js';
import { silentLogger } from '../fakes.js';

function fakeRest() {
  return { put: vi.fn(async (_route: unknown, _options: unknown) => []) };
}

describe('deployCommands', () => {
  test('PUTs the full command set to the guild route when a guild id is set', async () => {
    const rest = fakeRest();
    const result = await deployCommands({
      rest,
      logger: silentLogger(),
      clientId: 'app',
      guildId: 'g1',
    });
    expect(rest.put).toHaveBeenCalledWith(Routes.applicationGuildCommands('app', 'g1'), {
      body: createCommands().map((c) => c.toJSON()),
    });
    expect(result.scope).toBe('guild');
    const names = result.commands.map((c) => c.name);
    expect(names).toHaveLength(19);
    expect(names.slice(0, 2)).toEqual(['rs', 'rs3']);
    expect(names).toContain('drs9');
    expect(names.at(-1)).toBe('help');
  });

  test('PUTs globally without a guild id', async () => {
    const rest = fakeRest();
    const result = await deployCommands({
      rest,
      logger: silentLogger(),
      clientId: 'app',
      guildId: undefined,
    });
    expect(rest.put).toHaveBeenCalledWith(Routes.applicationCommands('app'), expect.anything());
    expect(result.scope).toBe('global');
  });

  test('refuses to run without an application id', async () => {
    const rest = fakeRest();
    await expect(
      deployCommands({ rest, logger: silentLogger(), clientId: undefined, guildId: 'g1' }),
    ).rejects.toThrow(ConfigError);
    expect(rest.put).not.toHaveBeenCalled();
  });

  test('clearGuild removes the guild set and deploys nothing', async () => {
    const rest = fakeRest();
    const result = await deployCommands({
      rest,
      logger: silentLogger(),
      clientId: 'app',
      guildId: 'g1',
      clearGuild: true,
    });
    expect(rest.put).toHaveBeenCalledWith(Routes.applicationGuildCommands('app', 'g1'), {
      body: [],
    });
    expect(result).toEqual({ scope: 'guild-cleared', commands: [] });
    await expect(
      deployCommands({
        rest,
        logger: silentLogger(),
        clientId: 'app',
        guildId: undefined,
        clearGuild: true,
      }),
    ).rejects.toThrow(ConfigError);
  });

  test('logs what was deployed', async () => {
    const logger = silentLogger();
    const info = vi.spyOn(logger, 'info');
    await deployCommands({ rest: fakeRest(), logger, clientId: 'app', guildId: undefined });
    expect(info).toHaveBeenCalledWith(
      expect.objectContaining({
        count: 19,
        scope: 'global',
        names: createCommands().map((c) => c.name),
      }),
      'Slash commands deployed',
    );
  });
});
