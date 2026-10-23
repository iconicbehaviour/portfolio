import { defineConfig } from 'astro/config';

// Served from https://iconicbehaviour.github.io/portfolio/ by default (GitHub Pages project site).
// Using a custom domain or a <user>.github.io repo? Set SITE_URL and SITE_BASE=/ in the deploy workflow.
const site = process.env.SITE_URL ?? 'https://iconicbehaviour.github.io';
const base = process.env.SITE_BASE ?? '/portfolio';

export default defineConfig({
  site,
  base,
  trailingSlash: 'always',
  build: { format: 'directory' },
});
