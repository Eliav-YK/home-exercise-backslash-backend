/**
 * The vocabulary of the domain. Everything downstream speaks in these terms,
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

export interface GraphNode {
  readonly name: string;
  /** e.g. 'service' | 'rds' | 'sqs'. Left open: the dataset may grow new kinds. */
  readonly kind: string;
  readonly language?: string;
  readonly path?: string;
  /** Normalised at load: absent in the source means not exposed. */
  readonly publicExposed: boolean;
  /** Normalised at load: absent in the source means none. */
  readonly vulnerabilities: readonly Vulnerability[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * A single directed dependency. The source JSON groups targets
 * (`{ from, to: [...] }`); we flatten to one edge per pair.
 */
export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

/** A path through the graph: node names in order, non-empty and free of repeats. */
export interface Route {
  readonly nodes: readonly string[];
}

/**
 * A recoverable problem found while loading. Collected rather than thrown —
 * the dataset ships with a broken reference, and refusing to start would be
 * worse than reporting it. Surfaced on `/api/graph`.
 */
export interface LoadWarning {
  readonly code: 'DANGLING_EDGE_TARGET';
  readonly message: string;
}
