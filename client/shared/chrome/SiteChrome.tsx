import { useCallback, useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

// Pieces shared by every public page (menu, feedback, reservation) and the admin panel: the drawer (with its
// hamburger button, on every screen size) and the footer. Styles: header.css and footer.css in this folder.

export type LinkKey = 'menu' | 'about' | 'contact' | 'feedback' | 'reserve' | 'profile' | 'track';

const LINKS: Record<LinkKey, { href: string; label: string; icon: ReactNode }> = {
	menu: {
		href: '/menu',
		label: 'منو',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 32 32">
				<path d="M0 0h32v32H0z" fill="none" />
				<g fill="none" stroke="currentColor">
					<path
						strokeLinecap="round"
						strokeLinejoin="round"
						strokeWidth="2"
						d="M10 9h4m-4 7h12m-12 4h12m-12 4h4m-6 5h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v22a2 2 0 0 0 2 2"
					/>
					<circle cx="22" cy="9" r=".5" fill="currentColor" />
				</g>
			</svg>
		),
	},
	about: {
		href: '/',
		label: 'درباره ما',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
				<path d="M0 0h24v24H0z" fill="none" />
				<path
					fill="currentColor"
					d="M11 17h2v-6h-2zm1.713-8.287Q13 8.425 13 8t-.288-.712T12 7t-.712.288T11 8t.288.713T12 9t.713-.288M12 22q-2.075 0-3.9-.788t-3.175-2.137T2.788 15.9T2 12t.788-3.9t2.137-3.175T8.1 2.788T12 2t3.9.788t3.175 2.137T21.213 8.1T22 12t-.788 3.9t-2.137 3.175t-3.175 2.138T12 22m0-2q3.35 0 5.675-2.325T20 12t-2.325-5.675T12 4T6.325 6.325T4 12t2.325 5.675T12 20m0-8"
				/>
			</svg>
		),
	},
	contact: {
		href: '/#s-hours',
		label: 'تماس با ما',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 12 12">
				<path d="M0 0h12v12H0z" fill="none" />
				<path
					fill="currentColor"
					d="M5.561 2.551a.84.84 0 0 0-1.033-.514c-.973.3-1.653 1.135-1.507 2.101A8.7 8.7 0 0 0 4.092 7.18a8.8 8.8 0 0 0 2.083 2.445c.754.61 1.812.442 2.558-.258A.85.85 0 0 0 8.81 8.21l-.534-.653a.845.845 0 0 0-.91-.272l-1.232.39l-.215-.222a5 5 0 0 1-.706-.929a4.8 4.8 0 0 1-.446-1.079l-.083-.295l.95-.875a.86.86 0 0 0 .221-.935zm-1.327-1.47a1.84 1.84 0 0 1 2.264 1.121l.293.788a1.86 1.86 0 0 1-.48 2.019l-.49.451c.063.174.148.373.258.566c.11.19.238.363.355.504l.63-.2a1.845 1.845 0 0 1 1.985.593l.534.653a1.85 1.85 0 0 1-.166 2.52c-.994.933-2.617 1.32-3.87.306a9.8 9.8 0 0 1-2.32-2.722a9.7 9.7 0 0 1-1.195-3.393c-.24-1.593.903-2.806 2.202-3.205"
				/>
			</svg>
		),
	},
	feedback: {
		href: '/feedback',
		label: 'ثبت نظر',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
				<path d="M0 0h24v24H0z" fill="none" />
				<path
					fill="none"
					stroke="currentColor"
					strokeLinecap="round"
					strokeLinejoin="round"
					strokeWidth="1.5"
					d="M3.464 16.828C2 15.657 2 14.771 2 11s0-5.657 1.464-6.828C4.93 3 7.286 3 12 3s7.071 0 8.535 1.172S22 7.229 22 11s0 4.657-1.465 5.828C19.072 18 16.714 18 12 18c-2.51 0-3.8 1.738-6 3v-3.212c-1.094-.163-1.899-.45-2.536-.96"
				/>
			</svg>
		),
	},
	reserve: {
		href: '/reserve',
		label: 'رزرو میز',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
				<path d="M0 0h24v24H0z" fill="none" />
				<g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
					<rect x="3.5" y="5" width="17" height="15" rx="3" />
					<path d="M8 3v4M16 3v4M3.5 10h17" />
				</g>
			</svg>
		),
	},
	profile: {
		href: '/reserve/profile',
		label: 'پروفایل',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
				<path d="M0 0h24v24H0z" fill="none" />
				<g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
					<circle cx="12" cy="8" r="3.5" />
					<path d="M4.5 21a7.5 7.5 0 0 1 15 0" />
				</g>
			</svg>
		),
	},
	track: {
		href: '/reserve/track',
		label: 'پیگیری رزرو',
		icon: (
			<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
				<path d="M0 0h24v24H0z" fill="none" />
				<g fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5">
					<rect x="3.5" y="5" width="17" height="15" rx="3" />
					<path d="M8 3v4M16 3v4M3.5 10h17M8 14h3" />
				</g>
			</svg>
		),
	},
};

