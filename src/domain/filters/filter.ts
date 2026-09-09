import type { ServiceGraph } from '../graph.js';
import type { GraphNode, Route } from '../types.js';

/**
 * What a filter is, and how to build one.
 *
 * The entire contract is a plain predicate — not a class, not a config object.
 * Any question you can ask about a route can be expressed this way, so the
 * system has no ceiling. The combinators below are a convenience for the
 * common cases, never a restriction.
 */
export type RouteFilter = (route: Route, graph: ServiceGraph) => boolean;

/** A question about a single node, which the combinators lift into a `RouteFilter`. */
export type NodePredicate = (node: GraphNode) => boolean;

/** Raised for an unknown filter name or a bad argument; surfaced as HTTP 400. */
export class FilterParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FilterParseError';
  }
}

/**
 * Almost every filter anyone will want is "some node in this route looks like
 * X", differing only in *which* nodes have to satisfy X. Naming those
 * quantifiers once means each concrete filter is a single readable line.
 *
 * Only the three quantifiers something actually calls live here. A fourth
 * (`allNodes`) and a negation helper were written and then removed: a generic
 * system earns the name by being easy to extend, not by pre-building the
 * extensions. Each is one line to add back the day a filter needs it.
 */

const nodeAt = (route: Route, graph: ServiceGraph, index: number): GraphNode | undefined => {
  const name = route.nodes.at(index);
  return name === undefined ? undefined : graph.getNode(name);
};

/** The route's first node satisfies the predicate. */
export const startNode =
  (predicate: NodePredicate): RouteFilter =>
  (route, graph) => {
    const node = nodeAt(route, graph, 0);
    return node !== undefined && predicate(node);
  };

/** The route's last node satisfies the predicate. */
export const endNode =
  (predicate: NodePredicate): RouteFilter =>
  (route, graph) => {
    const node = nodeAt(route, graph, -1);
    return node !== undefined && predicate(node);
  };

/** At least one node on the route satisfies the predicate. */
export const anyNode =
  (predicate: NodePredicate): RouteFilter =>
  (route, graph) =>
    route.nodes.some((name) => {
      const node = graph.getNode(name);
      return node !== undefined && predicate(node);
    });

/**
 * Compose filters. `every` backs `match=all`, `some` backs `match=any`.
 *
 * Both are vacuously true on an empty list, which is what makes "no filters
 * requested" fall out as "return everything" without a special case.
 */
export const every =
  (filters: readonly RouteFilter[]): RouteFilter =>
  (route, graph) =>
    filters.every((filter) => filter(route, graph));

export const some =
  (filters: readonly RouteFilter[]): RouteFilter =>
  (route, graph) =>
    filters.length === 0 || filters.some((filter) => filter(route, graph));
