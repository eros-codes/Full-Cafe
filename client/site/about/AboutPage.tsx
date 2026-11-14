import { useEffect, useRef, useState } from 'react';
import { api } from '../../shared/api';
import { faDigits } from '../../shared/format';
import { useGamesEnabled } from '../../shared/chrome/SiteChrome';
import { headerOnScroll, heroParallax, revealOnScroll } from './effects';
import { invitationLine, persianYear, weekLines, type WorkingDay } from './hours';
import { BRAND } from '../../shared/brand';

/** The café's working hours from the panel (null while loading, [] when they could not be read). */
function useWorkingHours(): WorkingDay[] | null {
	const [days, setDays] = useState<WorkingDay[] | null>(null);
	useEffect(() => {
		let current = true;
		api<{ days: WorkingDay[] }>('/api/working-hours')
			.then((res) => current && setDays(Array.isArray(res.days) ? res.days : []))
			.catch(() => current && setDays([]));
		return () => {
			current = false;
		};
	}, []);
	return days;
}

/** Counts up from ۰ to `target` (ease-out, 1.5 s) the first time it is half visible. */
function Counter({ target }: { target: number }) {
	const ref = useRef<HTMLSpanElement>(null);
	const [value, setValue] = useState(0);

	useEffect(() => {
		const el = ref.current;
		if (!el) return;
		let frame = 0;
		const io = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return;
				io.disconnect();
				const start = performance.now();
				const tick = (now: number) => {
					const progress = Math.min((now - start) / 1500, 1);
					setValue(Math.round((1 - Math.pow(1 - progress, 3)) * target));
					if (progress < 1) frame = requestAnimationFrame(tick);
				};
				frame = requestAnimationFrame(tick);
			},
			{ threshold: 0.5 },
		);
		io.observe(el);
		return () => {
			io.disconnect();
			cancelAnimationFrame(frame);
		};
	}, [target]);

	return (
		<span className="s-stat__num" ref={ref}>
			{faDigits(value)}
		</span>
	);
}

const POPULAR = [
	{ image: 'popular-1.jpg', name: 'دوبل برگر' },
	{ image: 'popular-2.jpg', name: 'کیک کاراملی' },
	{ image: 'popular-3.jpg', name: 'هات نارگیل' },
	{ image: 'popular-4.jpg', name: 'بشقاب انگلیسی' },
	{ image: 'popular-5.jpg', name: 'رد نایت' },
	{ image: 'popular-6.jpg', name: 'پاستا آلفردو' },
];

const FEATURES = [
	{ image: 'burger.jpg', alt: 'برگر', title: 'Signature Burgers', desc: 'گوشت آبدار، نان تازه و طعمی فراموش‌نشدنی' },
	{ image: 'coffee.jpg', alt: 'قهوه', title: 'Premium Coffee', desc: 'عطر دلنشین و طعمی که روزت را می‌سازد' },
	{ image: 'salad.jpg', alt: 'سالاد', title: 'Fresh Salads', desc: 'تازه، سالم و سرشار از طعم‌های طبیعی' },
];

const GALLERY = ['gallery-1.jpg', 'gallery-2.jpg', 'gallery-3.jpg', 'gallery-4.jpg'];

// The pin of src/brand.ts. Before, the map embedded the old café's Google listing, whose card showed its name.
const PIN = `${BRAND.contact.location.lat},${BRAND.contact.location.lng}`;
const MAP_EMBED = `https://www.google.com/maps?q=${PIN}&z=17&hl=fa&output=embed`;
const MAP_LINK = `https://www.google.com/maps/search/?api=1&query=${PIN}`;
/** 09147776655 → tel:+989147776655 */
const TEL = `tel:+98${BRAND.contact.phone.replace(/^0/, '')}`;

