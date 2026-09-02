import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';
import ts from 'typescript';

type DependencyKind = 'runtime' | 'type';

interface SourceDependency {
  specifier: string;
  kind: DependencyKind;
}

interface SourceRecord {
  path: string;
  lines: number;
  dependencies: SourceDependency[];
}

const root = process.cwd();
const sourceRoot = resolve(root, 'src');

const FILE_LINE_BUDGETS: Readonly<Record<string, number>> = {
  'src/App.tsx': 2_300,
  'src/sim/engine.ts': 3_120,
  'src/sim/invariants.ts': 2_665,
  'src/components/WorldMap.tsx': 1_100,
  'src/view/observer-leads.ts': 400,
  'src/view/adapters.ts': 100,
};
const TYPE_CYCLE_NODE_BUDGET = 12;

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    if (!['.ts', '.tsx'].includes(extname(path)) || /\.test\.|\.stories\.|\.d\.ts$/.test(path)) return [];
    return [path];
  });
}

function relativeModule(node: ts.Expression | undefined): string | null {
  if (!node || !ts.isStringLiteralLike(node) || !node.text.startsWith('.')) return null;
  return node.text;
}

function sourceDependencies(path: string, source: string): SourceDependency[] {
  const scriptKind = path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind);
  const dependencies: SourceDependency[] = [];
  const add = (specifier: string | null, kind: DependencyKind) => {
    if (!specifier) return;
    dependencies.push({ specifier, kind });
  };

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      const specifier = relativeModule(statement.moduleSpecifier);
      const clause = statement.importClause;
      if (!clause) {
        add(specifier, 'runtime');
        continue;
      }
      const namedBindings = clause.namedBindings;
      const namedImportsAreTypeOnly = namedBindings && ts.isNamedImports(namedBindings)
        ? namedBindings.elements.length > 0 && namedBindings.elements.every((element) => element.isTypeOnly)
        : false;
      const kind: DependencyKind = clause.isTypeOnly
        || (!clause.name && namedImportsAreTypeOnly)
        ? 'type'
        : 'runtime';
      add(specifier, kind);
      continue;
    }
    if (ts.isExportDeclaration(statement)) {
      const specifier = relativeModule(statement.moduleSpecifier);
      const namedExportsAreTypeOnly = statement.exportClause && ts.isNamedExports(statement.exportClause)
        ? statement.exportClause.elements.length > 0 && statement.exportClause.elements.every((element) => element.isTypeOnly)
        : false;
      add(specifier, statement.isTypeOnly || namedExportsAreTypeOnly ? 'type' : 'runtime');
    }
  }

  const visitDynamicImports = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments.length === 1
    ) {
      add(relativeModule(node.arguments[0]), 'runtime');
    }
    ts.forEachChild(node, visitDynamicImports);
  };
  visitDynamicImports(sourceFile);

  const strongest = new Map<string, DependencyKind>();
  for (const dependency of dependencies) {
    const previous = strongest.get(dependency.specifier);
    if (!previous || dependency.kind === 'runtime') strongest.set(dependency.specifier, dependency.kind);
  }
  return [...strongest].map(([specifier, kind]) => ({ specifier, kind }));
}

const files = filesUnder(sourceRoot).sort();
const records: SourceRecord[] = files.map((path) => {
  const source = readFileSync(path, 'utf8');
  return {
    path: relative(root, path),
    lines: source.split(/\r?\n/).length,
    dependencies: sourceDependencies(path, source),
  };
});
const recordByPath = new Map(records.map((record) => [record.path, record]));

