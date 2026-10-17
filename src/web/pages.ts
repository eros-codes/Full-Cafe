// Every page of the site and the HTML entry (under client/) that renders it.
// Shared by the server (which URL serves which page) and vite.config.ts (what to build).
//
// Each page is its own small React app with its own stylesheet, exactly like the separate HTML pages
// before: the café pages, the reservation pages and the admin panel never share CSS, so their styles
// cannot leak into each other.

export interface PageEntry {
	/** HTML entry, relative to client/. */
	html: string;
	/** Clean URL, without trailing slash. */
	path: string;
}

export const PAGES: readonly PageEntry[] = [
	{ path: '/', html: 'site/about/index.html' },
	{ path: '/menu', html: 'site/menu/index.html' },
	{ path: '/feedback', html: 'site/feedback/index.html' },
	{ path: '/reserve', html: 'reserve/booking/index.html' },
	{ path: '/reserve/payment', html: 'reserve/payment/index.html' },
	{ path: '/reserve/invoice', html: 'reserve/invoice/index.html' },
	{ path: '/reserve/profile', html: 'reserve/profile/index.html' },
	{ path: '/reserve/track', html: 'reserve/track/index.html' },
	{ path: '/admin', html: 'admin/panel/index.html' },
	{ path: '/admin/login', html: 'admin/login/index.html' },
];

/**
 * Addresses used before phase 2 (bookmarks, links in old SMS messages) → their new clean URL.
 * The query string is kept, so /reserve/payment.html?id=… still lands on the right reservation.
 */
export const LEGACY_REDIRECTS: Readonly<Record<string, string>> = {
	'/index.html': '/',
	'/about': '/',
	'/src/pages/about/about.html': '/',
	'/src/pages/menu/menu.html': '/menu',
	'/src/pages/feedback/feedback.html': '/feedback',
	'/reserve/index.html': '/reserve',
	'/reserve/payment.html': '/reserve/payment',
	'/reserve/invoice.html': '/reserve/invoice',
	'/reserve/profile.html': '/reserve/profile',
	'/reserve/track.html': '/reserve/track',
	'/admin/index.html': '/admin',
	'/admin/login.html': '/admin/login',
	// addresses of the original reservation project
	'/admin.html': '/admin',
	'/admin-login.html': '/admin/login',
	'/payment.html': '/reserve/payment',
	'/invoice.html': '/reserve/invoice',
	'/profile.html': '/reserve/profile',
	'/track.html': '/reserve/track',
};

/** The page served at this URL path (trailing slash ignored), if any. */
export function findPage(urlPath: string): PageEntry | undefined {
	const clean = urlPath.length > 1 ? urlPath.replace(/\/+$/, '') : urlPath;
	return PAGES.find((page) => page.path === clean);
}
