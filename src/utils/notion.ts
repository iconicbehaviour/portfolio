// Notion API integration for portfolio content
const NOTION_API_KEY = process.env.NOTION_API_KEY;
const NOTION_DATABASE_ID = process.env.NOTION_DATABASE_ID;
const NOTION_API_URL = 'https://api.notion.com/v1';

interface NotionPage {
	id: string;
	properties: Record<string, any>;
}

async function queryNotionDatabase() {
	if (!NOTION_API_KEY || !NOTION_DATABASE_ID) {
		console.warn('Notion API credentials not configured:', {
			hasKey: !!NOTION_API_KEY,
			hasDb: !!NOTION_DATABASE_ID
		});
		return [];
	}

	try {
		const response = await fetch(`${NOTION_API_URL}/databases/${NOTION_DATABASE_ID}/query`, {
			method: 'POST',
			headers: {
				'Authorization': `Bearer ${NOTION_API_KEY}`,
				'Notion-Version': '2022-06-28',
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({
				filter: {
					property: 'Active',
					checkbox: {
						equals: true,
					},
				},
				sorts: [
					{
						property: 'Order',
						direction: 'ascending',
					},
				],
			}),
		});

		if (!response.ok) {
			const error = await response.text();
			console.error('Notion API error:', response.status, error);
			return [];
		}

		const data = await response.json();
		return data.results as NotionPage[];
	} catch (error) {
		console.error('Failed to fetch Notion database:', error);
		return [];
	}
}

function extractTextProperty(property: any): string {
	if (!property) return '';
	if (property.type === 'title' && property.title?.[0]?.plain_text) {
		return property.title[0].plain_text;
	}
	if (property.type === 'rich_text' && property.rich_text?.[0]?.plain_text) {
		return property.rich_text[0].plain_text;
	}
	if (property.type === 'email' && property.email) {
		return property.email;
	}
	return '';
}

function extractSelectProperty(property: any): string {
	if (!property || property.type !== 'select') return '';
	return property.select?.name || '';
}

export async function getPortfolioData() {
	const pages = await queryNotionDatabase();

	const personalData: any = {};
	const projects: any[] = [];
	const aboutSections: any[] = [];

	for (const page of pages) {
		const props = page.properties;
		const type = extractSelectProperty(props.Type);

		if (type === 'personal') {
			personalData.name = extractTextProperty(props.Name);
			personalData.role = extractTextProperty(props.Role);
			personalData.email = extractTextProperty(props.Email);
			personalData.bio = extractTextProperty(props.Bio);
		} else if (type === 'project') {
			const order = props.Order?.number || 0;
			projects.push({
				id: page.id,
				name: extractTextProperty(props.Name),
				title: extractTextProperty(props.Title),
				description: extractTextProperty(props.Description),
				background: extractSelectProperty(props['Background Color']),
				variant: extractSelectProperty(props.Variant),
				order,
			});
		} else if (type === 'about') {
			const order = props.Order?.number || 0;
			aboutSections.push({
				id: page.id,
				kicker: extractTextProperty(props['Section Kicker']),
				content: extractTextProperty(props.Content),
				order,
			});
		}
	}

	// Sort by order
	projects.sort((a, b) => a.order - b.order);
	aboutSections.sort((a, b) => a.order - b.order);

	return {
		personal: personalData,
		projects,
		aboutSections,
	};
}
