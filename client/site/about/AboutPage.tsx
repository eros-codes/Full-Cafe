import { useEffect, useRef, useState } from 'react';
import { faDigits } from '../../shared/format';
import { headerOnScroll, heroParallax, revealOnScroll } from './effects';

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
	{ image: 'popular-1.jpg', alt: 'محبوب‌ترین ۱', name: 'دوبل برگر' },
	{ image: 'popular-2.jpg', alt: 'محبوب‌ترین ۲', name: 'کیک کاراملی' },
	{ image: 'popular-3.jpg', alt: 'محبوب‌ترین ۳', name: 'هات نارگیل' },
	{ image: 'popular-4.jpg', alt: 'محبوب‌ترین ۴', name: 'بشقاب انگلیسی' },
	{ image: 'popular-5.jpg', alt: 'محبوب‌ترین ۵', name: 'رد نایت' },
	{ image: 'popular-6.jpg', alt: 'محبوب‌ترین ۶', name: 'پاستا آلفردو' },
];

const FEATURES = [
	{ image: 'burger.jpg', alt: 'برگر', title: 'Signature Burgers', desc: 'گوشت آبدار، نان تازه و طعمی فراموش‌نشدنی' },
	{ image: 'coffee.jpg', alt: 'قهوه', title: 'Premium Coffee', desc: 'عطر دلنشین و طعمی که روزت را می‌سازد' },
	{ image: 'salad.jpg', alt: 'سالاد', title: 'Fresh Salads', desc: 'تازه، سالم و سرشار از طعم‌های طبیعی' },
];

const GALLERY = ['gallery-1.jpg', 'gallery-2.jpg', 'gallery-3.jpg', 'gallery-4.jpg'];

const MAP_EMBED =
	'https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d2221.2995568562746!2d46.35744153622235!3d38.061251949982356!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x401a1b00669db3d3%3A0xc9f8dd2b0fa061f1!2sRoof%20coffee%20shop%20and%20resturant!5e0!3m2!1sen!2s!4v1782896136730!5m2!1sen!2s';

export function AboutPage() {
	const headerRef = useRef<HTMLElement>(null);
	const heroBgRef = useRef<HTMLDivElement>(null);

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
				</nav>
				<a href="#" className="s-header__logo">
					<img src="/images/Logo-2.PNG" alt="روف" />
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
						روف
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
							<img src={`/images/${item.image}`} alt={item.alt} loading="lazy" />
							<div className="s-pop__overlay"></div>
							<span className="s-pop__name">{item.name}</span>
						</div>
					))}
				</div>
			</section>

			<section className="s-gallery" id="s-gallery">
				<div className="s-gallery__header" data-reveal>
					<h2 className="section-title">نگاهی به گوشه‌و‌کنار روف</h2>
					<p className="section-sub">هر میز، یه داستان</p>
				</div>
				<div className="s-gallery__grid" data-stagger>
					{GALLERY.map((image) => (
						<div className="s-gallery__item" data-reveal key={image}>
							<img src={`/images/${image}`} alt="فضای روف" loading="lazy" />
						</div>
					))}
				</div>
			</section>

			<section className="s-hours" id="s-hours">
				<div className="s-hours__inner" data-stagger>
					<div className="s-hours__card" data-reveal>
						<div className="s-hours__row">
							<span className="s-hours__label">ساعات کاری</span>
							<span className="s-hours__value">
								هر روز هفته
								<br />۹ صبح تا ۲۴
							</span>
						</div>
						<div className="s-hours__divider"></div>
						<div className="s-hours__row">
							<span className="s-hours__label">آدرس</span>
							<span className="s-hours__value">
								تبریز، ولیعصر
								<br />
								تقاطع خیابان شهریار و رازی
								<br />
								طبقه فوقانی موبایل اصلانی
							</span>
						</div>
						<div className="s-hours__divider"></div>
						<div className="s-hours__row">
							<span className="s-hours__label">تماس</span>
							<span className="s-hours__value">
								<a href="tel:+989147776655">۰۹۱۴۷۷۷۶۶۵۵</a>
							</span>
						</div>
						<a href="https://maps.app.goo.gl/RgY4GTbZPqftPVsA8" target="_blank" rel="noopener" className="s-hours__map-btn">
							باز کردن در نقشه ←
						</a>
					</div>
					<div className="s-hours__map" data-reveal>
						<iframe
							src={MAP_EMBED}
							loading="lazy"
							referrerPolicy="no-referrer-when-downgrade"
							title="موقعیت کافه روف روی نقشه"
							allowFullScreen
						></iframe>
					</div>
				</div>
			</section>

			<section className="s-cta" id="s-cta">
				<div className="s-cta__text" data-reveal>
					<h2 className="s-cta__title">یه فنجون قهوه منتظرته</h2>
					<p className="s-cta__sub">از صبح تا نیمه‌شب، هر روز هفته</p>
				</div>
				<a href="/menu" className="s-cta__btn" data-reveal>
					بیا روف
				</a>
			</section>

			<footer className="s-footer">
				<div className="s-footer__inner">
					<div className="s-footer__col s-footer__col--brand">
						<span className="s-footer__brand">روف</span>
						<p>
							Fresh coffee, delicious food,
							<br />
							and unforgettable moments.
						</p>
					</div>
					<div className="s-footer__col s-footer__col--social">
						<a href="#" className="s-footer__link">
							<svg xmlns="http://www.w3.org/2000/svg" width="1em" height="1em" viewBox="0 0 24 24">
								<path d="M0 0h24v24H0z" fill="none" />
								<path
									fill="currentColor"
									d="M7.8 2h8.4C19.4 2 22 4.6 22 7.8v8.4a5.8 5.8 0 0 1-5.8 5.8H7.8C4.6 22 2 19.4 2 16.2V7.8A5.8 5.8 0 0 1 7.8 2m-.2 2A3.6 3.6 0 0 0 4 7.6v8.8C4 18.39 5.61 20 7.6 20h8.8a3.6 3.6 0 0 0 3.6-3.6V7.6C20 5.61 18.39 4 16.4 4zm9.65 1.5a1.25 1.25 0 0 1 1.25 1.25A1.25 1.25 0 0 1 17.25 8A1.25 1.25 0 0 1 16 6.75a1.25 1.25 0 0 1 1.25-1.25M12 7a5 5 0 0 1 5 5a5 5 0 0 1-5 5a5 5 0 0 1-5-5a5 5 0 0 1 5-5m0 2a3 3 0 0 0-3 3a3 3 0 0 0 3 3a3 3 0 0 0 3-3a3 3 0 0 0-3-3"
								/>
							</svg>
						</a>
					</div>
				</div>
				<div className="s-footer__bottom">
					<p>© 1405 کافه روف · تمام حقوق محفوظ است</p>
				</div>
			</footer>
		</>
	);
}
