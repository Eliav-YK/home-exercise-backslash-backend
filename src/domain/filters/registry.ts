import { FilterParseError, type RouteFilter } from './filter.js';

export interface FilterParam {
  readonly name: string;
  readonly description: string;
}

export interface FilterDefinition {
  readonly name: string;
  readonly description: string;
  readonly params?: readonly FilterParam[];
  readonly build: (args: readonly string[]) => RouteFilter;
}


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

  list(): readonly FilterDefinition[] {
    return [...this.definitions.values()].sort((a, b) => a.name.localeCompare(b.name));
  }


  build(spec: string): RouteFilter {
    const [name, ...args] = spec.split(':');
    if (name === undefined || name === '') {
      throw new FilterParseError('Empty filter name.');
    }

    const definition = this.get(name);
    if (definition === undefined) {
      const known = this.list()
        .map((d) => d.name)
        .join(', ');
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

  buildAll(specs: readonly string[]): readonly RouteFilter[] {
    return specs.map((spec) => this.build(spec));
  }
}
