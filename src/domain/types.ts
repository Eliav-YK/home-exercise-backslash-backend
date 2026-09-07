/**
 * The vocabulary of the domain.
 *
 * Everything downstream (graph, routes, filters, API) speaks in these terms,
 * and nothing here knows about HTTP, Express, or the on-disk JSON format.
 */

export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;

export type Severity = (typeof SEVERITIES)[number];

export interface Vulnerability {
  readonly file: string;
  readonly severity: Severity;
  readonly message: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A node in the service graph.
 *
 * Two fields are normalised at load time rather than left optional:
 * `publicExposed` (absent in the source for infrastructure nodes) and
 * `vulnerabilities` (absent for the 44 nodes that have none). Filters are
 * the code most likely to be written by someone else, so they get total
 * values to work with instead of `?.` and `?? false` at every call site.
 */
export interface GraphNode {
  readonly name: string;
  /** e.g. 'service' | 'rds' | 'sqs'. Left open: the dataset may grow new kinds. */
  readonly kind: string;
  readonly language?: string;
  readonly path?: string;
  readonly publicExposed: boolean;
  readonly vulnerabilities: readonly Vulnerability[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A single directed dependency.
 *
 * The source JSON groups targets (`{ from, to: [...] }`); we flatten to one
 * edge per pair so the graph, the API response, and any client renderer all
 * agree on what "an edge" is.
 */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

/**
 * A path through the graph, as node names in traversal order.
 *
 * Guaranteed non-empty and free of repeats — see `enumerateRoutes`.
 */
export interface Route {
  readonly nodes: readonly string[];
}

/**
 * A recoverable problem found while loading the source data.
 *
 * Collected rather than thrown: the dataset ships with a broken reference, and
 * refusing to start would be worse than reporting it. Surfaced on `/api/graph`.
 *
 * One code, because one thing actually goes wrong in this data. Codes for
 * conditions that never occur are dead branches wearing a uniform.
 */
export interface LoadWarning {
  readonly code: 'DANGLING_EDGE_TARGET';
  readonly message: string;
}
