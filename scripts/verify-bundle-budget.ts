import { readdir, readFile } from 'node:fs/promises';
import { extname, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

const KIB = 1024;
const budgets = {
  // COMPACT01 removed duplicate observer systems and specialist map layers.
  // v1.25 spends a bounded five KiB only on authoritative expedition, fate,
  // and sourced life-story closure; keep the raw/CSS ceilings unchanged.
  singleJavaScriptRawBytes: 585 * KIB,
  totalJavaScriptGzipBytes: 415 * KIB,
  totalCssGzipBytes: 40 * KIB,
} as const;

interface AssetMeasurement {
  file: string;
  rawBytes: number;
  gzipBytes: number;
}

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const path = resolve(directory, entry.name);
    return entry.isDirectory() ? filesUnder(path) : [path];
  }));
  return files.flat().sort();
}

async function measureAssets(
  root: string,
  extension: '.js' | '.css',
): Promise<AssetMeasurement[]> {
  const files = (await filesUnder(root)).filter((file) => extname(file) === extension);
  return Promise.all(files.map(async (file) => {
    const content = await readFile(file);
    return {
      file: relative(process.cwd(), file).replaceAll('\\', '/'),
      rawBytes: content.byteLength,
      gzipBytes: gzipSync(content, { level: 9 }).byteLength,
    };
  }));
}

const target = resolve(process.cwd(), process.argv[2] ?? 'dist');
const [javaScript, css] = await Promise.all([
  measureAssets(target, '.js'),
  measureAssets(target, '.css'),
]);

if (javaScript.length === 0) throw new Error(`${relative(process.cwd(), target)} 中没有 JavaScript 构建产物。`);
if (css.length === 0) throw new Error(`${relative(process.cwd(), target)} 中没有 CSS 构建产物。`);

const totals = {
  javaScriptRawBytes: javaScript.reduce((sum, asset) => sum + asset.rawBytes, 0),
  javaScriptGzipBytes: javaScript.reduce((sum, asset) => sum + asset.gzipBytes, 0),
  cssRawBytes: css.reduce((sum, asset) => sum + asset.rawBytes, 0),
  cssGzipBytes: css.reduce((sum, asset) => sum + asset.gzipBytes, 0),
};
const violations = [
  ...javaScript
    .filter((asset) => asset.rawBytes > budgets.singleJavaScriptRawBytes)
    .map((asset) => (
      `${asset.file} raw ${asset.rawBytes} > ${budgets.singleJavaScriptRawBytes}`
    )),
  ...(totals.javaScriptGzipBytes > budgets.totalJavaScriptGzipBytes
    ? [`JavaScript gzip total ${totals.javaScriptGzipBytes} > ${budgets.totalJavaScriptGzipBytes}`]
    : []),
  ...(totals.cssGzipBytes > budgets.totalCssGzipBytes
    ? [`CSS gzip total ${totals.cssGzipBytes} > ${budgets.totalCssGzipBytes}`]
    : []),
];

console.log(JSON.stringify({
  target: relative(process.cwd(), target).replaceAll('\\', '/') || '.',
  budgets,
  totals,
  assets: { javaScript, css },
  violations,
}, null, 2));

if (violations.length > 0) {
  throw new Error(`构建产物超过预算：\n${violations.join('\n')}`);
}
