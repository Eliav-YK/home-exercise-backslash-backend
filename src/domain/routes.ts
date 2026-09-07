import { every, some, type RouteFilter } from './filters/filter.js';
import type { ServiceGraph } from './graph.js';
import type { Route } from './types.js';

export interface EnumerateOptions {
  /** Shortest path worth calling a route. Default 2 — a route connects things. */
  readonly minLength: number;
  /** Hard ceiling on path length, as a guard against pathological graphs. */
  readonly maxDepth: number;
  /** Hard ceiling on how many routes we will produce. */
  readonly maxRoutes: number;
}

export interface EnumerationResult {
  readonly routes: readonly Route[];
  /** True when a cap was hit and the result is a partial view of the graph. */
  readonly truncated: boolean;
}

/**
 * Enumerate every maximal simple path through the graph.
 *
 * A *route* is a complete flow: it begins at an entry point (nothing points at
 * it) and runs until it can go no further. That is the reading the filters
 * imply — "starts in a public service", "ends in a sink" only mean something
 * if a route has real endpoints.
 *
 * *Simple* means no node repeats. The supplied dataset is acyclic, but relying
 * on that would make this function a landmine the first time someone adds a
 * feedback edge, so the visited set is unconditional.
 *
 * Path enumeration is exponential in the general case. The dataset produces a
 * few hundred routes, but `maxDepth` and `maxRoutes` keep a hostile or evolved
 * graph from taking the process down; hitting either sets `truncated`.
 */
export function enumerateRoutes(
  graph: ServiceGraph,
  options: EnumerateOptions,
): EnumerationResult {
  const routes: Route[] = [];
  const path: string[] = [];
  const visited = new Set<string>();
  let truncated = false;

  const visit = (name: string): void => {
    if (routes.length >= options.maxRoutes) {
      truncated = true;
      return;
    }

    path.push(name);
    visited.add(name);

    // Only successors we can actually walk to: revisiting one would make the
    // path non-simple, so it does not count as a way to extend this route.
    const extensions =
      path.length < options.maxDepth
        ? graph.successors(name).filter((next) => !visited.has(next))
        : [];

    if (extensions.length === 0) {
      if (path.length >= options.minLength) {
        routes.push({ nodes: [...path] });
      }
      if (graph.successors(name).length > 0 && path.length >= options.maxDepth) {
        truncated = true;
      }
    } else {
      for (const next of extensions) {
        visit(next);
      }
    }

    visited.delete(name);
    path.pop();
  };

  for (const entry of graph.entryPoints()) {
    visit(entry.name);
  }

  return { routes, truncated };
}

export type MatchMode = 'all' | 'any';

export interface RouteQuery {
  readonly filters: readonly RouteFilter[];
  readonly match: MatchMode;
}

export interface RouteQueryResult {
  readonly routes: readonly Route[];
  /** How many routes exist before filtering — context for `routes.length`. */
  readonly totalRoutes: number;
  readonly truncated: boolean;
}

/**
 * Answers route queries against one graph.
 *
 * The graph is immutable, so the route set is enumerated **once** in the
 * constructor and every request is then a linear pass over it. That keeps the
 * expensive part out of the request path and makes filter cost the only thing
 * a query pays for.
 */
export class RouteQueryEngine {
  private readonly allRoutes: readonly Route[];
  private readonly truncated: boolean;

  constructor(
    private readonly graph: ServiceGraph,
    options: EnumerateOptions,
  ) {
    const { routes, truncated } = enumerateRoutes(graph, options);
    this.allRoutes = routes;
    this.truncated = truncated;
  }

  query({ filters, match }: RouteQuery): RouteQueryResult {
    const predicate = match === 'any' ? some(filters) : every(filters);
    return {
      routes: this.allRoutes.filter((route) => predicate(route, this.graph)),
      totalRoutes: this.allRoutes.length,
      truncated: this.truncated,
    };
  }
}