export function AboutPage() {
	const headerRef = useRef<HTMLElement>(null);
	const heroBgRef = useRef<HTMLDivElement>(null);
	const games = useGamesEnabled();
	const hours = useWorkingHours();
	const hourLines = hours?.length ? weekLines(hours) : [];
	const invitation = hours?.length ? invitationLine(hours) : null;

	useEffect(() => {
		const cleanups = [revealOnScroll(document.body)];
		if (headerRef.current) cleanups.push(headerOnScroll(headerRef.current));
		if (heroBgRef.current) cleanups.push(heroParallax(heroBgRef.current));
		return () => cleanups.forEach((cleanup) => cleanup());
	}, []);

	return (
		<>
			<header className="s-header" id="s-header" ref={headerRef}>
				<nav className="s-nav">
					<a href="/menu" className="s-nav__link">
						منو
					</a>
					<a href="#" className="s-nav__link s-nav__link--active">
						درباره ما
					</a>
					<a href="#s-hours" className="s-nav__link">
						آدرس
					</a>
					<a href="/reserve" className="s-nav__link">
						رزرو میز
					</a>
					<a href="/feedback" className="s-nav__link">
						نظرات
					</a>
					{games && (
						<a href="/games" className="s-nav__link">
							بازی‌ها
						</a>
					)}
				</nav>
				<a href="#" className="s-header__logo">
					<img src={BRAND.logo.light} alt={BRAND.nameFa} />
				</a>
			</header>

			<section className="s-hero" id="s-hero">
				<div className="s-hero__bg" ref={heroBgRef}></div>
				<div className="s-hero__overlay"></div>
				<div className="s-hero__content">
					<span className="s-hero__eyebrow" data-reveal>
						کافه · رستوران · صبحانه
					</span>
					<h1 className="s-hero__title" data-reveal>
						{BRAND.nameFa}
					</h1>
					<p className="s-hero__sub" data-reveal>
						سه فضای متفاوت، یک حال‌وهوای مشترک؛
						<br />
						برای قهوه، غذا و لحظه‌هایی که فراموش نمیشن
					</p>
					<a href="/menu" className="s-hero__cta" data-reveal>
						مشاهده منو
					</a>
				</div>
				<div className="s-hero__scroll">
					<span className="s-hero__scroll-line"></span>
				</div>
			</section>

			<section className="s-why" id="s-why">
				<div className="s-why__inner">
					<div className="s-why__text" data-reveal>
						<p className="section-sub">تجربه‌ای متفاوت از خوردن، نوشیدن و لذت بردن در یک فضای منحصربه‌فرد</p>
					</div>
					<div className="s-why__stats" data-stagger>
						<div className="s-stat" data-reveal>
							<div className="s-stat__value">
								<Counter target={5} /> <span className="s-stat__plus">+</span>
							</div>
							<span className="s-stat__label">سال تجربه</span>
						</div>
						<div className="s-stat" data-reveal>
							<div className="s-stat__value">
								<Counter target={100} /> <span className="s-stat__plus">+</span>
							</div>
							<span className="s-stat__label">آیتم متنوع</span>
						</div>
						<div className="s-stat" data-reveal>
							<div className="s-stat__value">
								<Counter target={3} />
							</div>
							<span className="s-stat__label">فضای متفاوت</span>
						</div>
					</div>
				</div>
			</section>

			<section className="s-spaces" id="s-spaces">
				<div className="s-features__grid" data-stagger>
					{FEATURES.map((feature) => (
						<div className="s-feat" data-reveal key={feature.image}>
							<div className="s-feat__img">
								<img src={`/images/${feature.image}`} alt={feature.alt} loading="lazy" />
							</div>
							<div className="s-feat__body">
								<h3 className="s-feat__title">{feature.title}</h3>
								<p className="s-feat__desc">{feature.desc}</p>
							</div>
						</div>
					))}
				</div>
			</section>

			<section className="s-popular" id="s-popular">
				<div className="s-popular__header" data-reveal>
					<h2 className="section-title">این‌هارو همه دوست دارن!</h2>
					<p className="section-sub">آیتم‌هایی که دل هر مهمانی را می‌برند</p>
				</div>
				<div className="s-popular__bento" data-stagger>
					{POPULAR.map((item) => (
						<div className="s-pop" data-reveal key={item.image}>
							{/* the name is written on the photo; a screen reader reads it once, from the label */}
							<img src={`/images/${item.image}`} alt="" loading="lazy" />
							<div className="s-pop__overlay"></div>
							<span className="s-pop__name">{item.name}</span>
						</div>
					))}
				</div>
			</section>

			<section className="s-gallery" id="s-gallery">
				<div className="s-gallery__header" data-reveal>
					<h2 className="section-title">{`نگاهی به گوشه‌و‌کنار ${BRAND.nameFa}`}</h2>
					<p className="section-sub">هر میز، یه داستان</p>
				</div>
				<div className="s-gallery__grid" data-stagger>
					{GALLERY.map((image) => (
						<div className="s-gallery__item" data-reveal key={image}>
							<img src={`/images/${image}`} alt={`فضای ${BRAND.nameFa}`} loading="lazy" />
						</div>
					))}
				</div>
			</section>

			<section className="s-hours" id="s-hours">
				<div className="s-hours__inner" data-stagger>
					<div className="s-hours__card" data-reveal>
						{hours === null || hourLines.length > 0 ? (
							<>
								<div className="s-hours__row">
									<span className="s-hours__label">ساعات کاری</span>
									<span className="s-hours__value" aria-busy={hours === null || undefined}>
										{hours === null
											? '…'
											: hourLines.map((line, i) =>
													hourLines.length === 1 ? (
														<span className="s-hours__line" key={i}>
															{line.days}
															<br />
															{line.hours}
														</span>
													) : (
														<span className="s-hours__line" key={i}>{`${line.days}: ${line.hours}`}</span>
													),
												)}
									</span>
								</div>
								<div className="s-hours__divider"></div>
							</>
						) : null}
						<div className="s-hours__row">
							<span className="s-hours__label">آدرس</span>
							<span className="s-hours__value">
								{BRAND.contact.addressLines.map((line, i) => (
									<span className="s-hours__line" key={i}>
										{line}
									</span>
								))}
							</span>
						</div>
						<div className="s-hours__divider"></div>
						<div className="s-hours__row">
							<span className="s-hours__label">تماس</span>
							<span className="s-hours__value">
								<a href={TEL}>{faDigits(BRAND.contact.phone)}</a>
							</span>
						</div>
						<a href={MAP_LINK} target="_blank" rel="noopener" className="s-hours__map-btn">
							باز کردن در نقشه ←
						</a>
					</div>
					<div className="s-hours__map" data-reveal>
						<iframe
							src={MAP_EMBED}
							loading="lazy"
							referrerPolicy="no-referrer-when-downgrade"
							title={`موقعیت ${BRAND.cafeFa} روی نقشه`}
							allowFullScreen
						></iframe>
					</div>
				</div>
			</section>

			<section className="s-cta" id="s-cta">
				<div className="s-cta__text" data-reveal>
					<h2 className="s-cta__title">یه فنجون قهوه منتظرته</h2>
					{invitation && <p className="s-cta__sub">{invitation}</p>}
				</div>
				<a href="/menu" className="s-cta__btn" data-reveal>
					{`بیا ${BRAND.nameFa}`}
				</a>
			</section>

			<footer className="s-footer">
				<div className="s-footer__inner">
					<div className="s-footer__col s-footer__col--brand">
						<span className="s-footer__brand">{BRAND.nameFa}</span>
						<p>
							{/* English inside the RTL page: without its own direction the commas and the dot ran to the wrong end
								(a class, not only dir="ltr": the site's reset gives every element direction: rtl) */}
							<span dir="ltr" className="s-footer__en">
								Fresh coffee, delicious food,
								<br />
								and unforgettable moments.
							</span>
						</p>
					</div>
					<div className="s-footer__col s-footer__col--social">
						{/* the Instagram page of src/brand.ts; no icon while it is empty (before: a dead «#» link) */}
						{BRAND.contact.instagram && (
							<a href={BRAND.contact.instagram} target="_blank" rel="noopener" className="s-footer__link" aria-label="اینستاگرام">
								<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
									<path d="M0 0h24v24H0z" fill="none" />
									<path
										fill="currentColor"
										d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4zm9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8A1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5a5 5 0 0 1-5 5a5 5 0 0 1-5-5a5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3a3 3 0 0 0 3 3a3 3 0 0 0 3-3a3 3 0 0 0-3-3"
									/>
								</svg>
							</a>
						)}
					</div>
				</div>
				<div className="s-footer__bottom">
					<p>{`© ${persianYear()} ${BRAND.cafeFa} · تمام حقوق محفوظ است`}</p>
				</div>
			</footer>
		</>
	);
}
