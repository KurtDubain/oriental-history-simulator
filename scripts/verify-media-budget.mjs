import {readFile, readdir, stat} from 'node:fs/promises';
import {resolve, relative, extname} from 'node:path';
import {pathToFileURL} from 'node:url';

export const mediaBudgets = { sfx: 250 * 1024, image: 800 * 1024, initial: 150 * 1024, total: 1024 * 1024 };
const rootIcons = new Set(['favicon.svg', 'favicon.ico', 'apple-touch-icon.png']);
const validPath = path => rootIcons.has(path) || /^media\/(sfx|images)\/[a-z0-9]+(?:-[a-z0-9]+)*\.(webp|avif|ogg|mp3|m4a)$/.test(path ?? '');
export function checkMediaAssets(assets) {
  const totals = {sfx: 0, image: 0, initial: 0, total: 0}, failures = [], paths = new Set();
  for (const asset of assets) {
    const {path, kind, load, bytes, source, license, creator} = asset;
    if (!validPath(path) || paths.has(path)) failures.push(`非法或重复资源路径：${path}`);
    paths.add(path);
    if (kind !== 'sfx' && kind !== 'image' || !['initial', 'lazy'].includes(load)) failures.push(`分类/加载边界缺失：${path}`);
    if (kind === 'image' ? !rootIcons.has(path) && !/^media\/images\/.*\.(avif|webp)$/.test(path) : !/^media\/sfx\/.*\.(ogg|mp3|m4a)$/.test(path)) failures.push(`格式与用途不符：${path}`);
    if (rootIcons.has(path) && (kind !== 'image' || load !== 'initial')) failures.push(`站点图标必须计入首屏图片预算：${path}`);
    if (![source, license, creator].every(value => typeof value === 'string' && value.trim())) failures.push(`缺少来源、授权或作者：${path}`);
    if (!Number.isSafeInteger(bytes) || bytes < 0) { failures.push(`字节数无效：${path}`); continue; }
    if (kind in totals) totals[kind] += bytes;
    if (load === 'initial') totals.initial += bytes;
    totals.total += bytes;
  }
  for (const [kind, maximum] of Object.entries(mediaBudgets)) if (totals[kind] > maximum) failures.push(`${kind}: ${totals[kind]} > ${maximum} bytes`);
  for (const [kind, maximum] of [['sfx', 8], ['image', 12]]) if (assets.filter(asset => asset.kind === kind).length > maximum) failures.push(`${kind}: 超过首批 ${maximum} 个资源`);
  return {budgets: mediaBudgets, totals, count: assets.length, failures};
}

async function files(directory) {
  const entries = await readdir(directory, {withFileTypes: true}).catch(error => {if (error.code === 'ENOENT') return []; throw error;});
  return (await Promise.all(entries.map(entry => entry.isDirectory() ? files(resolve(directory, entry.name)) : [resolve(directory, entry.name)]))).flat();
}

export async function verifyMedia(root, target = null) {
  const {assets} = JSON.parse(await readFile(resolve(root, 'media/manifest.json'), 'utf8'));
  if (!Array.isArray(assets) || assets.some(asset => !validPath(asset.path))) throw new Error('媒体清单必须使用 public/media 内的合法路径或三个约定的根图标路径');
  const measured = await Promise.all(assets.map(async asset => ({...asset, bytes: (await stat(resolve(root, 'public', asset.path))).size})));
  const result = checkMediaAssets(measured), registered = new Set(assets.map(asset => asset.path));
  for (const base of ['public', ...(target ? [target] : [])]) {
    for (const file of await files(resolve(root, base, 'media'))) if (!registered.has(relative(resolve(root, base), file))) result.failures.push(`未登记资源：${file}`);
    for (const entry of await readdir(resolve(root, base), {withFileTypes: true})) {
      if (entry.isFile() && ['.ico', '.svg', '.png'].includes(extname(entry.name).toLowerCase()) && !registered.has(entry.name)) result.failures.push(`未登记资源：${resolve(root, base, entry.name)}`);
    }
    if (base !== 'public') for (const asset of measured) {
      const copy = await readFile(resolve(root, base, asset.path)).catch(error => {if (error.code === 'ENOENT') return null; throw error;});
      if (!copy || !(await readFile(resolve(root, 'public', asset.path))).equals(copy)) result.failures.push(`产物资源不一致：${asset.path}`);
    }
  }
  // Assets stay separate from code. This also covers lazy chunks, not just the entry.
  for (const directory of ['src', ...(target ? [target] : [])]) for (const file of await files(resolve(root, directory))) {
    if (!['.js', '.ts', '.tsx', '.css', '.html'].includes(extname(file))) continue;
    const text = await readFile(file, 'utf8');
    if (/data:(?:audio|image)\/[^;]+;base64,[A-Za-z0-9+/=]{2048}/.test(text)) result.failures.push(`禁止将大块媒体内联进代码：${file}`);
  }
  return {...result, assets: measured, note: assets.length ? '预算通过不替代加载/静音/失败回退实机验收' : '尚无媒体；仅验证接入门禁，不代表未来资源已经验收'};
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await verifyMedia(process.cwd(), process.argv[2]);
  console.log(JSON.stringify(result, null, 2));
  if (result.failures.length) process.exitCode = 1;
}
