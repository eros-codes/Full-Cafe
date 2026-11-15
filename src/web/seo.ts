import express from 'express';
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';
import { BRAND } from '../brand.js';
import { config } from '../config.js';
import { prisma } from '../lib/prisma.js';
import { PROJECT_ROOT } from '../lib/paths.js';
import { getGamesStatus } from '../services/games.service.js';

// What search engines, link previews and phones expect from a website, made from src/brand.ts and the panel's
// data (nothing here is written by hand per café):
//
//   /robots.txt              the public pages may be indexed; the panel, the API and a guest's own pages may not
//   /sitemap.xml             the public pages (the games page only while it is switched on)
//   /site.webmanifest        «add to home screen»: name, colours, icons
//   /icons/icon-192.png …    the app icons, drawn from the logo's mark (client/public/images/brand/mark.svg)
//   /apple-touch-icon.png    the icon an iPhone uses
//   /favicon.ico             browsers ask for it on their own: the same mark, so no 404 in the logs
//   /og-image.png            the picture of a link shared in Telegram, WhatsApp, …: the logo on the café's brown
//
// and, in every page's <head> (seoHead, added when the page is served): the description, the canonical address,
// the link-preview tags (Open Graph), «noindex» for the private pages, and on the home page the café's details as
// structured data (schema.org: address, phone, map pin, opening hours, menu, booking page).

/** The site's address, as set in APP_URL (no trailing slash): canonical links and the sitemap need full URLs. */
const origin = () => config.appUrl.replace(/\/+$/, '');

interface PageMeta {
	title: string;
	description: string;
	/** Public page: indexed and in the sitemap. */
	index: boolean;
}

/** Each page's search snippet. Pages not listed (the panel) are never indexed. */
export const PAGE_META: Readonly<Record<string, PageMeta>> = {
	'/': {
		title: BRAND.cafeFa,
		description: `${BRAND.cafeFa} در ${BRAND.contact.addressLines[0]}: معرفی فضا، ساعت کاری، آدرس و رزرو آنلاین میز.`,
		index: true,
	},
	'/menu': {
		title: `منوی ${BRAND.cafeFa}`,
		description: `منوی کامل ${BRAND.cafeFa} با قیمت: قهوه، نوشیدنی، کیک، صبحانه و غذا؛ با «انتخاب برای من» برای پیدا کردن سفارش مناسب.`,
		index: true,
	},
	'/feedback': {
		title: `نظرات مهمان‌های ${BRAND.cafeFa}`,
		description: `نظر مهمان‌ها درباره‌ی ${BRAND.cafeFa} را بخوانید و نظر خودتان را بنویسید.`,
		index: true,
	},
	'/games': {
		title: `بازی‌های دورهمی ${BRAND.cafeFa}`,
		description: `بازی‌های دورهمی با یک گوشی در ${BRAND.cafeFa}: جاسوس، کلمات ممنوعه، پانتومیم، گوشی رو پیشونی، مافیا، شطرنج و بیشتر.`,
		index: true,
	},
	'/reserve': {
		title: `رزرو میز در ${BRAND.cafeFa}`,
		description: `رزرو آنلاین میز در ${BRAND.cafeFa}: روز و ساعت را انتخاب کنید، میز را روی نقشه‌ی کافه ببینید و پرداخت کنید.`,
		index: true,
	},
	// a guest's own pages: reachable, but not for search results
	'/reserve/payment': { title: `پرداخت رزرو · ${BRAND.nameFa}`, description: `پرداخت رزرو میز ${BRAND.cafeFa}.`, index: false },
	'/reserve/invoice': { title: `فاکتور رزرو · ${BRAND.nameFa}`, description: `فاکتور رزرو میز ${BRAND.cafeFa}.`, index: false },
	'/reserve/profile': { title: `حساب من · ${BRAND.nameFa}`, description: `رزروهای من در ${BRAND.cafeFa}.`, index: false },
	'/reserve/track': { title: `پیگیری رزرو · ${BRAND.nameFa}`, description: `پیگیری رزرو مهمان در ${BRAND.cafeFa}.`, index: false },
};

const escapeHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** «09147776655» → «+989147776655» (schema.org wants the international form). */
const internationalPhone = (phone: string) => (phone.startsWith('0') ? `+98${phone.slice(1)}` : phone);

const SCHEMA_DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

let jsonLdCache: { at: number; value: Promise<string> } | null = null;

