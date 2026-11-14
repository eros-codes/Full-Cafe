// The café's name, in one place. The server (SMS texts, the payment gateway's description) and every page
// (titles, header, footer, About page, invoice, admin panel) read it from here, so a café built from this template
// is renamed by changing this file and the three logo files in client/public/images/brand/.
// "Roof" stays the name of the template itself (package, README, code).
//
// No imports: the client (Vite) and the build config load this file too.

const nameFa = 'آوِل';
const nameEn = 'Avel';

export const BRAND = {
	/** The name in Persian text: «آوِل». */
	nameFa,
	/** The Latin name: the logo, the admin panel, the calendar file. */
	nameEn,
	/** «کافه آوِل» */
	cafeFa: `کافه ${nameFa}`,
	/** The About page: address lines, phone, the pin on its map, and the Instagram page ('' = no icon). */
	contact: {
		addressLines: ['تبریز، ولیعصر', 'تقاطع خیابان شهریار و رازی', 'طبقه فوقانی موبایل اصلانی'],
		phone: '09147776655',
		location: { lat: 38.061252, lng: 46.357442 },
		instagram: '',
	},
	/** The logos: the AV monogram (fixed file names: replace the files to change the logo). */
	logo: {
		/** Cream, for the dark header bars and the admin login. */
		light: '/images/brand/logo-light.svg',
		/** Brown, for light backgrounds (the mobile drawer). */
		dark: '/images/brand/logo-dark.svg',
		/** The monogram on brown, square: the browser tab icon. */
		mark: '/images/brand/mark.svg',
	},
} as const;

/** Placeholders in the pages' index.html files, filled in by vite.config.ts (titles, description, tab icon). */
export const BRAND_HTML_TOKENS: Readonly<Record<string, string>> = {
	'%BRAND_FA%': BRAND.nameFa,
	'%BRAND_EN%': BRAND.nameEn,
	'%BRAND_CAFE_FA%': BRAND.cafeFa,
	'%BRAND_MARK%': BRAND.logo.mark,
};

/** Replaces the brand placeholders in a page's HTML. */
export function fillBrandTokens(html: string): string {
	return html.replace(/%BRAND_[A-Z_]+%/g, (token) => BRAND_HTML_TOKENS[token] ?? token);
}
