# Portfolio — agent runbook

This site is **generated from a Claude Design canvas**. Source of truth for how it looks:
`https://claude.ai/artifact/9kZVCsAaXJT7mD3L1WoN7D` (also recorded in `design.manifest.json`).

Pushing to `main` deploys to GitHub Pages (`.github/workflows/deploy.yml`). Pull requests build and check only.

## What is generated vs. hand-written

| Path | Owner |
| --- | --- |
| `src/pages/**`, `src/styles/*.css`, `src/data/digital-twin.json`, `design/source/**` | **Generated** by `scripts/sync-design.mjs`. Never edit by hand — the next sync overwrites it. |
| `src/layouts/Layout.astro`, `scripts/**`, `astro.config.mjs`, `.github/**`, `netlify/**`, `twin/**` | Hand-written. Changes that must survive a redesign go here. |
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
4. **Refresh the prototypes.** For each entry in `design.manifest.json` → `prototypes`, `read` its `artifact` URL with
   `path: "index.html"` and an `out_dir` (this saves the page without printing it), copy the saved file to
   `<scratch>/proto/<name>.html`, then
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
- The Digital Twin answers only from its knowledge base: the generated pages, the design's own Q&A, and `twin/profile.json`
  (facts NJ stated herself). See **Digital Twin** below. It never answers from model memory, and never answers compensation,
  work-authorization, start-date or reference questions (those go to NJ).

## Digital Twin

A live twin: `POST /api/twin` (Netlify Function) retrieves passages from the knowledge base, asks a model to answer from
them only, and the server rejects anything uncited or with numbers that are not in the cited passages. If nothing grounded
survives, the reply is "I don't have that" plus a handoff to NJ (email, and a booking link once set).

| Path | Owner |
| --- | --- |
| `scripts/build-kb.mjs`, `netlify/**`, `twin/**`, `scripts/transforms/DigitalTwin.mjs` | Hand-written. |
| `netlify/functions/twin-kb.json` | **Generated** by `build-kb.mjs` at every build (gitignored). Page sections + design Q&A + `twin/profile.json`. |
| `src/pages/digital-twin.astro` | Generated from the design **through the DigitalTwin transform**; the match button, sources, handoff and API calls live in the transform, not the design. |

- **Knowledge changes:** edit the design (pages) or `twin/profile.json` (facts), then build. Nothing else feeds the twin.
- **Booking link:** set `bookingUrl` in `twin/config.json` (Google Calendar appointment page). While `null`, the twin offers email only.
- **Env vars (Netlify):** `ANTHROPIC_API_KEY` (required; without it the page uses its static Q&A), `TWIN_MODEL` (default
  `claude-haiku-5-5`), `TWIN_ADMIN_TOKEN` (enables `GET /api/twin-log` with `Authorization: Bearer …`, listing unanswered questions).
- **GitHub Pages** is static: its build sets `PUBLIC_TWIN_API` to the Netlify function (CORS-allowed in `twin/config.json`).
- **Logging:** unanswered questions are stored (scrubbed of emails and numbers, no identity) in Netlify Blobs; routed topics store
  the topic only; pasted job descriptions are never stored. The page says so. Keep that notice accurate if logging changes.
- **Test:** `npm run test:twin` (mock model, no key needed). Run it after changing the function, the core, or the profile.

## Local

`npm install`, `npm run dev`. Base path is `/portfolio` (set `SITE_BASE=/` for a custom domain or `<user>.github.io` repo).
