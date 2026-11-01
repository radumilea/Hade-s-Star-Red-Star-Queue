import type { RuntimeConfig } from './config.js';
import type { Logger } from './logger.js';
import type { RedStarService } from './red-star/service.js';

/** Everything a command or event handler needs; built once at startup. Holds no secrets. */
export interface AppContext {
  readonly config: RuntimeConfig;
  readonly logger: Logger;
  readonly redStar: RedStarService;
}
