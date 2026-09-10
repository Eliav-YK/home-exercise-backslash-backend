import { every, some, type RouteFilter } from './filters/filter.js';
import type { ServiceGraph } from './graph.js';
import type { Route } from './types.js';

export interface EnumerateOptions {
  readonly minLength: number;
  readonly maxDepth: number;
  readonly maxRoutes: number;
}

export interface EnumerationResult {
  readonly routes: readonly Route[];
  //true when a cap was hit and the result is a partial view of the graph.
  readonly truncated: boolean;
}

export function enumerateRoutes(graph: ServiceGraph, options: EnumerateOptions): EnumerationResult {
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
  readonly totalRoutes: number;
  readonly truncated: boolean;
}


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
