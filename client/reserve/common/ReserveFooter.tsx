import { SiteFooter } from '../../shared/chrome/SiteChrome';

/** The same footer as the menu and feedback pages (SiteFooter) — same markup, same styles. */
export function ReserveFooter() {
	return <SiteFooter links={['about', 'contact', 'menu', 'feedback']} />;
}