function resolveImport(from: string, specifier: string): string | null {
  const candidate = relative(root, resolve(dirname(resolve(root, from)), specifier));
  return [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}/index.ts`, `${candidate}/index.tsx`]
    .find((path) => recordByPath.has(path)) ?? null;
}

const resolvedDependencies = new Map(records.map((record) => [
  record.path,
  record.dependencies
    .map((dependency) => ({ ...dependency, path: resolveImport(record.path, dependency.specifier) }))
    .filter((dependency): dependency is SourceDependency & { path: string } => Boolean(dependency.path)),
]));
const graphFor = (kind: 'all' | 'runtime') => new Map(records.map((record) => [
  record.path,
  (resolvedDependencies.get(record.path) ?? [])
    .filter((dependency) => kind === 'all' || dependency.kind === 'runtime')
    .map((dependency) => dependency.path),
]));

function cyclicComponents(graph: ReadonlyMap<string, readonly string[]>): string[][] {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const components: string[][] = [];

  const connect = (path: string): void => {
    indices.set(path, index);
    lowLinks.set(path, index);
    index += 1;
    stack.push(path);
    onStack.add(path);

    for (const dependency of graph.get(path) ?? []) {
      if (!indices.has(dependency)) {
        connect(dependency);
        lowLinks.set(path, Math.min(lowLinks.get(path) ?? 0, lowLinks.get(dependency) ?? 0));
      } else if (onStack.has(dependency)) {
        lowLinks.set(path, Math.min(lowLinks.get(path) ?? 0, indices.get(dependency) ?? 0));
      }
    }

    if (lowLinks.get(path) !== indices.get(path)) return;
    const component: string[] = [];
    let member: string | undefined;
    do {
      member = stack.pop();
      if (!member) break;
      onStack.delete(member);
      component.push(member);
    } while (member !== path);
    const selfCycle = component.length === 1 && (graph.get(component[0]) ?? []).includes(component[0]);
    if (component.length > 1 || selfCycle) components.push(component.sort());
  };

  for (const path of [...graph.keys()].sort()) {
    if (!indices.has(path)) connect(path);
  }
  return components.sort((left, right) => left[0].localeCompare(right[0]));
}

function forbiddenRuntimeLayer(from: string, to: string): boolean {
  if (from.startsWith('src/sim/')) {
    return to === 'src/App.tsx'
      || to.startsWith('src/components/')
      || to.startsWith('src/styles/')
      || to.startsWith('src/view/')
      || to.startsWith('src/audio/')
      || to.startsWith('src/infra/');
  }
  if (from.startsWith('src/maps/')) {
    return to === 'src/App.tsx'
      || to.startsWith('src/components/')
      || to.startsWith('src/styles/')
      || to.startsWith('src/view/')
      || to.startsWith('src/audio/');
  }
  return false;
}

const runtimeCycles = cyclicComponents(graphFor('runtime'));
const allCycles = cyclicComponents(graphFor('all'));
const runtimeCycleNodes = new Set(runtimeCycles.flat());
const typeOnlyCycles = allCycles
  .map((component) => component.filter((path) => !runtimeCycleNodes.has(path)))
  .filter((component) => component.length > 0);
const typeCycleNodes = new Set(typeOnlyCycles.flat());
const hotspots = [...records]
  .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
  .slice(0, 12)
  .map(({ path, lines }) => ({ path, lines }));
const fileBudgetViolations = Object.entries(FILE_LINE_BUDGETS).flatMap(([path, maximumLines]) => {
  const actualLines = recordByPath.get(path)?.lines;
  if (actualLines === undefined || actualLines <= maximumLines) return [];
  return [{ path, actualLines, maximumLines }];
});
const layerViolations = [...resolvedDependencies].flatMap(([from, dependencies]) => (
  dependencies
    .filter((dependency) => dependency.kind === 'runtime' && forbiddenRuntimeLayer(from, dependency.path))
    .map((dependency) => `${from} -> ${dependency.path}`)
));
const failures = [
  ...runtimeCycles.map((component) => `runtime dependency cycle: ${component.join(' <-> ')}`),
  ...fileBudgetViolations.map((item) => (
    `${item.path} exceeds its ${item.maximumLines}-line architecture budget (${item.actualLines})`
  )),
  ...layerViolations.map((violation) => `forbidden runtime layer dependency: ${violation}`),
  ...(typeCycleNodes.size > TYPE_CYCLE_NODE_BUDGET
    ? [`type-only cycle debt grew beyond ${TYPE_CYCLE_NODE_BUDGET} modules (${typeCycleNodes.size})`]
    : []),
];

const report = {
  scope: 'production TS/TSX under src (tests excluded)',
  files: records.length,
  lines: records.reduce((sum, record) => sum + record.lines, 0),
  imports: {
    total: [...resolvedDependencies.values()].reduce((sum, dependencies) => sum + dependencies.length, 0),
    runtime: [...resolvedDependencies.values()].reduce(
      (sum, dependencies) => sum + dependencies.filter((dependency) => dependency.kind === 'runtime').length,
      0,
    ),
    typeOnly: [...resolvedDependencies.values()].reduce(
      (sum, dependencies) => sum + dependencies.filter((dependency) => dependency.kind === 'type').length,
      0,
    ),
  },
  cycles: {
    runtime: runtimeCycles,
    typeOnly: typeOnlyCycles,
    typeOnlyDebtModules: typeCycleNodes.size,
    typeOnlyDebtBudget: TYPE_CYCLE_NODE_BUDGET,
  },
  layerViolations,
  fileBudgets: Object.entries(FILE_LINE_BUDGETS).map(([path, maximumLines]) => ({
    path,
    actualLines: recordByPath.get(path)?.lines ?? null,
    maximumLines,
  })),
  hotspots,
  failures,
};

console.log(JSON.stringify(report, null, 2));
if (failures.length > 0) process.exitCode = 1;
