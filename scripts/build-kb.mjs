#!/usr/bin/env node
/**
 * build-kb.mjs — build the Digital Twin's knowledge base.
 *
 * Sources (nothing else is ever used to answer):
 *   1. every generated page in src/pages/** (the design, as published), split by <section>, each chunk
 *      carrying its route and, when the section has an id'd heading, an anchor to link to;
 *   2. the design's own Q&A in src/data/digital-twin.json;
 *   3. twin/profile.json — hand-written facts NJ has stated herself (roles, dates, degrees, how she works).
 *
 * Output: netlify/functions/twin-kb.json (generated; imported by the twin function at build time).
 * Run automatically before `astro build`. Exits non-zero if a case study yields no text, so a redesign
 * that breaks extraction fails the build instead of silently emptying the twin.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pagesDir = path.join(root, 'src/pages');
const outFile = path.join(root, 'netlify/functions/twin-kb.json');

const walk = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

const entities = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': ' ', '&middot;': '·', '&rarr;': '→', '&larr;': '←' };
const decode = (s) => s.replace(/&(?:amp|lt|gt|quot|nbsp|middot|rarr|larr|#39);/g, (m) => entities[m] ?? m);

const textOf = (html) =>
  decode(
    html
      .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, ' ')
      .replace(/<(header|nav|footer)\b[\s\S]*?<\/\1>/g, ' ')
      .replace(/<\/(p|div|li|h[1-6]|dt|dd|tr|section|blockquote)>/g, '\n')
      .replace(/<br\s*\/?>/g, '\n')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\{[^{}]*\}/g, ' '), // leftover Astro/JS expressions
  )
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

const MAX = 900;
const pieces = (lines) => {
  const out = [];
  let cur = '';
  for (const line of lines) {
    if (cur && cur.length + line.length + 1 > MAX) {
      out.push(cur);
      cur = '';
    }
    if (line.length > MAX) {
      for (const s of line.split(/(?<=[.!?])\s+/)) {
        if (cur && cur.length + s.length + 1 > MAX) {
          out.push(cur);
          cur = '';
        }
        cur = cur ? `${cur} ${s}` : s;
      }
    } else cur = cur ? `${cur}\n${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
};

const docs = [];
const perRoute = new Map();

for (const file of walk(pagesDir).filter((f) => f.endsWith('.astro'))) {
  const rel = path.relative(pagesDir, file).replace(/\.astro$/, '');
  const route = rel === 'index' ? '' : rel.replace(/\/index$/, '') + '/';
  if (route === 'digital-twin/') continue; // the twin does not quote itself
  const src = fs.readFileSync(file, 'utf8');
  const title = (src.match(/<Layout title=\{"([^"]*)"\}/) ?? [])[1] ?? route;
  const body = src.replace(/^---[\s\S]*?---/, '');
  const sections = body.split(/(?=<section\b)/).filter((s) => s.startsWith('<section'));
  for (const sec of sections) {
    const heading = (sec.match(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/) ?? [])[1];
    const anchor = (sec.match(/<h[12]\b[^>]*\sid="([^"]+)"/) ?? [])[1] ?? null;
    const headingText = heading ? textOf(heading).join(' ') : '';
    const lines = textOf(sec);
    if (!lines.length) continue;
    pieces(lines).forEach((text, i) => {
      docs.push({
        id: `${route || 'home/'}${anchor ?? 's'}-${docs.length}`.replace(/[^a-z0-9/_-]/gi, '-'),
        kind: 'page',
        route,
        page: decode(title),
        heading: headingText,
        anchor,
        text: headingText && i === 0 && !text.startsWith(headingText) ? `${headingText}\n${text}` : text,
      });
      perRoute.set(route, (perRoute.get(route) ?? 0) + 1);
    });
  }
}

for (const route of fs.readdirSync(path.join(pagesDir, 'case-studies')).map((f) => `case-studies/${f.replace(/\.astro$/, '')}/`)) {
  if (!perRoute.get(route)) {
    console.error(`build-kb: no text extracted from ${route}. The page structure changed; update scripts/build-kb.mjs.`);
    process.exit(1);
  }
}

// The design's own Q&A (already first person, already NJ's words).
const twinData = JSON.parse(fs.readFileSync(path.join(root, 'src/data/digital-twin.json'), 'utf8'));
twinData.qa.forEach((x, i) =>
  docs.push({ id: `design-qa-${i}`, kind: 'design', route: '', page: 'Home', heading: x.q, anchor: null, text: `${x.q}\n${x.a}` }),
);

// Hand-written facts NJ has stated herself.
const profile = JSON.parse(fs.readFileSync(path.join(root, 'twin/profile.json'), 'utf8'));
for (const p of profile.facts) {
  docs.push({ id: `profile-${p.id}`, kind: 'profile', route: p.route ?? '', page: p.page ?? 'About NJ', heading: p.heading, anchor: null, text: `${p.heading}\n${p.text}` });
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify({ built: new Date().toISOString(), docs }) + '\n');

const by = docs.reduce((m, d) => ((m[d.kind] = (m[d.kind] ?? 0) + 1), m), {});
console.log(`build-kb: ${docs.length} passages (${Object.entries(by).map(([k, v]) => `${v} ${k}`).join(', ')}) → ${path.relative(root, outFile)}`);
