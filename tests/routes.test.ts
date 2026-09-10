import { describe, expect, it } from 'vitest';
import { parseGraph } from '../src/data/loader.js';
import { enumerateRoutes, type EnumerateOptions } from '../src/domain/routes.js';
import type { ServiceGraph } from '../src/domain/graph.js';

const options: EnumerateOptions = { minLength: 2, maxDepth: 32, maxRoutes: 50_000 };

const build = (edges: Record<string, string[]>, extraNodes: string[] = []): ServiceGraph => {
  const names = new Set([...Object.keys(edges), ...Object.values(edges).flat(), ...extraNodes]);
  return parseGraph({
    nodes: [...names].map((name) => ({ name, kind: 'service' })),
    edges: Object.entries(edges).map(([from, to]) => ({ from, to })),
  });
};

const pathsOf = (graph: ServiceGraph, opts = options): string[] =>
  enumerateRoutes(graph, opts)
    .routes.map((route) => route.nodes.join('>'))
    .sort();

describe('enumerateRoutes', () => {
  it('walks from every entry point to every terminal', () => {
    const graph = build({ a: ['b', 'c'], b: ['d'], c: ['d'] });
    expect(pathsOf(graph)).toEqual(['a>b>d', 'a>c>d']);
  });

  it('branches into one route per distinct path', () => {
    const graph = build({ a: ['b'], b: ['c', 'd'] });
    expect(pathsOf(graph)).toEqual(['a>b>c', 'a>b>d']);
  });

  it('omits isolated nodes, which connect nothing', () => {
    const graph = build({ a: ['b'] }, ['lonely']);
    expect(pathsOf(graph)).toEqual(['a>b']);
  });

  it('honours minLength', () => {
    const graph = build({ a: ['b'] }, ['lonely']);
    expect(pathsOf(graph, { ...options, minLength: 1 })).toEqual(['a>b', 'lonely']);
  });

  // The supplied graph is acyclic, but the enumerator must not depend on that.
  it('terminates on a cycle without repeating a node', () => {
    const graph = build({ a: ['b'], b: ['c'], c: ['b'] });
    const { routes } = enumerateRoutes(graph, options);

    expect(routes.map((r) => r.nodes)).toEqual([['a', 'b', 'c']]);
  });

  it('yields nothing for a component with no entry point', () => {
    const graph = build({ a: ['b'], b: ['a'] });
    expect(enumerateRoutes(graph, options).routes).toEqual([]);
  });

  it('flags truncation when the route cap is hit', () => {
    const graph = build({ a: ['b', 'c', 'd'] });
    const result = enumerateRoutes(graph, { ...options, maxRoutes: 2 });

    expect(result.routes).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it('flags truncation when the depth cap cuts a path short', () => {
    const graph = build({ a: ['b'], b: ['c'], c: ['d'] });
    const result = enumerateRoutes(graph, { ...options, maxDepth: 2 });

    expect(result.routes.map((r) => r.nodes)).toEqual([['a', 'b']]);
    expect(result.truncated).toBe(true);
  });
});
