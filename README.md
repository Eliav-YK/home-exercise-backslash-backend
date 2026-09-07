# Service Graph Query Engine

A RESTful query engine over the Train Ticket micro-service dependency graph.

It loads the supplied JSON, derives every **route** through the system, and exposes
filtered views of those routes as a graph structure a client can render directly.

```bash
npm install
npm run dev          # http://localhost:3000/api
npm test             # 48 tests
```

---

## The problem, as I read it

The three required filters are not arbitrary. Read together —

> a route that **starts at a publicly exposed service**, **ends in a datastore**,
> and **passes through a node with a vulnerability**

— they describe an *attack path*: something reachable from the internet that
reaches your data through vulnerable code. That framing drove two decisions: what
a "route" is, and why the filter system is the part of this codebase that got the
most design attention.

## API

| Endpoint | Description |
| :------- | :---------- |
| `GET /api` | Endpoint index. |
| `GET /api/graph` | The full graph, plus any warnings raised while loading. |
| `GET /api/filters` | Every available filter and its arguments — generated from the registry. |
| `GET /api/routes` | Routes, optionally filtered. |

**`GET /api/routes`**

| Parameter | Description |
| :-------- | :---------- |
| `filters` | Comma-separated, or repeated. Arguments use a colon: `hasVulnerability:high`. |
| `match` | `all` (default, AND) or `any` (OR). |

```bash
curl 'localhost:3000/api/routes?filters=startsPublic'
curl 'localhost:3000/api/routes?filters=endsInSink,hasVulnerability:high'
curl 'localhost:3000/api/routes?filters=startsPublic,endsInSink&match=any'
```

Every response leads with flat `nodes` and `edges` — the shape a rendering
library consumes — with the matched paths alongside, so a client can highlight
individual routes without recomputing them:

```jsonc
{
  "nodes": [ /* the sub-graph the matched routes induce, each node once */ ],
  "edges": [ { "from": "order-service", "to": "prod-postgresdb" } ],
  "routes": [ { "id": "admin-order-service > order-service > prod-postgresdb",
                "nodes": ["admin-order-service", "order-service", "prod-postgresdb"] } ],
  "meta": { "totalRoutes": 215, "matchedRoutes": 33, "appliedFilters": ["endsInSink"],
            "match": "all", "truncated": false }
}
```

`meta.totalRoutes` is always the unfiltered count, so `matchedRoutes` has context.

---

## Design

Three layers, one direction of dependency. `domain/` knows nothing about HTTP,
Express, or the JSON file format; `data/` is the only module aware of the on-disk
shape; `api/` only translates. `src/index.ts` is the composition root — the single
place that wires them together.

```
src/
  domain/           types · graph · routes             (pure, framework-free)
    filters/        filter · registry · definitions
  data/             loader                             (JSON -> validated domain)
  api/              server · presenter                 (HTTP only)
  config.ts         env-backed settings
  index.ts          composition root
```

### What counts as a route

**A route is a maximal simple path**: it starts at an entry point (nothing points
at it) and runs until it can go no further. "Starts in" and "ends in" only mean
something if a route has real endpoints, so this is the reading the brief implies.

- **Simple** — no node repeats. The dataset is acyclic, but depending on that
  would make the enumerator a landmine the first time someone adds a feedback
  edge, so the visited set is unconditional.
- **Minimum length 2** — a lone node with no edges is not a route "between
  services". Five isolated nodes are therefore absent from `/api/routes`; they
  are still in `/api/graph`. Configurable via `MIN_ROUTE_LENGTH`.
- **Known limitation** — a cyclic component with *no* entry point yields no
  routes. It costs this dataset nothing, and it is covered by an explicit test
  so the behaviour is documented rather than discovered.

Path enumeration is exponential in general. This graph yields 215 routes, but
`maxDepth` and `maxRoutes` cap the work and set `meta.truncated` when they bite.
The graph is immutable, so routes are enumerated **once at startup** and each
request is a linear filter pass — the expensive part never sits in the request path.

### The filter system

The brief asks for filters that are easy to add. The whole contract is one type:

```ts
type RouteFilter = (route: Route, graph: ServiceGraph) => boolean;
```

Anything you can ask about a route fits, so the design has no ceiling. On top of
it sit three combinators that lift a *node* question into a *route* question —
`startNode`, `endNode`, `anyNode` — because almost every filter anyone wants is
"some node here looks like X", differing only in *which* nodes must qualify.
Naming those quantifiers once makes each filter a single line:

```ts
{
  name: 'startsPublic',
  description: 'Routes that begin at a publicly exposed service.',
  build: () => startNode((node) => node.publicExposed),
}
```

All three required filters are one-liners built this way. A `FilterRegistry` maps
names to definitions and resolves a query string spec to a built filter.

**To add a filter, append one entry to `builtInFilters` in
`src/domain/filters/definitions.ts`.** Nothing else changes — not the route
handler, not the query engine, not the enumerator. It is immediately queryable,
its arguments are validated, and it documents itself on `GET /api/filters`.

