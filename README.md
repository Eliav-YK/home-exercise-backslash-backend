# Service Graph Query Engine

A RESTful query engine over the supplied Train Ticket micro-service graph.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000/api   (set PORT to change it)
npm test         # 48 tests
```

`GET /api` lists the endpoints. The three that matter:

- `GET /api/graph` — the whole graph, plus any warnings raised while loading
- `GET /api/filters` — the available filters, generated from the registry itself
- `GET /api/routes?filters=startsPublic,endsInSink&match=any` — filtered routes

## The solution

The JSON gives nodes and edges; the routes are derived from them. At startup the file is
loaded and validated, the graph is indexed, and a DFS enumerates every **route** — a
maximal simple path from an entry point (nothing points at it) to a terminal. That yields
215 routes. Because the graph never changes, this runs once and each request is only a
filter pass over the result.

Every response leads with flat `nodes` and `edges`, de-duplicated, which is what a
client-side rendering library consumes. The matched `routes` ride alongside so a client
can highlight one without recomputing it, and `meta` carries the unfiltered total so an
empty result is never ambiguous.

The code is three layers: `domain/` (pure — no HTTP or file-format knowledge), `data/`
(the only module that knows the JSON shape), and `api/` (translation only).

## Decisions

**A route is a maximal simple path.** The filters imply it — "starts in" and "ends in"
are meaningless unless a route has real endpoints. *Simple* means no node repeats: the
data is acyclic, but the visited set is unconditional so a future feedback edge cannot
hang the traversal. Minimum length is 2, so five isolated nodes appear in `/api/graph`
but not in `/api/routes`.

**Filters are one type.** The brief asks the API to be as generic as possible, so this
got the most attention:

```ts
type RouteFilter = (route: Route, graph: ServiceGraph) => boolean;
```

Any question about a route fits. Above it sit three combinators that lift a *node*
question into a *route* question — `startNode`, `endNode`, `anyNode` — which are exactly
the quantifiers the brief uses ("start in", "end in", "one of the nodes"). Each required
filter is then a single line:

```ts
{ name: 'startsPublic', build: () => startNode((node) => node.publicExposed) }
```

**Adding a filter means appending one entry to `builtInFilters` in
`src/domain/filters/definitions.ts`** — the route handler, query engine and enumerator
are untouched, and it documents itself on `GET /api/filters`. Two of the five shipped
filters (`passesThrough`, `maxLength`) exist only to demonstrate that; `maxLength` is
deliberately something no node predicate could express.

**`match=all` / `match=any`** are `every` and `some` over the filter list. Both are
vacuously true on an empty list, so "no filters" resolves to "return everything" with no
special case.

**Enumerate-then-filter** rather than pushing predicates into the traversal. At this size
the cost is unmeasurable and it keeps each filter a one-line predicate. On a much larger
graph, start-node filters should prune the DFS at its root; `maxDepth` and `maxRoutes`
cap the work today and set `meta.truncated`.

## Assumptions

- **`to` is polymorphic.** 26 edges use `to: string[]`, but `consign-service` uses a bare
  string. Normalised to an array. Left alone, iterating it walks the string character by
  character and silently invents ~20 phantom nodes — the difference between a naive count
  of 116 edges and the correct 96.
- **`assurance-service` is referenced but never declared.** Those two edges are dropped
  with a `DANGLING_EDGE_TARGET` warning rather than inventing a node or refusing to start.
- **`publicExposed` absent means `false`**, and **absent `vulnerabilities` means `[]`** —
  both normalised at load so filters get total values.
- **"rds/sql" in the brief is read as a typo for `sqs`**, since the data has `rds` and
  `sqs` and no `sql`. Both live in a named `SINK_KINDS` set, one line to change.
- **`startsPublic` + `endsInSink` returns zero routes, and that is correct.** Of the two
  public services, `gateway-service` has no edges and `frontend` only reaches five
  information services. The intersection is genuinely empty — asserted as a test, and the
  reason `match=any` exists.

Counts on the supplied data: 46 nodes, 96 edges, 215 routes — 5 start public, 33 end in a
sink, 60 touch a vulnerable node.

## Tests

48 tests, `npm test`. They cover the loader (each data quirk above), the enumerator
(branching, cycle termination, both caps), every combinator and every rejection path, and
an end-to-end suite that asserts the counts above against the real dataset — so a
regression in any layer fails the build.

## Stack

TypeScript (strict) · Node 20+ · Express · Zod · Vitest. Two runtime dependencies.
