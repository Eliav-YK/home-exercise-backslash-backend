import { SEVERITIES, type Severity } from '../types.js';
import { anyNode, endNode, FilterParseError, startNode } from './filter.js';
import type { FilterDefinition } from './registry.js';

/**
 * Node kinds that count as a data sink.
 *
 * The brief says "rds/sql"; the dataset contains kinds `rds` and `sqs` and no
 * `sql`, so this reads it as the message queue. Kept as a named set rather
 * than inlined so the reading is visible and cheap to correct.
 */
export const SINK_KINDS: ReadonlySet<string> = new Set(['rds', 'sqs']);

const asSeverity = (value: string | undefined): Severity | undefined => {
  if (value === undefined) return undefined;
  if (!(SEVERITIES as readonly string[]).includes(value)) {
    throw new FilterParseError(`Invalid severity "${value}". Allowed: ${SEVERITIES.join(', ')}.`);
  }
  return value as Severity;
};

const required = (value: string | undefined, filter: string, param: string): string => {
  if (value === undefined || value === '') {
    throw new FilterParseError(`Filter "${filter}" requires argument "${param}".`);
  }
  return value;
};

/**
 * The built-in filters.
 *
 * ────────────────────────────────────────────────────────────────────────
 *  TO ADD A FILTER: append one entry to this array. Nothing else changes —
 *  not the route handler, not the service, not the enumerator. It is picked
 *  up by `GET /api/routes` and documented by `GET /api/filters` on restart.
 * ────────────────────────────────────────────────────────────────────────
 */
export const builtInFilters: readonly FilterDefinition[] = [
  {
    name: 'startsPublic',
    description: 'Routes that begin at a publicly exposed service.',
    build: () => startNode((node) => node.publicExposed),
  },

  {
    name: 'endsInSink',
    description: `Routes that terminate in a data sink (${[...SINK_KINDS].join(', ')}).`,
    build: () => endNode((node) => SINK_KINDS.has(node.kind)),
  },

  {
    name: 'hasVulnerability',
    description: 'Routes where at least one node carries a vulnerability.',
    params: [{ name: 'severity', description: `Optional. One of: ${SEVERITIES.join(', ')}.` }],
    build: ([rawSeverity]) => {
      const severity = asSeverity(rawSeverity);
      return anyNode((node) =>
        node.vulnerabilities.some((vuln) => severity === undefined || vuln.severity === severity),
      );
    },
  },

  // The two below are not required by the brief. They are here to show that
  // the extension points work: one more node-scoped filter, and one that no
  // node predicate could express — proof the `RouteFilter` contract is the
  // real boundary and the combinators are only a shortcut.

  {
    name: 'passesThrough',
    description: 'Routes that include a specific node, anywhere along the way.',
    params: [{ name: 'nodeName', description: 'Required. Exact node name.' }],
    build: ([nodeName]) => {
      const target = required(nodeName, 'passesThrough', 'nodeName');
      return anyNode((node) => node.name === target);
    },
  },

  {
    name: 'maxLength',
    description: 'Routes no longer than N nodes.',
    params: [{ name: 'n', description: 'Required. Positive integer.' }],
    build: ([raw]) => {
      const limit = Number(required(raw, 'maxLength', 'n'));
      if (!Number.isInteger(limit) || limit < 1) {
        throw new FilterParseError(`maxLength.n must be a positive integer, got "${raw}".`);
      }
      return (route) => route.nodes.length <= limit;
    },
  },
];