Two of the five shipped filters exist to prove that. `passesThrough:<node>` is
another node-scoped one-liner; `maxLength:<n>` is deliberately something *no*
node predicate could express, demonstrating that the combinators are a shortcut
and `RouteFilter` is the real boundary.

The self-describing `/api/filters` endpoint is the point worth stressing: it is
generated from the same registrations that power queries, so it cannot drift.
The genericity is demonstrated rather than asserted.

Eleven files, none of them ceremony. Three earlier ones were merged away once
they stopped earning separation: a 15-line `server.ts` that only mounted a
router, a types file thinner than its own doc comments, and a query engine that
wrapped two calls. `filter.ts` is now *what a filter is and how to build one*,
`registry.ts` is *how they are named and looked up*, and `definitions.ts` stays
alone — the claim is "adding a filter touches one file", and that has to remain
literally true.

Argument validation lives in each filter's own `build`, not in a generic
`required`/`allowed` layer in the registry. The registry resolves the name; the
rule about an argument sits next to the code that depends on it. Errors from
either surface as the same 400.

An earlier draft had a fourth quantifier (`allNodes`) and a `not` helper. Both
were cut: nothing called them, and `allNodes` had no test either. A generic
system earns the name by being *easy to extend*, not by pre-building the
extensions — shipping unused, untested surface argues against the very claim
the design is making. Each is one line to add back when a filter needs it.

`match=all` and `match=any` are just `every` and `some` over the filter list.
Both are vacuously true on an empty list, so "no filters requested" resolves to
"return everything" with no special case anywhere.

---

## The data, and what I did about it

The supplied JSON is not clean. Each of these is handled explicitly at load time
and covered by a test.

| Finding | Decision |
| :------ | :------- |
| **`to` is polymorphic.** 26 edges use `to: string[]`; the `consign-service` edge uses a bare string. | Normalised to an array in the schema. Left alone, `for (const t of edge.to)` iterates the string *character by character* and invents ~20 phantom nodes — silently. This one quirk is the difference between a naive edge count of 116 and the correct **96**. |
| **Dangling reference.** `assurance-service` is the target of two edges but is not a declared node. | Drop the edge, record a `DANGLING_EDGE_TARGET` warning, keep serving. Inventing a node the source never declared would be worse, and refusing to start on the data we were given would be worse still. Warnings are logged at startup and returned on `/api/graph`. |
| **`publicExposed` is optional** — absent on `prod-postgresdb` and `prod-sqs`. | Normalised to `false` at load. Absent means not exposed. |
| **`vulnerabilities` is absent** on the 44 clean nodes. | Normalised to `[]`. Filters are the code most likely to be written by someone else; they get total values instead of `?.` and `?? false` at every call site. |
| **The brief says "rds/sql"; the data has kinds `rds` and `sqs`,** and no `sql`. | Read as a typo for `sqs`. Both are treated as sinks via the named `SINK_KINDS` set in `definitions.ts`, so the reading is visible and one line to change. |

### One result worth flagging

**`?filters=startsPublic,endsInSink` returns zero routes — correctly.**

The dataset has exactly two public services. `gateway-service` has no edges at
all, and the only path out of `frontend` is
`frontend -> admin-basic-info-service -> {contacts, station, train, price, config}`,
none of which reach a datastore. No public route touches a sink, so the
intersection is genuinely empty.

I am calling this out because an empty response is otherwise indistinguishable
from a bug. It is asserted as a test, and it is the reason `match=any` exists —
the same pair returns 38 routes under OR.

Counts on the supplied data: **46 nodes, 96 edges, 215 routes** — of which 5 start
public, 33 end in a sink, and 60 touch a vulnerable node.

---

## Testing

48 tests across four files (`npm test`):

- **`loader`** — the string-vs-array quirk, dangling references, normalisation defaults, duplicate handling.
- **`routes`** — branching, `minLength`, cycle termination, both truncation caps, the documented entry-point limitation.
- **`filters`** — each combinator, each built-in filter, and every registry rejection path.
- **`api`** — end-to-end against the real dataset via `supertest`, asserting the counts above, so the loader, enumerator and filters are all regression-covered at once.

## Trade-offs

- **Enumerate-then-filter** over pushing predicates into the traversal. At this
  size the difference is unmeasurable, and the separation is what keeps a filter
  a one-line predicate. On a graph large enough to matter, start-node filters
  should prune the DFS at its root.
- **In-memory, load-once.** The dataset is static and small; a database or
  incremental reload would be complexity without a requirement behind it.
- **No auth, rate limiting, or pagination.** Out of scope for the exercise, and
  `meta.truncated` is the honest hook for the last of those.
- **Positional filter arguments** (`hasVulnerability:high`) keep query strings
  readable. Named arguments would scale better past two or three parameters.
- **`exactOptionalPropertyTypes` was tried and dropped.** It forced
  `...(raw.language !== undefined && { language: raw.language })` throughout the
  loader — measurably harder to read than a plain assignment, in the first file
  a reviewer opens, to prevent a bug this code cannot have.

## Stack

TypeScript (strict, `noUncheckedIndexedAccess`) ·
Node 20+ · Express · Zod for input validation · Vitest. Two runtime dependencies,
by design.
