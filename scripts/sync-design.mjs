#!/usr/bin/env node
/**
 * sync-design.mjs — turn a Claude Design canvas into Astro pages.
 *
 * Usage:
 *   node scripts/sync-design.mjs --src <dir with *.dc.html, canvas.json, ds/*\/tokens.json> [--check]
 *
 * --check   report what changed against design.manifest.json and write nothing.
 *
 * What it does (idempotent — safe to run on every sync):
 *   1. Hashes every artboard (*.dc.html) and the design tokens, compares with the manifest.
 *   2. Converts each artboard into src/pages/<route>.astro (links and image URLs rewritten, base-path aware).
 *      Artboards with dynamic behavior get a transform from scripts/transforms/<Name>.mjs.
 *   3. Regenerates src/styles/tokens.css and src/styles/global.css from the design.
 *   4. Mirrors the raw design into design/source/ so git shows real design diffs.
 *   5. Updates design.manifest.json.
 *
 * Image assets are NOT fetched here (the design host is not reachable from CI or the shell). The agent
 * downloads them into public/images/<id>.<ext>; this script reports any that are missing.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const srcDir = opt('--src');
const checkOnly = args.includes('--check');

if (!srcDir) {
  console.error('usage: node scripts/sync-design.mjs --src <design project dir> [--check]');
  process.exit(2);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/[^A-Za-z0-9]+/g, '-').toLowerCase();

const manifestPath = path.join(root, 'design.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.routes ??= {};
manifest.hashes ??= {};
manifest.generated ??= [];

// ---------- read the design ----------
const names = fs
  .readdirSync(srcDir)
  .filter((f) => f.endsWith('.dc.html'))
  .map((f) => f.replace(/\.dc\.html$/, ''))
  .sort();
if (names.length === 0) {
  console.error(`No *.dc.html files found in ${srcDir}`);
  process.exit(2);
}

const sources = Object.fromEntries(names.map((n) => [n, fs.readFileSync(path.join(srcDir, `${n}.dc.html`), 'utf8')]));

const tokensFile = (() => {
  const dsDir = path.join(srcDir, 'ds');
  if (!fs.existsSync(dsDir)) return null;
  for (const d of fs.readdirSync(dsDir)) {
    const p = path.join(dsDir, d, 'tokens.json');
    if (fs.existsSync(p)) return p;
  }
  return null;
})();
const tokensRaw = tokensFile ? fs.readFileSync(tokensFile, 'utf8') : null;

const routeFor = (name) => manifest.routes[name] ?? (name === 'Main' ? 'index' : kebab(name));
for (const n of names) manifest.routes[n] = routeFor(n);

// ---------- change report ----------
const report = { new: [], changed: [], unchanged: [], removed: [], missingAssets: [], notes: [] };
for (const n of names) {
  const h = sha(sources[n]);
  if (!(n in manifest.hashes)) report.new.push(n);
  else if (manifest.hashes[n] !== h) report.changed.push(n);
  else report.unchanged.push(n);
}
for (const n of Object.keys(manifest.hashes)) {
  if (n !== '_tokens' && !names.includes(n)) report.removed.push(n);
}
if (tokensRaw && manifest.hashes._tokens !== sha(tokensRaw)) report.changed.push('_tokens');

// ---------- conversion helpers ----------
const imageDir = path.join(root, 'public', 'images');
const imageFile = (id) => {
  if (fs.existsSync(imageDir)) {
    const hit = fs.readdirSync(imageDir).find((f) => f.startsWith(`${id}.`));
    if (hit) return hit;
  }
  report.missingAssets.push(id);
  return `${id}.jpg`;
};

const extract = (name, src) => {
  const title = (src.match(/<title>([\s\S]*?)<\/title>/) || [, name])[1].trim();
  const helmetMatch = src.match(/<helmet>([\s\S]*?)<\/helmet>/);
  const styles = helmetMatch ? [...helmetMatch[1].matchAll(/<style>([\s\S]*?)<\/style>/g)].map((m) => m[1]) : [];
  const start = src.indexOf('</helmet>') >= 0 ? src.indexOf('</helmet>') + '</helmet>'.length : src.indexOf('<x-dc>') + 6;
  const end = src.indexOf('</x-dc>');
  if (end < 0 || start < 6) throw new Error(`${name}: no <x-dc> body found`);
  const body = src.slice(start, end).trim();
  const script = (src.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/) || [, ''])[1];
  return { title, styles, body, script };
};

const loadTransform = async (name) => {
  const p = path.join(root, 'scripts', 'transforms', `${name}.mjs`);
  if (!fs.existsSync(p)) return null;
  return (await import(pathToFileURL(p).href)).default;
};

const hasDynamic = (body) => /\{\{|<sc-for|<sc-if|<dc-import|<x-import/.test(body);

const toAstro = async (name) => {
  const { title, body: rawBody, script } = extract(name, sources[name]);
  const route = manifest.routes[name];
  const depth = route.split('/').length - 1;
  const up = '../'.repeat(depth + 1);

  let body = rawBody;
  let replacements = {};
  let extraFrontmatter = '';
  let tail = '';
  const extraFiles = {};

  const transform = await loadTransform(name);
  if (transform) {
    const out = transform({ body, script, name });
    body = out.body;
    replacements = out.replacements ?? {};
    extraFrontmatter = out.frontmatter ?? '';
    tail = out.tail ?? '';
    Object.assign(extraFiles, out.files ?? {});
  }
  if (hasDynamic(body)) {
    throw new Error(
      `${name}: dynamic design constructs ({{ }}, <sc-for>, <sc-if>, <dc-import>) found with no transform. ` +
        `Add scripts/transforms/${name}.mjs (see DigitalTwin.mjs).`,
    );
  }

  // Curly braces are expressions in .astro files — escape any that are plain text.
  body = body.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');

  // Links between artboards -> real routes (base-path aware).
  body = body.replace(/href="([A-Za-z0-9_-]+)\.dc\.html(#[^"]*)?"/g, (_, target, frag = '') => {
    if (!(target in manifest.routes)) throw new Error(`${name}: link to unknown artboard "${target}.dc.html"`);
    const r = manifest.routes[target];
    const p = r === 'index' ? '' : `${r}/`;
    return `href={\`\${base}${p}${frag}\`}`;
  });

  // Uploaded images -> /images/<id>.<ext>
  body = body.replace(/src="\/_blob\/([a-f0-9]{32})"/g, (_, id) => `src={\`\${base}images/${imageFile(id)}\`}`);

  if (/\/_blob\//.test(body)) throw new Error(`${name}: found a /_blob/ reference outside src="…" — handle it in the converter`);
  if (/\.dc\.html/.test(body)) throw new Error(`${name}: unconverted .dc.html link remains`);

  for (const [token, markup] of Object.entries(replacements)) body = body.split(token).join(markup);

  const page = `---
import Layout from '${up}layouts/Layout.astro';
const base = import.meta.env.BASE_URL.replace(/\\/?$/, '/');
${extraFrontmatter}---
<Layout title={${JSON.stringify(title)}}>
${body}
</Layout>
${tail}`;

  return { route, page, extraFiles, styles: extract(name, sources[name]).styles };
};

// ---------- tokens.css ----------
const tokensCss = (raw) => {
  const t = JSON.parse(raw);
  const light = [];
  const dark = [];
  for (const c of t.color?.tokens ?? []) {
    if (typeof c.value === 'string') light.push(`  --color-${c.name}: ${c.value};`);
    else {
      light.push(`  --color-${c.name}: ${c.value.light};`);
      if (c.value.dark) dark.push(`  --color-${c.name}: ${c.value.dark};`);
    }
  }
  for (const [fam, val] of Object.entries(t.type?.families ?? {})) light.push(`  --font-${fam}: ${val};`);
  for (const group of ['spacing', 'radius', 'shadow']) {
    for (const s of t[group]?.tokens ?? []) light.push(`  --${s.name}: ${s.value};`);
  }
  return (
    `/* Generated by scripts/sync-design.mjs from the design tokens. Do not edit by hand. */\n` +
    `:root {\n${light.join('\n')}\n}\n` +
    (dark.length ? `:root[data-theme='dark'] {\n${dark.join('\n')}\n}\n` : '')
  );
};

// ---------- run ----------
const results = [];
for (const n of names) results.push({ name: n, ...(await toAstro(n)) });

// global.css = union of every artboard's helmet <style> lines, in first-seen order
const seen = new Set();
const globalLines = [];
for (const r of results) {
  for (const block of r.styles) {
    for (const line of block.split('\n').map((l) => l.trim()).filter(Boolean)) {
      if (!seen.has(line)) {
        seen.add(line);
        globalLines.push(line);
      }
    }
  }
}
const globalCss = `/* Generated by scripts/sync-design.mjs from the artboards' shared page styles. Do not edit by hand. */\n${globalLines.join('\n')}\n`;

console.log(JSON.stringify({ ...report, unchanged: report.unchanged.length }, null, 2));

if (checkOnly) {
  console.log(`CHANGES: ${report.new.length + report.changed.length + report.removed.length}`);
  process.exit(0);
}

const write = (rel, content) => {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
};

// remove pages we generated before whose artboard is gone
for (const gone of report.removed) {
  const old = manifest.generated.find((g) => g.name === gone);
  if (old) fs.rmSync(path.join(root, old.file), { force: true });
}

const generated = [];
for (const r of results) {
  const file = `src/pages/${r.route}.astro`;
  write(file, r.page);
  for (const [rel, content] of Object.entries(r.extraFiles)) write(rel, content);
  generated.push({ name: r.name, route: r.route, file });
}
write('src/styles/global.css', globalCss);
if (tokensRaw) write('src/styles/tokens.css', tokensCss(tokensRaw));

// mirror raw design for diffs
fs.rmSync(path.join(root, 'design', 'source'), { recursive: true, force: true });
for (const n of names) write(`design/source/${n}.dc.html`, sources[n]);
if (fs.existsSync(path.join(srcDir, 'canvas.json'))) write('design/source/canvas.json', fs.readFileSync(path.join(srcDir, 'canvas.json'), 'utf8'));
if (tokensRaw) write('design/source/tokens.json', tokensRaw);

manifest.hashes = Object.fromEntries(names.map((n) => [n, sha(sources[n])]));
if (tokensRaw) manifest.hashes._tokens = sha(tokensRaw);
manifest.generated = generated;
manifest.syncedAt = new Date().toISOString();
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

console.log(`Wrote ${generated.length} pages.`);
if (report.missingAssets.length) {
  console.log(`MISSING ASSETS (download into public/images/): ${[...new Set(report.missingAssets)].join(', ')}`);
}
console.log(`CHANGES: ${report.new.length + report.changed.length + report.removed.length}`);
