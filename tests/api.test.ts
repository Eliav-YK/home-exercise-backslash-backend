import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/api/server.js';
import { loadConfig } from '../src/config.js';
import { loadGraphFromFile } from '../src/data/loader.js';
import { builtInFilters } from '../src/domain/filters/definitions.js';
import { FilterRegistry } from '../src/domain/filters/registry.js';
import { RouteQueryEngine } from '../src/domain/routes.js';
import type { Express } from 'express';

/**
 * End-to-end against the real train-ticket dataset. The counts below were
 * derived from the data itself and are asserted deliberately: they are the
 * regression net for the loader, the enumerator and the filters at once.
 */
let app: Express;

beforeAll(() => {
  const config = loadConfig({});
  const graph = loadGraphFromFile(config.dataFile);
  app = createServer({
    graph,
    engine: new RouteQueryEngine(graph, config.enumeration),
    registry: new FilterRegistry().registerAll(builtInFilters),
  });
});

const routes = (query = ''): request.Test => request(app).get(`/api/routes${query}`);

describe('GET /api/graph', () => {
  it('returns the whole graph as flat nodes and edges', async () => {
    const { status, body } = await request(app).get('/api/graph');

    expect(status).toBe(200);
    expect(body.nodes).toHaveLength(46);
    expect(body.edges).toHaveLength(96);
    expect(body.edges[0]).toEqual({ from: 'frontend', to: 'admin-basic-info-service' });
  });

  it('reports the dataset\u2019s two dangling references rather than hiding them', async () => {
    const { body } = await request(app).get('/api/graph');

    expect(body.warnings).toHaveLength(2);
    expect(body.warnings.every((w: { code: string }) => w.code === 'DANGLING_EDGE_TARGET')).toBe(true);
    expect(body.warnings[0].message).toContain('assurance-service');
  });
});

describe('GET /api/filters', () => {
  it('documents every registered filter, arguments included', async () => {
    const { status, body } = await request(app).get('/api/filters');

    expect(status).toBe(200);
    expect(body.filters.map((f: { name: string }) => f.name)).toContain('startsPublic');
    const vuln = body.filters.find((f: { name: string }) => f.name === 'hasVulnerability');
    expect(vuln.params[0].name).toBe('severity');
    expect(vuln.params[0].description).toContain('critical');
  });
});

describe('GET /api/routes', () => {
  it('returns every route when no filter is given', async () => {
    const { status, body } = await request(app).get('/api/routes');

    expect(status).toBe(200);
    expect(body.meta).toMatchObject({ totalRoutes: 215, matchedRoutes: 215, truncated: false });
  });

  it('returns a render-ready sub-graph alongside the matched routes', async () => {
    const { body } = await routes('?filters=startsPublic');

    expect(body.meta.matchedRoutes).toBe(5);
    expect(body.nodes.map((n: { name: string }) => n.name)).toContain('frontend');
    expect(body.edges).toContainEqual({ from: 'frontend', to: 'admin-basic-info-service' });
    // Every node named by a route is present in the payload, exactly once.
    const named = new Set(body.routes.flatMap((r: { nodes: string[] }) => r.nodes));
    expect(body.nodes).toHaveLength(named.size);
  });

  it('filters routes ending in a data sink', async () => {
    const { body } = await routes('?filters=endsInSink');
    expect(body.meta.matchedRoutes).toBe(33);
  });

  it('filters routes touching a vulnerable node', async () => {
    const { body } = await routes('?filters=hasVulnerability');
    expect(body.meta.matchedRoutes).toBe(60);
  });

  it('narrows by vulnerability severity', async () => {
    const high = await routes('?filters=hasVulnerability:high');
    const medium = await routes('?filters=hasVulnerability:medium');

    expect(high.body.meta.matchedRoutes).toBeLessThan(medium.body.meta.matchedRoutes);
  });

  /**
   * The headline combination is genuinely empty on this dataset: the only
   * reachable public entry point is `frontend`, whose sub-tree never touches
   * a datastore. Asserted so the emptiness stays a known property of the data
   * rather than looking like a bug in the filters.
   */
  it('combines filters with AND by default, and this pairing has no matches', async () => {
    const { body } = await routes('?filters=startsPublic,endsInSink');

    expect(body.meta).toMatchObject({ matchedRoutes: 0, match: 'all', totalRoutes: 215 });
    expect(body.nodes).toEqual([]);
    expect(body.edges).toEqual([]);
  });

  it('combines filters with OR when match=any', async () => {
    const { body } = await routes('?filters=startsPublic,endsInSink&match=any');
    expect(body.meta.matchedRoutes).toBe(38);
  });

  it('accepts repeated filter parameters as well as a comma list', async () => {
    const comma = await routes('?filters=startsPublic,maxLength:3');
    const repeated = await routes('?filters=startsPublic&filters=maxLength:3');

    expect(repeated.body.meta.matchedRoutes).toBe(comma.body.meta.matchedRoutes);
  });

  it('rejects an unknown filter with 400 and a helpful message', async () => {
    const { status, body } = await routes('?filters=doesNotExist');

    expect(status).toBe(400);
    expect(body.error).toMatch(/Unknown filter "doesNotExist"/);
  });

  // Argument validation moved into each filter's own build; this proves it
  // still reaches the caller as a 400 rather than a 500.
  it('rejects an invalid filter argument with 400', async () => {
    const { status, body } = await routes('?filters=hasVulnerability:catastrophic');

    expect(status).toBe(400);
    expect(body.error).toMatch(/Invalid severity/);
  });

  it('rejects an invalid match mode with 400', async () => {
    const { status } = await routes('?match=maybe');
    expect(status).toBe(400);
  });
});

describe('unknown endpoints', () => {
  it('answers 404 with a pointer to the index', async () => {
    const { status, body } = await request(app).get('/api/nope');
    expect(status).toBe(404);
    expect(body.error).toContain('/api');
  });
});