/** The structured data, kept for a minute (the home page would otherwise read the hours on every visit). */
function cafeJsonLd(): Promise<string> {
	if (!jsonLdCache || Date.now() - jsonLdCache.at > 60_000) jsonLdCache = { at: Date.now(), value: buildCafeJsonLd() };
	return jsonLdCache.value;
}

/** The café as schema.org data (Google's business panel, maps): with the opening hours of the panel. */
async function buildCafeJsonLd(): Promise<string> {
	const site = origin();
	let hours: object[] = [];
	try {
		const days = await prisma.workingHour.findMany({ where: { isClosed: false }, orderBy: { dayOfWeek: 'asc' } });
		hours = days.map((d) => ({
			'@type': 'OpeningHoursSpecification',
			dayOfWeek: SCHEMA_DAYS[d.dayOfWeek],
			opens: d.opensAt,
			closes: d.closesAt === '24:00' ? '23:59' : d.closesAt,
		}));
	} catch {
		// no database at hand: the page is served without the hours
	}
	const data = {
		'@context': 'https://schema.org',
		'@type': 'CafeOrCoffeeShop',
		name: BRAND.cafeFa,
		alternateName: BRAND.nameEn,
		url: `${site}/`,
		logo: `${site}/icons/icon-512.png`,
		image: `${site}/og-image.png`,
		telephone: internationalPhone(BRAND.contact.phone),
		address: {
			'@type': 'PostalAddress',
			streetAddress: BRAND.contact.addressLines.slice(1).join('، '),
			addressLocality: BRAND.contact.addressLines[0].split('،')[0].trim(),
			addressCountry: 'IR',
		},
		geo: { '@type': 'GeoCoordinates', latitude: BRAND.contact.location.lat, longitude: BRAND.contact.location.lng },
		hasMap: `https://www.google.com/maps?q=${BRAND.contact.location.lat},${BRAND.contact.location.lng}`,
		menu: `${site}/menu`,
		acceptsReservations: `${site}/reserve`,
		servesCuisine: ['قهوه', 'کافه'],
		...(hours.length ? { openingHoursSpecification: hours } : {}),
		...(BRAND.contact.instagram ? { sameAs: [BRAND.contact.instagram] } : {}),
	};
	// «</» inside the JSON would end the script tag early
	return JSON.stringify(data).replace(/</g, '\\u003c');
}

/** The tags added to a page's <head> (before the page's own): see the list at the top of this file. */
export async function seoHead(pagePath: string): Promise<string> {
	const meta = PAGE_META[pagePath];
	const site = origin();
	const common = [
		`<link rel="manifest" href="/site.webmanifest" />`,
		`<link rel="apple-touch-icon" href="/apple-touch-icon.png" />`,
		`<link rel="icon" type="image/png" sizes="192x192" href="/icons/icon-192.png" />`,
	];
	// the panel and the 404 page say «noindex» in their own HTML
	if (!meta) return common.join('\n\t\t');
	const url = `${site}${pagePath === '/' ? '/' : pagePath}`;
	const tags = [
		...common,
		`<meta name="description" content="${escapeHtml(meta.description)}" />`,
		meta.index ? `<link rel="canonical" href="${url}" />` : `<meta name="robots" content="noindex, follow" />`,
		`<meta property="og:type" content="website" />`,
		`<meta property="og:site_name" content="${escapeHtml(BRAND.cafeFa)}" />`,
		`<meta property="og:locale" content="fa_IR" />`,
		`<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
		`<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
		`<meta property="og:url" content="${url}" />`,
		`<meta property="og:image" content="${site}/og-image.png" />`,
		`<meta property="og:image:width" content="1200" />`,
		`<meta property="og:image:height" content="630" />`,
		`<meta name="twitter:card" content="summary_large_image" />`,
	];
	if (pagePath === '/') tags.push(`<script type="application/ld+json">${await cafeJsonLd()}</script>`);
	return tags.join('\n\t\t');
}

/** The page's HTML with the SEO tags: its own description tag (if any) is replaced by the one above. */
export async function withSeo(html: string, pagePath: string): Promise<string> {
	const head = await seoHead(pagePath);
	const cleaned = PAGE_META[pagePath] ? html.replace(/\s*<meta name="description"[^>]*>/i, '') : html;
	return cleaned.replace(/<\/head>/i, `\t${head}\n\t</head>`);
}

// ─── the files ───────────────────────────────────────────────────────────────

