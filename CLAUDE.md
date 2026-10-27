# Portfolio — agent runbook

This site is **generated from a Claude Design canvas**. Source of truth for how it looks:
`https://claude.ai/artifact/9kZVCsAaXJT7mD3L1WoN7D` (also recorded in `design.manifest.json`).

Pushing to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`). Pull requests build and check only.

## What is generated vs. hand-written

| Path | Owner |
| --- | --- |
| `src/pages/**`, `src/styles/*.css`, `src/data/digital-twin.json`, `design/source/**` | **Generated** by `scripts/sync-design.mjs`. Never edit by hand — the next sync overwrites it. |
| `src/layouts/Layout.astro`, `scripts/**`, `astro.config.mjs`, `.github/**` | Hand-written. Changes that must survive a redesign go here. |
| `public/images/<id>.<ext>` | Downloaded design assets, named by their design asset id. |
| `public/prototypes/<name>/index.html` | **Generated** by `scripts/sync-prototypes.mjs` from the prototype artifacts listed in `design.manifest.json` → `prototypes`. Never edit by hand. |

To change how a page looks or reads, change the **design** and sync. Never patch generated pages.

## Sync procedure (design changed → site updated)

1. **Read the design.** With the Artifact tool, `list` the design's files, then `read` with `paths` all `project/*.dc.html`,
   `project/canvas.json` and `project/ds/*/tokens.json` into one scratch folder (the files land under `<folder>/…/project/`).
2. **Fetch new images.** `list` the design's `assets`; for any id referenced in the artboards that is not already in
   `public/images/`, `read` it with `path: <id>` and `out_dir: public/images` (single id per call; `paths` does not work for assets).
3. **Check, then convert.**
   `node scripts/sync-design.mjs --src <scratch>/project --check` shows new/changed/removed artboards, then run it without `--check`.
   It prints `MISSING ASSETS` if step 2 was incomplete.
4. **Refresh the prototypes.** For each entry in `design.manifest.json` → `prototypes`, `read` its `artifact` URL with the Artifact
   tool and copy the saved full HTML to `<scratch>/proto/<name>.html`, then
   `node scripts/sync-prototypes.mjs --src <scratch>/proto --check` (new/changed/unchanged) and again without `--check`.
   Do this on every sync; the prototype artifacts change independently of the design canvas.
5. **Verify.** Node ≥ 22.23.4, then `npm ci && npm run build:ci`. This builds and runs `scripts/check-site.mjs`
   (broken links/images/anchors fail; `WARN` lines are unfilled design placeholders or links that still leave the site — report them, do not fix them).
6. **Ship.** Commit (message lists the changed artboards from the sync report), push, and confirm the deploy workflow passes.
   Use a branch + PR for risky changes (new transform, new artboard type); direct to `main` for plain content/visual updates.

If the converter throws "dynamic design constructs … no transform": the design added interactivity. Write
`scripts/transforms/<ArtboardName>.mjs` modeled on `DigitalTwin.mjs` (design-runtime `{{holes}}` → static markup + a small script;
extract data by pattern matching, never by executing the design's script).

New artboard → gets route `kebab-case(name)` unless `design.manifest.json` `routes` says otherwise (case studies live under
`case-studies/`). Add the nav link in the design, not here.

**Prototypes.** A case study's "Open prototype" button links to a claude.ai artifact in the design. The converter rewrites
any link to an artifact listed under `design.manifest.json` → `prototypes` so it opens `/prototypes/<name>/` on this site
(same tab). New prototype or a re-published one under a new URL → add or update its entry (`artifact`, `back` = the case-study
route) and run `sync-prototypes.mjs`. `check-site.mjs` warns about any link that still goes to a claude.ai artifact.

## Content rules

- **No fabrication, only reframing.** Never fill a design placeholder (`[Your role]`, `[Add traction…]`, `mailto:[your-email]`,
  `[prototype-link]`) with invented content. Leave it and list it in your report.
- Images, copy and numbers come from the design as-is.
- The Digital Twin answers only from `src/data/digital-twin.json` (generated from the design). It has no backend and calls no model.

## Local

`npm install`, `npm run dev`. Base path is `/portfolio` (set `SITE_BASE=/` for a custom domain or `<user>.github.io` repo).
