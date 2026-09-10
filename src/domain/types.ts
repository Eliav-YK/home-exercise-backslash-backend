/**
 * the vocabulary of the domain. everything downstream speaks in these terms,
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
  readonly kind: string;
  readonly language?: string;
  readonly path?: string;
  readonly publicExposed: boolean;
  readonly vulnerabilities: readonly Vulnerability[];
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface GraphEdge {
  readonly from: string;
  readonly to: string;
}

export interface Route {
  readonly nodes: readonly string[];
}

export interface LoadWarning {
  readonly code: 'DANGLING_EDGE_TARGET';
  readonly message: string;
}
