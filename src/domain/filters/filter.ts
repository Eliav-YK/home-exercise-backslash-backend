import type { ServiceGraph } from '../graph.js';
import type { GraphNode, Route } from '../types.js';


export type RouteFilter = (route: Route, graph: ServiceGraph) => boolean;

export type NodePredicate = (node: GraphNode) => boolean;

export class FilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterParseError';
  }
}


const nodeAt = (route: Route, graph: ServiceGraph, index: number): GraphNode | undefined => {
  const name = route.nodes.at(index);
  return name === undefined ? undefined : graph.getNode(name);
};

export const startNode =
  (predicate: NodePredicate): RouteFilter =>
  (route, graph) => {
    const node = nodeAt(route, graph, 0);
    return node !== undefined && predicate(node);
  };

export const endNode =
  (predicate: NodePredicate): RouteFilter =>
  (route, graph) => {
    const node = nodeAt(route, graph, -1);
    return node !== undefined && predicate(node);
  };

export const anyNode =
  (predicate: NodePredicate): RouteFilter =>
  (route, graph) =>
    route.nodes.some((name) => {
      const node = graph.getNode(name);
      return node !== undefined && predicate(node);
    });

export const every =
  (filters: readonly RouteFilter[]): RouteFilter =>
  (route, graph) =>
    filters.every((filter) => filter(route, graph));

export const some =
  (filters: readonly RouteFilter[]): RouteFilter =>
  (route, graph) =>
    filters.length === 0 || filters.some((filter) => filter(route, graph));
