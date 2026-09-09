import { describe, expect, it } from 'vitest';
import { parseGraph } from '../src/data/loader.js';
import {
  anyNode,
  endNode,
  every,
  FilterParseError,
  some,
  startNode,
  type RouteFilter,
} from '../src/domain/filters/filter.js';
import { builtInFilters } from '../src/domain/filters/definitions.js';
import { FilterRegistry } from '../src/domain/filters/registry.js';
import type { Route } from '../src/domain/types.js';

/**
 * A miniature of the real dataset: a public entry point reaching a database
 * through a vulnerable service, plus an internal-only branch that does not.
 */
const graph = parseGraph({
  nodes: [
    { name: 'frontend', kind: 'service', publicExposed: true },
    {
      name: 'order-service',
      kind: 'service',
      publicExposed: false,
      vulnerabilities: [{ file: 'x.java', severity: 'high', message: 'sqli' }],
    },
    { name: 'config-service', kind: 'service', publicExposed: false },
    { name: 'prod-postgresdb', kind: 'rds' },
  ],
  edges: [
    { from: 'frontend', to: ['order-service', 'config-service'] },
    { from: 'order-service', to: ['prod-postgresdb'] },
  ],
});

const route = (...nodes: string[]): Route => ({ nodes });
const exposedRoute = route('frontend', 'order-service', 'prod-postgresdb');
const internalRoute = route('config-service');

const registry = new FilterRegistry().registerAll(builtInFilters);
const apply = (spec: string, target: Route): boolean => registry.build(spec)(target, graph);

describe('combinators', () => {
  const isPublic = startNode((node) => node.publicExposed);

  it('startNode looks only at the first node', () => {
    expect(isPublic(exposedRoute, graph)).toBe(true);
    expect(isPublic(route('order-service', 'prod-postgresdb'), graph)).toBe(false);
  });

  it('endNode looks only at the last node', () => {
    const isRds = endNode((node) => node.kind === 'rds');
    expect(isRds(exposedRoute, graph)).toBe(true);
    expect(isRds(route('frontend', 'config-service'), graph)).toBe(false);
  });

  it('anyNode looks anywhere along the route', () => {
    const touchesOrders = anyNode((node) => node.name === 'order-service');
    expect(touchesOrders(exposedRoute, graph)).toBe(true);
    expect(touchesOrders(internalRoute, graph)).toBe(false);
  });

  const yes: RouteFilter = () => true;
  const no: RouteFilter = () => false;

  it('every requires all filters, some requires one', () => {
    expect(every([yes, no])(exposedRoute, graph)).toBe(false);
    expect(some([yes, no])(exposedRoute, graph)).toBe(true);
  });

  // This is what makes "no filters requested" mean "return everything"
  // without the query engine needing a special case for it.
  it('both are permissive on an empty filter list', () => {
    expect(every([])(exposedRoute, graph)).toBe(true);
    expect(some([])(exposedRoute, graph)).toBe(true);
  });
});

describe('built-in filters', () => {
  it('startsPublic matches a publicly exposed entry point', () => {
    expect(apply('startsPublic', exposedRoute)).toBe(true);
    expect(apply('startsPublic', internalRoute)).toBe(false);
  });

  it('endsInSink matches a route terminating in a datastore', () => {
    expect(apply('endsInSink', exposedRoute)).toBe(true);
    expect(apply('endsInSink', route('frontend', 'config-service'))).toBe(false);
  });

  it('hasVulnerability matches any vulnerable node on the route', () => {
    expect(apply('hasVulnerability', exposedRoute)).toBe(true);
    expect(apply('hasVulnerability', route('frontend', 'config-service'))).toBe(false);
  });

  it('hasVulnerability narrows by severity when given one', () => {
    expect(apply('hasVulnerability:high', exposedRoute)).toBe(true);
    expect(apply('hasVulnerability:low', exposedRoute)).toBe(false);
  });

  it('passesThrough matches an intermediate node', () => {
    expect(apply('passesThrough:order-service', exposedRoute)).toBe(true);
    expect(apply('passesThrough:config-service', exposedRoute)).toBe(false);
  });

  it('maxLength bounds the node count', () => {
    expect(apply('maxLength:3', exposedRoute)).toBe(true);
    expect(apply('maxLength:2', exposedRoute)).toBe(false);
  });
});

describe('FilterRegistry', () => {
  it('rejects an unknown filter and names the alternatives', () => {
    expect(() => registry.build('nope')).toThrow(FilterParseError);
    expect(() => registry.build('nope')).toThrow(/Available filters: /);
  });

  it('rejects a disallowed argument value', () => {
    expect(() => registry.build('hasVulnerability:catastrophic')).toThrow(FilterParseError);
  });

  it('rejects a missing required argument', () => {
    expect(() => registry.build('passesThrough')).toThrow(/requires argument "nodeName"/);
  });

  it('rejects a non-numeric maxLength', () => {
    expect(() => registry.build('maxLength:abc')).toThrow(FilterParseError);
  });

  it('rejects more arguments than the filter declares', () => {
    expect(() => registry.build('startsPublic:extra')).toThrow(/at most 0 argument/);
  });

  it('refuses duplicate registrations', () => {
    expect(() => new FilterRegistry().registerAll([...builtInFilters, ...builtInFilters])).toThrow(
      /Duplicate filter name/,
    );
  });

  it('lists every filter for the self-documenting endpoint', () => {
    expect(registry.list().map((d) => d.name)).toEqual([
      'endsInSink',
      'hasVulnerability',
      'maxLength',
      'passesThrough',
      'startsPublic',
    ]);
  });
});
