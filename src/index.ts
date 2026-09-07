import { loadConfig } from './config.js';
import { loadGraphFromFile } from './data/loader.js';
import { builtInFilters } from './domain/filters/definitions.js';
import { FilterRegistry } from './domain/filters/registry.js';
import { RouteQueryEngine } from './domain/routes.js';
import { createServer } from './api/server.js';

/**
 * Composition root: the one place that knows how the pieces fit together.
 * Every module below is handed its dependencies and stays independently testable.
 */
const config = loadConfig();

const graph = loadGraphFromFile(config.dataFile);
const registry = new FilterRegistry().registerAll(builtInFilters);
const engine = new RouteQueryEngine(graph, config.enumeration);

for (const warning of graph.warnings) {
  console.warn(`[load:${warning.code}] ${warning.message}`);
}

createServer({ graph, engine, registry }).listen(config.port, () => {
  console.log(
    `Service graph API on http://localhost:${config.port}/api ` +
      `(${graph.nodes.length} nodes, ${graph.edges.length} edges)`,
  );
});
