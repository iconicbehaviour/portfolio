# Portfolio

Astro site generated from a Claude Design canvas and deployed to GitHub Pages.

- **Design:** https://claude.ai/artifact/9kZVCsAaXJT7mD3L1WoN7D
- **Pages:** Home, Work, Projects, Digital Twin, and seven case studies (AIRA, Nexus, PwC, EGIS, Loop, BeReal, Creator economy)
- **Pipeline:** design → `scripts/sync-design.mjs` → `src/pages/*.astro` → `npm run build:ci` → GitHub Actions → Pages

```bash
npm install
npm run dev          # local preview at http://localhost:4321/portfolio/
npm run build:ci     # build + link/image check
```

Requires Node 22.23.4 or newer.

## One-time GitHub setup

1. Repo **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main`. The site appears at `https://iconicbehaviour.github.io/portfolio/`.

## Updating the site from the design

Edit the design in Claude Design, then ask Claude to "sync the portfolio" (see `CLAUDE.md` for the exact procedure).
The sync regenerates pages, builds, checks links and pushes; the deploy runs on merge to `main`.
Do not hand-edit generated files (see `CLAUDE.md` for what is generated).

## Unfilled placeholders in the design

The build warns about placeholder text still in the design (for example `[Your role]`, `[Product screenshot]`,
`mailto:[your-email]`). Fill them in the design, then sync.
