import { describe, expect, it } from 'vitest';
import { parseGraph } from '../src/data/loader.js';

const node = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  kind: 'service',
  ...extra,
});

describe('parseGraph', () => {
  it('flattens a list of targets into one edge each', () => {
    const graph = parseGraph({
      nodes: [node('a'), node('b'), node('c')],
      edges: [{ from: 'a', to: ['b', 'c'] }],
    });

    expect(graph.edges).toEqual([
      { from: 'a', to: 'b' },
      { from: 'a', to: 'c' },
    ]);
  });

  // The supplied dataset has exactly one edge shaped this way. Left unhandled,
  // the string is iterated character by character.
  it('accepts a bare string target as a single edge', () => {
    const graph = parseGraph({
      nodes: [node('consign-service'), node('consign-price-service')],
      edges: [{ from: 'consign-service', to: 'consign-price-service' }],
    });

    expect(graph.edges).toEqual([{ from: 'consign-service', to: 'consign-price-service' }]);
    expect(graph.successors('consign-service')).toEqual(['consign-price-service']);
  });

  it('drops edges to undeclared nodes and reports them', () => {
    const graph = parseGraph({
      nodes: [node('a')],
      edges: [{ from: 'a', to: ['ghost'] }],
    });

    expect(graph.edges).toEqual([]);
    expect(graph.warnings).toHaveLength(1);
    expect(graph.warnings[0]?.code).toBe('DANGLING_EDGE_TARGET');
    expect(graph.warnings[0]?.message).toContain('ghost');
  });

  it('normalises absent publicExposed and vulnerabilities', () => {
    const graph = parseGraph({
      nodes: [{ name: 'prod-postgresdb', kind: 'rds', metadata: { cloud: 'AWS' } }],
      edges: [],
    });

    expect(graph.getNode('prod-postgresdb')).toMatchObject({
      publicExposed: false,
      vulnerabilities: [],
      metadata: { cloud: 'AWS' },
    });
  });

  it('collapses a duplicated node, keeping the first', () => {
    const graph = parseGraph({
      nodes: [node('a', { language: 'java' }), node('a', { language: 'go' })],
      edges: [],
    });

    expect(graph.nodes).toHaveLength(1);
    expect(graph.getNode('a')?.language).toBe('java');
  });

  it('de-duplicates repeated edges', () => {
    const graph = parseGraph({
      nodes: [node('a'), node('b')],
      edges: [
        { from: 'a', to: ['b'] },
        { from: 'a', to: ['b'] },
      ],
    });

    expect(graph.edges).toHaveLength(1);
  });

  it('rejects a structurally invalid document', () => {
    expect(() => parseGraph({ nodes: [{ kind: 'service' }], edges: [] })).toThrow();
  });
});