export const seoRouter = express.Router();

seoRouter.get('/robots.txt', (_req, res) => {
	res.type('text/plain').send(
		[
			'User-agent: *',
			'Allow: /',
			'Disallow: /admin',
			'Disallow: /api/',
			'Disallow: /reserve/payment',
			'Disallow: /reserve/invoice',
			'Disallow: /reserve/profile',
			'Disallow: /reserve/track',
			'',
			`Sitemap: ${origin()}/sitemap.xml`,
			'',
		].join('\n'),
	);
});

seoRouter.get('/sitemap.xml', async (_req, res, next) => {
	try {
		const { enabled } = await getGamesStatus().catch(() => ({ enabled: false }));
		const paths = Object.entries(PAGE_META)
			.filter(([pagePath, meta]) => meta.index && (pagePath !== '/games' || enabled))
			.map(([pagePath]) => pagePath);
		const urls = paths.map((p) => `\t<url>\n\t\t<loc>${origin()}${p}</loc>\n\t\t<priority>${p === '/' ? '1.0' : '0.8'}</priority>\n\t</url>`);
		res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
	} catch (error) {
		next(error);
	}
});

seoRouter.get('/site.webmanifest', (_req, res) => {
	res.type('application/manifest+json').json({
		name: BRAND.cafeFa,
		short_name: BRAND.nameFa,
		description: PAGE_META['/'].description,
		lang: 'fa',
		dir: 'rtl',
		start_url: '/',
		scope: '/',
		display: 'standalone',
		background_color: '#EFEAE4',
		theme_color: '#422E2F',
		icons: [
			{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
			{ src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
			{ src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
		],
	});
});

// The icons are drawn once from the logo files (so a café with another logo gets its own icons) and kept in memory.
// the built copy first (a server with only dist/), then the sources
const PUBLIC_DIRS = [path.join(PROJECT_ROOT, 'dist', 'client'), path.join(PROJECT_ROOT, 'client', 'public')];
const images = new Map<string, Promise<Buffer>>();
const LOGO_BROWN = '#3A1F12';

async function brandFile(url: string): Promise<Buffer> {
	for (const dir of PUBLIC_DIRS) {
		try {
			return await fs.readFile(path.join(dir, url.replace(/^\//, '')));
		} catch {
			// not in this folder
		}
	}
	throw new Error(`${url} پیدا نشد (client/public).`);
}

/** The square mark (brown with the cream monogram) at `size`; `padding` leaves the safe zone a maskable icon needs. */
async function markPng(size: number, padding = 0): Promise<Buffer> {
	if (!padding) return sharp(await brandFile(BRAND.logo.mark), { density: 384 }).resize(size, size).png().toBuffer();
	const inner = Math.round(size * (1 - 2 * padding));
	const logo = await sharp(await brandFile(BRAND.logo.light), { density: 384 }).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
	return sharp({ create: { width: size, height: size, channels: 4, background: LOGO_BROWN } })
		.composite([{ input: logo, gravity: 'centre' }])
		.png()
		.toBuffer();
}

/** The link preview: the cream logo in the middle of a 1200×630 brown card. */
async function ogPng(): Promise<Buffer> {
	const logo = await sharp(await brandFile(BRAND.logo.light), { density: 384 }).resize(520, 340, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
	return sharp({ create: { width: 1200, height: 630, channels: 4, background: LOGO_BROWN } })
		.composite([{ input: logo, gravity: 'centre' }])
		.png()
		.toBuffer();
}

const IMAGES: Record<string, () => Promise<Buffer>> = {
	'/icons/icon-192.png': () => markPng(192),
	'/icons/icon-512.png': () => markPng(512),
	'/icons/icon-maskable-512.png': () => markPng(512, 0.18),
	'/apple-touch-icon.png': () => markPng(180, 0.12),
	'/favicon.ico': () => markPng(48),
	'/og-image.png': ogPng,
};

for (const [url, draw] of Object.entries(IMAGES)) {
	seoRouter.get(url, async (_req, res, next) => {
		try {
			if (!images.has(url)) images.set(url, draw());
			const png = await images.get(url)!.catch((error: unknown) => {
				images.delete(url);
				throw error;
			});
			res.setHeader('Cache-Control', config.isProd ? 'public, max-age=86400' : 'no-cache');
			res.type('png').send(png);
		} catch (error) {
			next(error);
		}
	});
}
