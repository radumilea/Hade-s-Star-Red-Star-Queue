import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Shutdown } from './lifecycle.js';
import type { Logger } from './logger.js';

/**
 * Local-development control endpoint. Windows cannot deliver SIGTERM to another
 * console process, so a developer restarting the bot would have to kill it and
 * skip the graceful shutdown (open queues closed on their cards, client logged
 * out). With `DEV_SHUTDOWN_PORT` set, `POST /shutdown` on 127.0.0.1 runs the
 * very same shutdown routine a signal would. Never enabled in production.
 */

export const DEV_CONTROL_HOST = '127.0.0.1';
export const SHUTDOWN_PATH = '/shutdown';
export const SHUTDOWN_REASON = 'dev control';

export interface DevControlDeps {
  /** 0 picks a free port; the actual one is reported in the result. */
  readonly port: number;
  readonly logger: Logger;
  readonly shutdown: Shutdown;
}

export interface DevControl {
  readonly port: number;
  close(): Promise<void>;
}

export async function startDevControl(deps: DevControlDeps): Promise<DevControl> {
  let requested = false;
  const server: Server = createServer((request, response) => {
    const json = (status: number, body: Record<string, string>): void => {
      response.writeHead(status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(body));
    };
    // a web page open in the developer's browser could POST here; only tools may
    if (request.headers.origin !== undefined) {
      json(403, { error: 'browser requests are not accepted' });
      return;
    }
    if (request.method !== 'POST' || request.url !== SHUTDOWN_PATH) {
      json(404, { error: `use POST ${SHUTDOWN_PATH}` });
      return;
    }
    if (requested) {
      json(409, { status: 'already shutting down' });
      return;
    }
    requested = true;
    json(202, { status: 'shutting down' });
    deps.logger.info('Shutdown requested through the dev control endpoint');
    void deps.shutdown(SHUTDOWN_REASON);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(deps.port, DEV_CONTROL_HOST, () => {
      server.off('error', reject);
      // a later socket error must not become an uncaught exception
      server.on('error', (error) => deps.logger.warn({ err: error }, 'Dev control server error'));
      resolve();
    });
  });
  const { port } = server.address() as AddressInfo;
  deps.logger.info({ port }, 'Dev shutdown endpoint listening');

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        // keep-alive connections would otherwise delay close() until they time out
        server.closeAllConnections();
      }),
  };
}
