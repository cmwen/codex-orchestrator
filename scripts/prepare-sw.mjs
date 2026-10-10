import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const assets = (await readdir('dist/assets')).map((file) => `assets/${file}`);
const html = await readFile('dist/index.html', 'utf8');
const version = createHash('sha256').update(html).digest('hex').slice(0, 12);
let sw = await readFile('public/sw.js', 'utf8');
sw = sw.replace('orbit-shell-v1', `orbit-shell-${version}`);
sw = sw.replace(
  '/* PRECACHE_ASSETS */',
  `...${JSON.stringify(assets)}.map(file => new URL(file, root).href),`,
);
await writeFile('dist/sw.js', sw);
