import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, relative, resolve } from 'node:path';

const root = process.cwd();
const sourceRoot = resolve(root, 'src');

function filesUnder(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = resolve(directory, name);
    if (statSync(path).isDirectory()) return filesUnder(path);
    if (!['.ts', '.tsx'].includes(extname(path)) || /\.test\.|\.stories\.|\.d\.ts$/.test(path)) return [];
    return [path];
  });
}

const files = filesUnder(sourceRoot).sort();
const records = files.map((path) => {
  const source = readFileSync(path, 'utf8');
  return {
    path: relative(root, path),
    lines: source.split(/\r?\n/).length,
    imports: [...source.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((match) => match[1] as string),
  };
});
const recordByPath = new Map(records.map((record) => [record.path, record]));

function resolveImport(from: string, specifier: string): string | null {
  const candidate = relative(root, resolve(dirname(resolve(root, from)), specifier));
  return [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}/index.ts`, `${candidate}/index.tsx`]
    .find((path) => recordByPath.has(path)) ?? null;
}

const graph = new Map(records.map((record) => [
  record.path,
  record.imports.map((specifier) => resolveImport(record.path, specifier)).filter((path): path is string => Boolean(path)),
]));
const cycles = new Set<string>();
const visiting = new Set<string>();
const visited = new Set<string>();
const stack: string[] = [];

function visit(path: string): void {
  if (visiting.has(path)) {
    const start = stack.indexOf(path);
    cycles.add([...stack.slice(start), path].join(' -> '));
    return;
  }
  if (visited.has(path)) return;
  visiting.add(path);
  stack.push(path);
  for (const dependency of graph.get(path) ?? []) visit(dependency);
  stack.pop();
  visiting.delete(path);
  visited.add(path);
}
for (const record of records) visit(record.path);

const hotspots = [...records]
  .sort((left, right) => right.lines - left.lines || left.path.localeCompare(right.path))
  .slice(0, 12)
  .map(({ path, lines }) => ({ path, lines }));
const oversized = hotspots.filter((file) => file.lines > 2_500);

console.log(JSON.stringify({
  scope: 'production TS/TSX under src (tests excluded)',
  files: records.length,
  lines: records.reduce((sum, record) => sum + record.lines, 0),
  relativeImports: [...graph.values()].reduce((sum, dependencies) => sum + dependencies.length, 0),
  cycles: [...cycles].sort(),
  hotspots,
  warnings: oversized.map((file) => `${file.path} is ${file.lines} lines; add new behavior in a domain module and shrink during its next vertical slice`),
}, null, 2));
