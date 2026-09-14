// Offline asset preparation only. No renderer/font is shipped with the game.
// Usage: node render-favicon.mjs /absolute/path/to/sharp/module
import {createRequire} from 'node:module';
import {readFile, writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] || 'sharp');
const root = new URL('../../public/', import.meta.url);
const source = await readFile(new URL('favicon.svg', root));
const sizes = [16, 32, 48];
const frames = await Promise.all(sizes.map(size => sharp(source, {density: 288})
  .resize(size, size).png({palette: true, colours: 32, dither: 0}).toBuffer()));
const header = Buffer.alloc(6 + 16 * frames.length);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
for (let i = 0; i < frames.length; i++) {
  const entry = 6 + 16 * i;
  header[entry] = header[entry + 1] = sizes[i];
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(frames[i].length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += frames[i].length;
}
await writeFile(new URL('favicon.ico', root), Buffer.concat([header, ...frames]));
await sharp(source, {density: 288}).resize(180, 180)
  .flatten({background: '#9c352b'}).png({palette: true, colours: 32, dither: 0})
  .toFile(fileURLToPath(new URL('apple-touch-icon.png', root)));
