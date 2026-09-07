import { fileURLToPath } from 'node:url';
import type { EnumerateOptions } from './domain/routes.js';

export interface AppConfig {
  readonly port: number;
  readonly dataFile: string;
  readonly enumeration: EnumerateOptions;
}

const defaultDataFile = fileURLToPath(new URL('../data/train-ticket.json', import.meta.url));

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return {
    port: toInt(env['PORT'], 3000),
    dataFile: env['DATA_FILE'] ?? defaultDataFile,
    enumeration: {
      // A single node is not a route "between services".
      minLength: toInt(env['MIN_ROUTE_LENGTH'], 2),
      // Guards, not limits: the supplied graph is nowhere near either.
      maxDepth: toInt(env['MAX_ROUTE_DEPTH'], 32),
      maxRoutes: toInt(env['MAX_ROUTES'], 50_000),
    },
  };
}
