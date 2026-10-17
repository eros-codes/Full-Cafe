import { useCallback, useRef, type ReactNode } from 'react';
import { HamburgerButton, MobileDrawer, useDrawer } from '../../site/common/SiteChrome';

/**
 * Reservation navigation: the same header (site/common/header.css) as the menu page, and a mobile drawer
 * with the four site pages. The reservation links stay in the bar; the line under them is the same
 * `.type-indicator` the menu uses for its tabs, but it follows the mouse (hover) instead of the selection,
 * because every reservation link opens another page.
 */
export function Topbar({ sub, children, navLabel, href = '/reserve', subId }: { sub: string; children: ReactNode; navLabel?: string; href?: string; subId?: string }) {
	const drawer = useDrawer();
	const navRef = useRef<HTMLElement>(null);
	const indicatorRef = useRef<HTMLSpanElement>(null);

	const moveTo = useCallback((target: Element | null) => {
		const nav = navRef.current;
		const indicator = indicatorRef.current;
		if (!nav || !indicator) return;
		const item = target?.closest('a, button') as HTMLElement | null;
		if (!item || !nav.contains(item) || item.hidden) {
			indicator.style.opacity = '0';
			return;
		}
		const navRect = nav.getBoundingClientRect();
		const rect = item.getBoundingClientRect();
		indicator.style.width = `${rect.width}px`;
		indicator.style.transform = `translateX(${rect.left - navRect.left + nav.scrollLeft}px)`;
		indicator.style.opacity = '1';
	}, []);

	return (
		<>
			<header className="menu-header reserve-menu-header" aria-label={sub} id={subId}>
				<div className="menu-header-top">
					<div className="menu-header-right">
						<HamburgerButton drawer={drawer} />
						<a className="menu-logo" href={href} aria-label="کافه روف">
							<img src="/images/Logo-2.PNG" alt="روف" />
						</a>
					</div>
					<nav
						className="menu-options menu-links"
						aria-label={navLabel}
						ref={navRef}
						onMouseOver={(event) => moveTo(event.target as Element)}
						onFocus={(event) => moveTo(event.target as Element)}
						onMouseLeave={() => moveTo(null)}
						onBlur={() => moveTo(null)}
					>
						{children}
						<span className="type-indicator" ref={indicatorRef}></span>
					</nav>
				</div>
			</header>
			<MobileDrawer drawer={drawer} links={['about', 'feedback', 'menu', 'reserve']} />
		</>
	);
}
