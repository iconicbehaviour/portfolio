#!/usr/bin/env node
/**
 * check-site.mjs — sanity-check the built site in dist/.
 *   - every internal href/src resolves to a file in dist/
 *   - every #fragment link points to an id on the target page
 *   - reports placeholder content left in the design ([bracketed text], mailto:[...]) as warnings
 *
 * Exits 1 on broken links/assets/fragments. Placeholders only warn (they are content, not breakage).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const base = (process.env.SITE_BASE ?? '/portfolio').replace(/\/$/, '');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const pages = walk(dist).filter((f) => f.endsWith('.html'));
const idsByFile = new Map();
const htmlOf = new Map();
for (const f of pages) {
  const html = fs.readFileSync(f, 'utf8');
  htmlOf.set(f, html);
  idsByFile.set(f, new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1])));
}

const resolve = (urlPath) => {
  let p = urlPath.slice(base.length) || '/';
  const abs = path.join(dist, p);
  if (p.endsWith('/')) return path.join(abs, 'index.html');
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  if (fs.existsSync(path.join(abs, 'index.html'))) return path.join(abs, 'index.html');
  return abs;
};

const errors = [];
const warnings = [];
let checked = 0;

for (const [file, html] of htmlOf) {
  const rel = path.relative(dist, file);
  for (const m of html.matchAll(/\s(?:href|src)="([^"]*)"/g)) {
    const url = m[1];
    if (/^https:\/\/claude\.ai\/(code\/)?artifact\//.test(url)) {
      warnings.push(`${rel}: links to a claude.ai artifact (${url}); visitors leave the site`);
    }
    if (!url || /^(https?:|\/\/|data:|tel:)/.test(url)) continue;
    if (url.includes('${')) continue; // JS template placeholder inside an inline script, not a real URL
    if (/^\[.*\]$/.test(url)) {
      warnings.push(`${rel}: placeholder link "${url}"`);
      continue;
    }
    if (url.startsWith('mailto:')) {
      if (/[\[\]]/.test(url)) warnings.push(`${rel}: placeholder email link "${url}"`);
      continue;
    }
    if (url.startsWith('#')) {
      checked++;
      if (!idsByFile.get(file).has(url.slice(1))) errors.push(`${rel}: missing in-page anchor ${url}`);
      continue;
    }
    if (!url.startsWith('/')) {
      // Imported prototype pages (public/prototypes/**) use relative links so they work under any base path.
      if (rel.split(path.sep)[0] === 'prototypes') {
        checked++;
        const [pathPart, frag] = url.split('#');
        let target = path.resolve(path.dirname(file), pathPart || '.');
        if (fs.existsSync(target) && fs.statSync(target).isDirectory()) target = path.join(target, 'index.html');
        if (!target.startsWith(dist + path.sep) || !fs.existsSync(target)) {
          errors.push(`${rel}: broken relative link ${url}`);
        } else if (frag && target.endsWith('.html') && !idsByFile.get(target)?.has(frag)) {
          errors.push(`${rel}: ${pathPart} has no #${frag}`);
        }
        continue;
      }
      errors.push(`${rel}: relative URL "${url}" (use base-aware absolute URLs)`);
      continue;
    }
    checked++;
    if (!url.startsWith(base + '/') && url !== base) {
      errors.push(`${rel}: "${url}" is outside base ${base}`);
      continue;
    }
    const [pathPart, frag] = url.split('#');
    const target = resolve(pathPart);
    if (!fs.existsSync(target)) {
      errors.push(`${rel}: broken link/asset ${url}`);
    } else if (frag && target.endsWith('.html') && !idsByFile.get(target)?.has(frag)) {
      errors.push(`${rel}: ${pathPart} has no #${frag}`);
    }
  }
  const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ');
  for (const m of text.matchAll(/\[[A-Z][^\]]{2,80}\]/g)) warnings.push(`${rel}: placeholder text ${m[0]}`);
}

console.log(`Checked ${checked} internal references across ${pages.length} pages.`);
for (const w of [...new Set(warnings)]) console.log(`WARN  ${w}`);
for (const e of errors) console.log(`ERROR ${e}`);
if (errors.length) {
  console.log(`${errors.length} problem(s).`);
  process.exit(1);
}
console.log('OK');
