import type { ImageMetadata } from 'astro';
import bcombsImage from '../assets/images/bcombs.webp';
import boardspeakImage from '../assets/images/boardspeak.webp';
import nestaraImage from '../assets/images/nestara.webp';
import nextpointImage from '../assets/images/nextpoint.webp';
import { getPortfolioData } from '../utils/notion';

export type Project = {
	name: string;
	title: string;
	description: string;
	background: 'lime' | 'cyan' | 'lavender' | 'mint';
	variant: 'desktop' | 'split' | 'mobile' | 'board';
	href: string;
	image: ImageMetadata;
	alt: string;
	imageClass: string;
};

export const workPageSize = 10;

const defaultProjects: Project[] = [
	{
		name: 'NyanTrace',
		title: 'Scaling product strategy across fintech and AI-powered tools',
		description:
			'Led product roadmap, user research, and cross-functional execution. Drove feature launches that increased user engagement and retention.',
		background: 'lime',
		variant: 'desktop',
		href: '/work/nyantrace',
		image: nextpointImage,
		alt: 'NyanTrace product dashboard',
		imageClass: 'project-preview-image',
	},
	{
		name: 'PWC',
		title: 'Building enterprise solutions for financial services',
		description:
			'Owned product roadmap and prioritization for internal tools. Collaborated with design and engineering to deliver high-impact features on tight timelines.',
		background: 'cyan',
		variant: 'split',
		href: '/work/pwc',
		image: bcombsImage,
		alt: 'PWC enterprise product interface',
		imageClass: 'project-preview-image',
	},
	{
		name: 'Method',
		title: 'Product-led growth and user-centric design',
		description:
			'Focused on user-centered product development and data-driven decision making. Led initiatives that improved product adoption and customer satisfaction.',
		background: 'lavender',
		variant: 'mobile',
		href: '/work/method',
		image: nestaraImage,
		alt: 'Method product interface',
		imageClass: 'project-preview-image',
	},
	{
		name: 'Inflection.io',
		title: 'Building products at the intersection of AI and usability',
		description:
			'Contributed to product strategy and feature development. Worked on AI-assisted product features and user experience improvements.',
		background: 'mint',
		variant: 'board',
		href: '/work/inflection',
		image: boardspeakImage,
		alt: 'Inflection.io product preview',
		imageClass: 'project-preview-image',
	},
];

const imageMap: Record<string, ImageMetadata> = {
	nexus: nextpointImage,
	nyantrace: bcombsImage,
	inflectionio: nestaraImage,
	bcombs: bcombsImage,
	boardspeak: boardspeakImage,
	nestara: nestaraImage,
	nextpoint: nextpointImage,
};

async function loadProjects(): Promise<Project[]> {
	try {
		const data = await getPortfolioData();

		if (!data.projects || data.projects.length === 0) {
			console.log('No projects from Notion, using defaults');
			return defaultProjects;
		}

		console.log('Loaded projects from Notion:', data.projects);
		return data.projects.map((project: any) => {
			const imageName = project.name.toLowerCase().replace(/\s+/g, '').replace(/\./g, '');
			const image = imageMap[imageName] || nextpointImage;

			return {
				name: project.name,
				title: project.title,
				description: project.description,
				background: project.background || 'lime',
				variant: project.variant || 'desktop',
				href: `/work/${imageName}`,
				image,
				alt: `${project.name} project preview`,
				imageClass: 'project-preview-image',
			};
		});
	} catch (error) {
		console.error('Failed to load projects from Notion:', error);
		return defaultProjects;
	}
}

export const projects = await loadProjects();
