import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEV = process.env.DEV === '1';
const out = await build({
  entryPoints: [path.join(ROOT, 'src/main.js')],
  bundle: true,
  write: false,
  format: 'iife',
  target: ['es2020'],
  platform: 'browser',
  minify: !DEV,
  sourcemap: false,
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': JSON.stringify(DEV ? 'development' : 'production') },
});
const js = out.outputFiles[0].text;
const template = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8');
const marker = '<script type="module" src="./main.js"></script>';
if (!template.includes(marker)) throw new Error('Script marker not found in template');
// Use a replacer function: the minified bundle can contain '$&' or '$`'
// sequences that String.replace would otherwise interpret as replacement patterns.
const html = template.replace(marker, () => `<script>\n${js}\n</script>`);
fs.writeFileSync(path.join(ROOT, 'index.html'), html);
console.log(`Built index.html (${(Buffer.byteLength(html) / 1024).toFixed(0)} KB)${DEV ? ' [dev]' : ''}`);
