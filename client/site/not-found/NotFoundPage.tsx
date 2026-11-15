import { BRAND } from '../../shared/brand';

/**
 * An address that is not a page (a mistyped link, an old bookmark): served with status 404, so search engines
 * drop it. Before, any unknown address quietly went to the home page, which search engines count as a broken page
 * («soft 404») and which left a visitor wondering where the page they wanted went.
 */
export function NotFoundPage() {
	return (
		<main className="nf">
			<a href="/" className="nf-mark" aria-label={BRAND.cafeFa}>
				<img src={BRAND.logo.light} alt="" />
			</a>
			<p className="nf-code" aria-hidden="true">
				۴۰۴
			</p>
			<h1>این صفحه پیدا نشد</h1>
			<p className="nf-text">آدرسی که باز کردی در سایت {BRAND.cafeFa} نیست؛ شاید اشتباه تایپ شده یا صفحه جابه‌جا شده.</p>
			<nav className="nf-links" aria-label="صفحه‌های سایت">
				<a href="/" className="nf-primary">
					صفحه‌ی اصلی
				</a>
				<a href="/menu">منو</a>
				<a href="/reserve">رزرو میز</a>
			</nav>
		</main>
	);
}
