import type { RouteQueryResult } from '../domain/routes.js';
import type { ServiceGraph } from '../domain/graph.js';
import type { GraphEdge, GraphNode, LoadWarning } from '../domain/types.js';

export interface GraphPayload {
  readonly nodes: readonly GraphNode[];
  readonly edges: readonly GraphEdge[];
}

export interface RoutesPayload extends GraphPayload {
  readonly routes: readonly { readonly id: string; readonly nodes: readonly string[] }[];
  readonly meta: {
    readonly totalRoutes: number;
    readonly matchedRoutes: number;
    readonly appliedFilters: readonly string[];
    readonly match: string;
    readonly truncated: boolean;
  };
}

export function toGraphPayload(
  graph: ServiceGraph,
): GraphPayload & { readonly warnings: readonly LoadWarning[] } {
  return { nodes: graph.nodes, edges: graph.edges, warnings: graph.warnings };
}

export function toRoutesPayload(
  graph: ServiceGraph,
  result: RouteQueryResult,
  appliedFilters: readonly string[],
  match: string,
): RoutesPayload {
  const nodeNames = new Set<string>();
  const edgeKeys = new Set<string>();
  const edges: GraphEdge[] = [];

  for (const route of result.routes) {
    route.nodes.forEach((name, index) => {
      nodeNames.add(name);
      const next = route.nodes[index + 1];
      if (next === undefined) return;
      const key = `${name}\u0000${next}`;
      if (edgeKeys.has(key)) return;
      edgeKeys.add(key);
      edges.push({ from: name, to: next });
    });
  }

  return {
    nodes: graph.nodes.filter((node) => nodeNames.has(node.name)),
    edges,
    routes: result.routes.map((route) => ({
      id: route.nodes.join(' > '),
      nodes: route.nodes,
    })),
    meta: {
      totalRoutes: result.totalRoutes,
      matchedRoutes: result.routes.length,
      appliedFilters,
      match,
      truncated: result.truncated,
    },
  };
}
