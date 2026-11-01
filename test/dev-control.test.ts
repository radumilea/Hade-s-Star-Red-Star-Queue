import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  DEV_CONTROL_HOST,
  SHUTDOWN_PATH,
  SHUTDOWN_REASON,
  startDevControl,
  type DevControl,
} from '../src/dev-control.js';
import { createSilentLogger } from '../src/logger.js';

let control: DevControl | undefined;

afterEach(async () => {
  await control?.close();
  control = undefined;
});

async function start() {
  const shutdown = vi.fn(async (_reason: string, _code?: number) => undefined);
  const logger = createSilentLogger();
  const info = vi.spyOn(logger, 'info');
  control = await startDevControl({ port: 0, logger, shutdown });
  const base = `http://${DEV_CONTROL_HOST}:${control.port}`;
  return { control, shutdown, info, base };
}

describe('dev control endpoint', () => {
  test('listens on loopback on a free port and says so', async () => {
    const { control: started, info } = await start();
    expect(started.port).toBeGreaterThan(0);
    expect(info).toHaveBeenCalledWith({ port: started.port }, 'Dev shutdown endpoint listening');
  });

  test('POST /shutdown answers 202 and runs the shutdown routine', async () => {
    const { shutdown, base } = await start();
    const response = await fetch(`${base}${SHUTDOWN_PATH}`, { method: 'POST' });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ status: 'shutting down' });
    expect(shutdown).toHaveBeenCalledWith(SHUTDOWN_REASON);
  });

  test('anything else is a 404 and does nothing', async () => {
    const { shutdown, base } = await start();
    expect((await fetch(`${base}${SHUTDOWN_PATH}`)).status).toBe(404);
    expect((await fetch(`${base}/other`, { method: 'POST' })).status).toBe(404);
    expect(shutdown).not.toHaveBeenCalled();
  });

  test('requests coming from a browser page are refused', async () => {
    const { shutdown, base } = await start();
    const response = await fetch(`${base}${SHUTDOWN_PATH}`, {
      method: 'POST',
      headers: { origin: 'http://evil.example' },
    });
    expect(response.status).toBe(403);
    expect(shutdown).not.toHaveBeenCalled();
  });

  test('a second shutdown request is answered with 409', async () => {
    const { shutdown, base } = await start();
    expect((await fetch(`${base}${SHUTDOWN_PATH}`, { method: 'POST' })).status).toBe(202);
    expect((await fetch(`${base}${SHUTDOWN_PATH}`, { method: 'POST' })).status).toBe(409);
    expect(shutdown).toHaveBeenCalledTimes(1);
  });

  test('close() stops listening', async () => {
    const { control: started, base } = await start();
    await started.close();
    control = undefined;
    await expect(fetch(`${base}${SHUTDOWN_PATH}`, { method: 'POST' })).rejects.toThrow();
  });

  test('a port that is taken fails to start', async () => {
    const { control: started } = await start();
    await expect(
      startDevControl({ port: started.port, logger: createSilentLogger(), shutdown: vi.fn() }),
    ).rejects.toThrow();
  });
});
