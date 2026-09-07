import express, {
  Router,
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from 'express';
import { z } from 'zod';
import { FilterParseError } from '../domain/filters/filter.js';
import type { FilterRegistry } from '../domain/filters/registry.js';
import type { ServiceGraph } from '../domain/graph.js';
import type { RouteQueryEngine } from '../domain/routes.js';
import { toGraphPayload, toRoutesPayload } from './presenter.js';

export interface ApiDependencies {
  readonly graph: ServiceGraph;
  readonly engine: RouteQueryEngine;
  readonly registry: FilterRegistry;
}

/** Accepts `?filters=a,b` and `?filters=a&filters=b` alike. */
const filtersSchema = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) =>
    (value === undefined ? [] : Array.isArray(value) ? value : [value])
      .flatMap((entry) => entry.split(','))
      .map((entry) => entry.trim())
      .filter((entry) => entry !== ''),
  );

const routesQuerySchema = z.object({
  filters: filtersSchema,
  match: z.enum(['all', 'any']).default('all'),
});

function createApiRouter({ graph, engine, registry }: ApiDependencies): Router {
  const router = Router();

  /** Endpoint index, so the API is explorable without reading the README. */
  router.get('/', (_req, res) => {
    res.json({
      endpoints: {
        'GET /api/graph': 'The full service graph, plus any load warnings.',
        'GET /api/filters': 'Every available filter, with its arguments.',
        'GET /api/routes': 'Routes, optionally filtered. ?filters=a,b:arg&match=all|any',
      },
    });
  });

  router.get('/graph', (_req, res) => {
    res.json(toGraphPayload(graph));
  });

  /** Generated from the registry, so a new filter documents itself. */
  router.get('/filters', (_req, res) => {
    res.json({
      matchModes: ['all', 'any'],
      filters: registry.list().map(({ name, description, params }) => ({
        name,
        description,
        params: params ?? [],
      })),
    });
  });

  router.get('/routes', (req, res) => {
    const query = routesQuerySchema.safeParse(req.query);
    if (!query.success) {
      res.status(400).json({ error: 'Invalid query parameters.', details: query.error.issues });
      return;
    }

    const { filters: specs, match } = query.data;
    try {
      const filters = registry.buildAll(specs);
      const result = engine.query({ filters, match });
      res.json(toRoutesPayload(graph, result, specs, match));
    } catch (error) {
      // A bad filter name or argument is the caller's mistake, not a fault.
      if (error instanceof FilterParseError) {
        res.status(400).json({ error: error.message });
        return;
      }
      throw error;
    }
  });

  return router;
}

export function createServer(dependencies: ApiDependencies): Express {
  const app = express();

  app.use(express.json());
  app.use('/api', createApiRouter(dependencies));

  app.use((_req, res) => {
    res.status(404).json({ error: 'Not found. See GET /api for available endpoints.' });
  });

  app.use((error: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error(error);
    res.status(500).json({ error: 'Internal server error.' });
  });

  return app;
}
