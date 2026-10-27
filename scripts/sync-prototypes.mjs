#!/usr/bin/env node
/**
 * sync-prototypes.mjs — keep the interactive prototype pages that the case studies link to on this site.
 *
 * The design's "Open prototype" buttons point at claude.ai artifacts. Visitors should stay on the portfolio, so each
 * prototype is copied here as a self-contained static page: public/prototypes/<name>/index.html.
 *
 * design.manifest.json -> "prototypes" lists them:
 *   { "loop": { "artifact": "<claude.ai artifact url>", "back": "case-studies/loop", "hash": "<sha256 of the source>" } }
 * sync-design.mjs rewrites any design link to that artifact URL so it opens /prototypes/<name>/ instead.
 *
 * Usage:
 *   node scripts/sync-prototypes.mjs --src <dir> [--check]
 * <dir> holds one <name>.html per prototype: the full HTML the Artifact tool saves when it reads the artifact.
 * --check only reports new/changed/unchanged; without it the pages are written and the hashes updated.
 *
 * Normalising the page (nothing else is changed):
 *   - <html lang="en">
 *   - the link back to the design (or a "Case study" crumb) becomes a relative link to the case study, so the page
 *     works under any base path (GitHub Pages /portfolio, Netlify root, custom domain)
 * It warns when the page loads external scripts or makes network calls, because it is published on a public site.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const srcDir = args.includes('--src') ? args[args.indexOf('--src') + 1] : undefined;
const checkOnly = args.includes('--check');
if (!srcDir) {
  console.error('usage: node scripts/sync-prototypes.mjs --src <dir with <name>.html> [--check]');
  process.exit(2);
}

const manifestPath = path.join(root, 'design.manifest.json');
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const prototypes = manifest.prototypes ?? {};
if (Object.keys(prototypes).length === 0) {
  console.log('No prototypes listed in design.manifest.json.');
  process.exit(0);
}

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

const normalise = (name, raw, back) => {
  const notes = [];
  if (!/^\s*<!doctype html/i.test(raw)) throw new Error(`${name}: not a full HTML document (no <!doctype html>)`);

  let html = raw.replace(/<html(\s[^>]*)?>/i, (m, attrs = '') => (/\slang=/.test(attrs) ? m : `<html lang="en"${attrs}>`));

  const backHref = `../../${back}/`;
  const designLink = `href="${manifest.artifact}"`;
  if (html.includes(designLink)) {
    html = html.split(designLink).join(`href="${backHref}"`);
  } else if (/<span class="crumb">Case study \/ Prototype<\/span>/.test(html)) {
    // No back link in the prototype: make "Case study" in the existing breadcrumb one.
    html = html.replace(
      '<span class="crumb">Case study / Prototype</span>',
      `<span class="crumb"><a href="${backHref}" style="color:inherit">Case study</a> / Prototype</span>`,
    );
  } else {
    notes.push(`${name}: no back link found or added; add one to the prototype in the design`);
  }

  if (/claude\.ai\/(code\/)?artifact/.test(html)) notes.push(`${name}: still links to a claude.ai artifact; review the page`);
  if (/<script[^>]+\ssrc=/i.test(html)) notes.push(`${name}: loads an external script; review before publishing`);
  if (/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|\beval\(|new Function/.test(html)) {
    notes.push(`${name}: makes network calls or evaluates code; review before publishing`);
  }
  return { html, notes };
};

const report = { new: [], changed: [], unchanged: [], notes: [] };
const outputs = [];
const missing = [];

for (const [name, p] of Object.entries(prototypes)) {
  const file = path.join(srcDir, `${name}.html`);
  if (!fs.existsSync(file)) {
    missing.push(`${name}.html`);
    continue;
  }
  const raw = fs.readFileSync(file, 'utf8');
  const hash = sha(raw);
  const { html, notes } = normalise(name, raw, p.back);
  report.notes.push(...notes);
  if (!p.hash) report.new.push(name);
  else if (p.hash !== hash) report.changed.push(name);
  else report.unchanged.push(name);
  outputs.push({ name, hash, html });
}

if (missing.length) {
  console.error(`Missing prototype source file(s) in ${srcDir}: ${missing.join(', ')}`);
  process.exit(2);
}

console.log(JSON.stringify(report, null, 2));
console.log(`CHANGES: ${report.new.length + report.changed.length}`);
if (checkOnly) process.exit(0);

for (const o of outputs) {
  const out = path.join(root, 'public', 'prototypes', o.name, 'index.html');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, o.html);
  manifest.prototypes[o.name].hash = o.hash;
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`Wrote ${outputs.length} prototype page(s) to public/prototypes/.`);