export interface Drawer {
	open: boolean;
	openDrawer: () => void;
	closeDrawer: () => void;
	hamburgerRef: RefObject<HTMLButtonElement | null>;
	drawerRef: RefObject<HTMLElement | null>;
	closeRef: RefObject<HTMLButtonElement | null>;
}

/** State of the mobile side drawer: page scroll is locked while it is open; Esc or a click outside closes it. */
export function useDrawer(): Drawer {
	const [open, setOpen] = useState(false);
	const hamburgerRef = useRef<HTMLButtonElement>(null);
	const drawerRef = useRef<HTMLElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);

	const openDrawer = useCallback(() => setOpen(true), []);
	const closeDrawer = useCallback(() => {
		// فوکوس داخل منوی بسته‌شده نماند
		if (drawerRef.current?.contains(document.activeElement)) hamburgerRef.current?.focus();
		setOpen(false);
	}, []);

	useEffect(() => {
		if (!open) return;
		closeRef.current?.focus();
		document.documentElement.style.overflow = 'hidden';
		document.body.style.overflow = 'hidden';
		const onClick = (event: MouseEvent) => {
			const target = event.target as Node;
			if (!drawerRef.current?.contains(target) && !hamburgerRef.current?.contains(target)) closeDrawer();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') closeDrawer();
		};
		document.addEventListener('click', onClick);
		document.addEventListener('keydown', onKey);
		return () => {
			document.documentElement.style.overflow = '';
			document.body.style.overflow = '';
			document.removeEventListener('click', onClick);
			document.removeEventListener('keydown', onKey);
		};
	}, [open, closeDrawer]);

	return { open, openDrawer, closeDrawer, hamburgerRef, drawerRef, closeRef };
}

export function HamburgerButton({ drawer }: { drawer: Drawer }) {
	return (
		<button
			id="mobile-hamburger"
			className="mobile-hamburger"
			aria-label="باز کردن منو"
			aria-controls="mobile-drawer"
			aria-expanded={drawer.open}
			ref={drawer.hamburgerRef}
			onClick={(event) => {
				event.stopPropagation();
				drawer.openDrawer();
			}}
		>
			<span className="hamburger-icon">
				<span></span>
				<span></span>
				<span></span>
			</span>
		</button>
	);
}

/** The backdrop and the drawer itself (placed at the end of the page, like the original markup). */
/** The page the visitor is on is left out of the drawer (a link to itself would only reload it). */
function isCurrentPage(href: string): boolean {
	const here = window.location.pathname.replace(/\/+$/, '') || '/';
	return href === here;
}

export function MobileDrawer({ drawer, links }: { drawer: Drawer; links: LinkKey[] }) {
	const shown = links.filter((key) => !isCurrentPage(LINKS[key].href));
	return (
		<>
			<div id="drawer-backdrop" className={`drawer-backdrop${drawer.open ? ' visible' : ''}`} onClick={drawer.closeDrawer}></div>
			<aside
				id="mobile-drawer"
				className={`mobile-drawer${drawer.open ? ' open' : ''}`}
				inert={!drawer.open}
				aria-hidden={!drawer.open}
				ref={drawer.drawerRef}
			>
				<button
					id="drawer-close"
					className="drawer-close"
					aria-label="بستن منو"
					ref={drawer.closeRef}
					onClick={(event) => {
						event.stopPropagation();
						drawer.closeDrawer();
					}}
				>
					&times;
				</button>
				<img src="/images/Logo-3.PNG" alt="روف" className="drawer-logo" />
				<nav className="mobile-drawer-nav">
					<ul className="menu-footer-links">
						{shown.map((key) => (
							<li key={key}>
								<a href={LINKS[key].href}>
									{LINKS[key].icon}
									<span className="link-text">{LINKS[key].label}</span>
								</a>
							</li>
						))}
					</ul>
				</nav>
			</aside>
		</>
	);
}

/** The same credit line on every page. */
const CREDIT = 'Made with love 🤍';

export function SiteFooter({ links, className }: { links: LinkKey[]; className?: string }) {
	return (
		<footer className={className ? `menu-footer ${className}` : 'menu-footer'}>
			<div>
				<div className="menu-footer-top">
					<h6 className="menu-footer-subtitle">your daily escape</h6>
					<h4 className="menu-footer-title">Roof,</h4>
				</div>
				<div>
					<ul className="menu-footer-links">
						{links.map((key) => (
							<li key={key}>
								<a href={LINKS[key].href}>{LINKS[key].label}</a>
							</li>
						))}
					</ul>
				</div>
			</div>
			<h6 className="menu-footer-copyright">تمامی حقوق این سایت متعلق به کافه روف می باشد.</h6>
			<h6 className="menu-footer-credit">{CREDIT}</h6>
		</footer>
	);
}
