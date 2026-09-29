// @ts-check
import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import tailwindcss from '@tailwindcss/vite';
import { siteConfig } from './src/config/site.ts';

const usingFallbackSiteUrl =
	!process.env.SITE_URL &&
	!process.env.PUBLIC_SITE_URL &&
	siteConfig.siteUrl === 'https://maria-lake.vercel.app';

if (usingFallbackSiteUrl) {
	console.warn(
		'[maria-theme] Using the default demo URL for SEO metadata. Set SITE_URL or PUBLIC_SITE_URL before publishing so canonical URLs and the sitemap are correct.'
	);
}

// https://astro.build/config
export default defineConfig({
	site: siteConfig.siteUrl,
	integrations: [
		mdx(),
		sitemap({
			filter(page) {
				const pathname = new URL(page).pathname;
				return !['/cookies/', '/privacy/', '/terms/'].includes(pathname);
			},
		}),
	],
	vite: {
		plugins: [tailwindcss()],
	},
});
