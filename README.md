# Service Graph Query Engine

A RESTful query engine over the Train Ticket micro-service dependency graph. It loads
the supplied JSON, derives every **route** through the system, and returns filtered
views of those routes as a graph structure a client can render directly.

```bash
npm install
npm run dev          # http://localhost:3000/api   (PORT=3001 to change)
npm test             # 48 tests
```

## API

| Endpoint | Description |
| :------- | :---------- |
| `GET /api` | Endpoint index. |
| `GET /api/graph` | The full graph, plus any warnings raised while loading. |
| `GET /api/filters` | Every available filter and its arguments, generated from the registry. |
| `GET /api/routes` | Routes, optionally filtered. |

`GET /api/routes` takes `filters` (comma-separated or repeated; arguments use a colon,
e.g. `hasVulnerability:high`) and `match` (`all`, the default AND, or `any` for OR).

```bash
curl 'localhost:3000/api/routes?filters=startsPublic'
curl 'localhost:3000/api/routes?filters=endsInSink,hasVulnerability:high'
```

Every response leads with flat `nodes` and `edges` — the shape a rendering library
consumes — with the matched paths alongside, so a client can highlight a route without
recomputing it. `meta.totalRoutes` is always the unfiltered count, so an empty result is
never ambiguous.

```jsonc
{
  "nodes": [ /* the sub-graph the matched routes induce, each node once */ ],
  "edges": [ { "from": "order-service", "to": "prod-postgresdb" } ],
  "routes": [ { "id": "order-service > prod-postgresdb", "nodes": [ /* ... */ ] } ],
  "meta": { "totalRoutes": 215, "matchedRoutes": 33, "match": "all", "truncated": false }
}
```

## Design

Three layers, one direction of dependency: `domain/` knows nothing about HTTP, Express or
the file format, `data/` is the only module aware of the on-disk shape, `api/` only
translates, and `src/index.ts` wires them together.

**A route is a maximal simple path** — it starts at an entry point (nothing points at it)
and runs until it can go no further. The filters imply this: "starts in" and "ends in"
only mean something if a route has real endpoints. *Simple* means no node repeats; the
dataset is acyclic, but the visited set is unconditional so a future feedback edge cannot
hang the traversal. Minimum length is 2, since a lone node is not a route *between*
services — five isolated nodes are absent from `/api/routes` but still in `/api/graph`
(`MIN_ROUTE_LENGTH` overrides). A cyclic component with no entry point yields no routes;
that limitation costs this dataset nothing and has an explicit test.

The graph is immutable, so all 215 routes are enumerated **once at startup** and each
request is a linear filter pass. Enumeration is exponential in general, so `maxDepth` and
`maxRoutes` cap the work and set `meta.truncated` when they bite.

### The filter system

The brief asks the API to be **as generic as possible**, so this got the most attention.
The whole contract is one type:

```ts
type RouteFilter = (route: Route, graph: ServiceGraph) => boolean;
```

Any question about a route fits, so the design has no ceiling. Above it sit three
combinators lifting a *node* question into a *route* question — `startNode`, `endNode`,
`anyNode` — which are exactly the quantifiers the brief itself uses ("start in", "end
in", "one of the nodes"). Each required filter is then one line:

```ts
{ name: 'startsPublic', build: () => startNode((node) => node.publicExposed) }
```

**To add a filter, append one entry to `builtInFilters` in
`src/domain/filters/definitions.ts`.** Nothing else changes — not the route handler, the
query engine or the enumerator — and it documents itself on `GET /api/filters`, which is
generated from the same registrations that power queries and so cannot drift. Two of the
five shipped filters exist only to demonstrate this: `passesThrough` is another
node-scoped one-liner, `maxLength` is deliberately something no node predicate could
express. `match=all` and `match=any` are just `every` and `some` over the filter list,
both vacuously true on an empty list, so "no filters" means "return everything" with no
special case anywhere.

## Assumptions and data findings

The supplied JSON is not clean. Each is handled at load time and covered by a test.

| Finding | Decision |
| :------ | :------- |
| **`to` is polymorphic** — 26 edges use `to: string[]`, the `consign-service` edge uses a bare string. | Normalised to an array in the schema. Unhandled, `for (const t of edge.to)` iterates the string *character by character* and silently invents ~20 phantom nodes — the difference between a naive count of 116 edges and the correct **96**. |
| **Dangling reference** — `assurance-service` is the target of two edges but never declared as a node. | Drop the edge, record a `DANGLING_EDGE_TARGET` warning, keep serving. Inventing a node the source never declared, or refusing to start on the given data, would both be worse. |
| **`publicExposed` absent** on `prod-postgresdb` and `prod-sqs`. | Normalised to `false`. Absent means not exposed. |
| **`vulnerabilities` absent** on the 44 clean nodes. | Normalised to `[]`, so filters get total values instead of `?.` at every call site. |
| **The brief says "rds/sql"**, the data has `rds` and `sqs` and no `sql`. | Read as a typo for `sqs`. Both live in the named `SINK_KINDS` set, so the reading is visible and one line to change. |

**`?filters=startsPublic,endsInSink` returns zero routes — correctly.** Of the two public
services, `gateway-service` has no edges at all and the only path out of `frontend`
reaches five information services, none a datastore. The intersection is genuinely empty.
It is asserted as a test, and it is why `match=any` exists: the same pair returns 38.

Counts: **46 nodes, 96 edges, 215 routes** — 5 start public, 33 end in a sink, 60 touch a
vulnerable node.

## Trade-offs

- **Enumerate-then-filter** over pushing predicates into the traversal. At this size the
  difference is unmeasurable and it keeps a filter a one-line predicate; on a larger
  graph, start-node filters should prune the DFS at its root.
- **In-memory, load-once.** The dataset is static and small.
- **No auth, rate limiting or pagination.** Out of scope; `meta.truncated` is the hook.
- **Positional filter arguments** keep query strings readable, but named arguments would
  scale better past two or three parameters.

## Stack

TypeScript (strict) · Node 20+ · Express · Zod · Vitest. Two runtime dependencies, by
design. 48 tests cover the loader (every quirk above), the enumerator (branching, cycles,
both caps), every combinator and rejection path, and an end-to-end suite asserting the
counts above against the real dataset.
