import type { GraphEdge, GraphNode, LoadWarning } from './types.js';


export class ServiceGraph {
  private readonly nodesByName: ReadonlyMap<string, GraphNode>;
  private readonly adjacency: ReadonlyMap<string, readonly string[]>;
  private readonly inDegree: ReadonlyMap<string, number>;

  constructor(
    readonly nodes: readonly GraphNode[],
    readonly edges: readonly GraphEdge[],
    readonly warnings: readonly LoadWarning[] = [],
  ) {
    this.nodesByName = new Map(nodes.map((node) => [node.name, node]));

    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const node of nodes) {
      adjacency.set(node.name, []);
      inDegree.set(node.name, 0);
    }
    for (const edge of edges) {
      adjacency.get(edge.from)?.push(edge.to);
      inDegree.set(edge.to, (inDegree.get(edge.to) ?? 0) + 1);
    }

    this.adjacency = adjacency;
    this.inDegree = inDegree;
  }

  getNode(name: string): GraphNode | undefined {
    return this.nodesByName.get(name);
  }


  successors(name: string): readonly string[] {
    return this.adjacency.get(name) ?? [];
  }


  entryPoints(): readonly GraphNode[] {
    return this.nodes.filter((node) => this.inDegree.get(node.name) === 0);
  }


  terminals(): readonly GraphNode[] {
    return this.nodes.filter((node) => this.successors(node.name).length === 0);
  }
}
