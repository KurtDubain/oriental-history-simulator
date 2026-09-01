import { readdir, readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import packageJson from '../package.json';
import { CONTEST_V01_MAP_PROFILE } from '../src/maps/contest-v01';
import { PRIVATE_V03_MAP_PROFILE } from '../src/maps/private-v03';
import type { MapProfile } from '../src/maps/types';

const root = new URL('../dist-contest/', import.meta.url);
const readableExtensions = new Set(['.css', '.html', '.js', '.json']);
const manuallySensitiveTokens = [
  '河北', '北京', '天津', '山东', '河南', '山西', '陕西', '宁夏',
  '辽宁', '吉林', '广东', '福建', '海南', '台湾', '日本列岛', '朝鲜半岛',
];
const requiredTokens = ['云海八荒', 'contest-v01', 'contest-v01-68'];

function profileTokens(profile: MapProfile): Set<string> {
  const tokens = new Set<string>([
    profile.id,
    profile.contentVersion,
    profile.name,
    profile.subtitle,
    profile.description,
  ]);
  for (const region of profile.simulation.regions) {
    tokens.add(region.id);
    tokens.add(region.name);
  }
  for (const polity of profile.simulation.polities) {
    tokens.add(polity.id);
    tokens.add(polity.name);
  }
  for (const seaZone of profile.simulation.seaZones) {
    tokens.add(seaZone.id);
    tokens.add(seaZone.name);
  }
  for (const lane of profile.simulation.seaLanes) tokens.add(lane.id);
  for (const portLink of profile.simulation.portLinks) tokens.add(portLink.id);
  for (const groupId of Object.keys(profile.simulation.regionGroups)) tokens.add(groupId);
  for (const shape of profile.presentation.landShapes) {
    tokens.add(shape.id);
    tokens.add(shape.label);
  }
  for (const shape of profile.presentation.territoryShapes) tokens.add(shape.id);
  for (const islet of profile.presentation.decorativeIslets) {
    tokens.add(islet.id);
    if (islet.label) tokens.add(islet.label);
  }
  for (const site of Object.values(profile.presentation.regionDisplaySites)) {
    tokens.add(site.id);
    tokens.add(site.shapeId);
  }
  for (const seaZoneId of Object.keys(profile.presentation.seaZoneDisplayCenters)) tokens.add(seaZoneId);
  for (const label of profile.presentation.macroLabels) {
    tokens.add(label.id);
    tokens.add(label.label);
  }
  for (const area of profile.presentation.geographyAreas) {
    tokens.add(area.id);
    tokens.add(area.label);
  }
  for (const river of profile.presentation.riverGuides) {
    tokens.add(river.id);
    tokens.add(river.label);
  }
  return tokens;
}

async function collectFiles(directoryUrl: URL): Promise<URL[]> {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files: URL[] = [];
  for (const entry of entries) {
    const child = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, directoryUrl);
    if (entry.isDirectory()) files.push(...await collectFiles(child));
    else if (readableExtensions.has(extname(entry.name))) files.push(child);
  }
  return files;
}

function escaped(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsToken(text: string, token: string): boolean {
  if (/^[a-z0-9_-]+$/i.test(token)) {
    return new RegExp(`(^|[^a-z0-9_-])${escaped(token)}([^a-z0-9_-]|$)`, 'i').test(text);
  }
  return text.includes(token);
}

const publicTokens = profileTokens(CONTEST_V01_MAP_PROFILE);
const privateTokens = [...profileTokens(PRIVATE_V03_MAP_PROFILE)]
  .filter((token) => token.length >= 2 && !publicTokens.has(token));
const forbiddenTokens = [...new Set([...privateTokens, ...manuallySensitiveTokens])].sort();
if (forbiddenTokens.length < 200) {
  throw new Error(`私人内容令牌派生不完整：仅 ${forbiddenTokens.length} 项`);
}

const files = await collectFiles(root);
if (files.length === 0) throw new Error('dist-contest is empty');
const contents = await Promise.all(files.map(async (file) => ({
  file,
  text: await readFile(file, 'utf8'),
})));
const joined = contents.map((entry) => entry.text).join('\n');
const leaked = forbiddenTokens.filter((token) => containsToken(joined, token));
const missing = requiredTokens.filter((token) => !joined.includes(token));
const javascriptText = contents
  .filter((entry) => extname(entry.file.pathname) === '.js')
  .map((entry) => entry.text)
  .join('\n');
const profilePayloadInJavascript = requiredTokens.filter((token) => javascriptText.includes(token));

const indexHtml = await readFile(new URL('index.html', root), 'utf8');
const profileScript = [...indexHtml.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .find((match) => /\bid="canghai-map-profile-data"/.test(match[1] ?? ''));
if (!profileScript || !/\btype="application\/json"/.test(profileScript[1] ?? '')) {
  throw new Error('参赛 HTML 缺少地图 application/json 数据节点');
}
const profilePayloadText = profileScript[2] ?? '';
if (profilePayloadText.includes('<') || /[\u2028\u2029]/u.test(profilePayloadText)) {
  throw new Error('参赛地图 HTML payload 含有未转义的脚本边界字符');
}
const htmlProfiles = JSON.parse(profilePayloadText) as MapProfile[];
if (
  htmlProfiles.length !== 1
  || htmlProfiles[0]?.id !== 'contest-v01'
  || htmlProfiles[0]?.revision !== 1
  || htmlProfiles[0]?.contentVersion !== 'contest-v01-68'
) throw new Error(`参赛 HTML 地图 payload 不符合 allowlist：${JSON.stringify(htmlProfiles.map((profile) => profile.id))}`);

const versionAsset = JSON.parse(await readFile(new URL('version.json', root), 'utf8')) as { version?: string };
const profileAsset = JSON.parse(await readFile(new URL('contest-profile.json', root), 'utf8')) as {
  productVersion?: string;
  allowlist?: string[];
  profiles?: Array<{ id?: string; revision?: number; contentVersion?: string }>;
};
if (versionAsset.version !== packageJson.version || profileAsset.productVersion !== packageJson.version) {
  throw new Error(`参赛产物版本不一致：package=${packageJson.version} version=${versionAsset.version} profile=${profileAsset.productVersion}`);
}
if (
  JSON.stringify(profileAsset.allowlist) !== JSON.stringify(['contest-v01'])
  || JSON.stringify(profileAsset.profiles) !== JSON.stringify([
    { id: 'contest-v01', revision: 1, contentVersion: 'contest-v01-68' },
  ])
) throw new Error(`参赛内容清单不符合预期：${JSON.stringify(profileAsset)}`);

if (leaked.length > 0 || missing.length > 0 || profilePayloadInJavascript.length > 0) {
  const locations = leaked.map((token) => ({
    token,
    files: contents
      .filter((entry) => containsToken(entry.text, token))
      .map((entry) => entry.file.pathname.split('/dist-contest/')[1] ?? entry.file.pathname),
  }));
  throw new Error(JSON.stringify({
    leaked: locations,
    missing,
    profilePayloadInJavascript,
  }, null, 2));
}

process.stdout.write(`${JSON.stringify({
  version: packageJson.version,
  files: files.length,
  derivedPrivateTokens: privateTokens.length,
  forbiddenTokens: forbiddenTokens.length,
  requiredTokens,
  allowlist: profileAsset.allowlist,
  htmlProfiles: htmlProfiles.map((profile) => profile.id),
  profilePayloadInJavascript,
}, null, 2)}\n`);
