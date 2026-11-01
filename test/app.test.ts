import { EventEmitter } from 'node:events';
import { Events, type Client } from 'discord.js';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { createSilentLogger } from '../src/logger.js';
import { FakeClient, TEST_CONFIG, makeChannel, type FakeMessage } from './fakes.js';

const CONFIG: AppConfig = { ...TEST_CONFIG, token: 'secret-token' };

function build(overrides: Partial<AppConfig> = {}) {
  const client = new FakeClient();
  const createClient = vi.fn(() => client as unknown as Client);
  const exit = vi.fn();
  const fakeProcess = new EventEmitter();
  const logger = createSilentLogger();
  const app = createApp({
    config: { ...CONFIG, ...overrides },
    logger,
    createClient,
    exit,
    process: fakeProcess as unknown as NodeJS.Process,
  });
  return { app, client, createClient, exit, fakeProcess, logger };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('createApp', () => {
  test('builds the client from the config and keeps the token out of the context', () => {
    const { app, createClient } = build({ legacyTextCommands: false });
    expect(createClient).toHaveBeenCalledWith({ legacyTextCommands: false });
    expect(app.context.config).not.toHaveProperty('token');
    expect(JSON.stringify(app.context.config)).not.toContain('secret-token');
  });

  test('start logs in with the token', async () => {
    const { app, client } = build();
    await app.start();
    expect(client.login).toHaveBeenCalledWith('secret-token');
    expect(client.destroy).not.toHaveBeenCalled();
  });

  test('a failed login destroys the client and rethrows', async () => {
    const { app, client, logger } = build();
    const fatal = vi.spyOn(logger, 'fatal');
    client.login.mockRejectedValueOnce(new Error('bad token'));
    await expect(app.start()).rejects.toThrow('bad token');
    expect(client.destroy).toHaveBeenCalledTimes(1);
    expect(fatal).toHaveBeenCalledWith(expect.anything(), 'Could not log in to Discord');
  });

  test('shutdown closes open queues before destroying the client, then exits', async () => {
    const { app, client, exit } = build();
    const channel = makeChannel();
    const { message } = await app.context.redStar.openQueue({
      ownerId: 'o',
      displayName: 'O',
      level: 7,
      type: 'classic',
      channel,
    });
    const order: string[] = [];
    (message as FakeMessage).edit.mockImplementation(async () => {
      order.push('closeQueue');
    });
    client.destroy.mockImplementation(async () => {
      order.push('destroy');
    });

    await app.shutdown('SIGTERM');
    expect(order).toEqual(['closeQueue', 'destroy']);
    expect(exit).toHaveBeenCalledWith(0);
  });

  test('process signals reach the shutdown routine', async () => {
    const { client, exit, fakeProcess } = build();
    fakeProcess.emit('SIGTERM');
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(client.destroy).toHaveBeenCalled();
  });

  test('with DEV_SHUTDOWN_PORT, a POST to the loopback endpoint runs the shutdown', async () => {
    vi.useRealTimers();
    const { app, client, exit, logger } = build({ devShutdownPort: 0 });
    const info = vi.spyOn(logger, 'info');
    await app.start();
    const call = info.mock.calls.find(
      ([, message]) => message === 'Dev shutdown endpoint listening',
    );
    const { port } = call?.[0] as { port: number };
    expect(port).toBeGreaterThan(0);

    const response = await fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST' });
    expect(response.status).toBe(202);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(0));
    expect(client.destroy).toHaveBeenCalled();
    // the endpoint is closed as part of the shutdown
    await expect(fetch(`http://127.0.0.1:${port}/shutdown`, { method: 'POST' })).rejects.toThrow();
  });

  test('without DEV_SHUTDOWN_PORT no endpoint is opened', async () => {
    const { app, logger } = build();
    const info = vi.spyOn(logger, 'info');
    await app.start();
    expect(info).not.toHaveBeenCalledWith(expect.anything(), 'Dev shutdown endpoint listening');
  });

  test('a final shard disconnect shuts the bot down with exit code 1', async () => {
    const { client, exit } = build();
    client.emit(Events.ShardDisconnect, { code: 4014 }, 0);
    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
  });
});
