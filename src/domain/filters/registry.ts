import { FilterParseError, type RouteFilter } from './filter.js';

/**
 * How filters are named, documented and looked up.
 *
 * Documentation for a positional argument, supplied as `filterName:value`.
 * Description only — validating an argument is the filter's own job, done in
 * its `build`, where the rule sits next to the code that depends on it. A
 * generic `required`/`allowed` layer here would be a second place to keep in
 * step for no gain.
 */
export interface FilterParam {
  readonly name: string;
  readonly description: string;
}

/**
 * A filter as the registry knows it: a name, prose for humans, the arguments
 * it accepts, and a factory that turns those arguments into a `RouteFilter`.
 *
 * `description` and `params` are not decoration — `GET /api/filters` is
 * generated from them, so a newly registered filter documents itself.
 */
export interface FilterDefinition {
  readonly name: string;
  readonly description: string;
  readonly params?: readonly FilterParam[];
  readonly build: (args: readonly string[]) => RouteFilter;
}

/**
 * The lookup table of known filters.
 *
 * A class rather than a module-level singleton so that wiring stays explicit
 * and tests can stand up a registry containing exactly the filters under test.
 */
export class FilterRegistry {
  private readonly definitions = new Map<string, FilterDefinition>();

  register(definition: FilterDefinition): this {
    if (this.definitions.has(definition.name)) {
      throw new Error(`Duplicate filter name: "${definition.name}"`);
    }
    this.definitions.set(definition.name, definition);
    return this;
  }

  registerAll(definitions: readonly FilterDefinition[]): this {
    for (const definition of definitions) {
      this.register(definition);
    }
    return this;
  }

  get(name: string): FilterDefinition | undefined {
    return this.definitions.get(name);
  }

  /** Every registered filter, name-sorted. Backs `GET /api/filters`. */
  list(): readonly FilterDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Turn one `name` or `name:arg` spec from the query string into a filter.
   *
   * Resolving the name and counting the arguments happens here. Whether an
   * argument is well-formed or permitted is the filter's own business, raised
   * from its `build` as a `FilterParseError` and surfaced as the same 400.
   *
   * Arity is the exception because it is the one rule the registry can check
   * without knowing what any argument means — and without it, a typo like
   * `startsPublic:hgh` would be silently ignored instead of reported.
   */
  build(spec: string): RouteFilter {
    const [name, ...args] = spec.split(':');
    if (name === undefined || name === '') {
      throw new FilterParseError('Empty filter name.');
    }

    const definition = this.get(name);
    if (definition === undefined) {
      const known = this.list().map((d) => d.name).join(', ');
      throw new FilterParseError(`Unknown filter "${name}". Available filters: ${known}.`);
    }

    const arity = definition.params?.length ?? 0;
    if (args.length > arity) {
      throw new FilterParseError(
        `Filter "${name}" accepts at most ${arity} argument(s), got ${args.length}.`,
      );
    }

    return definition.build(args.filter((arg) => arg !== ''));
  }

  /** Build every requested spec, preserving order. */
  buildAll(specs: readonly string[]): readonly RouteFilter[] {
    return specs.map((spec) => this.build(spec));
  }
}
