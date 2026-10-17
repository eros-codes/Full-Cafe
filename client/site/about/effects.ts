// Scroll effects of the About page. They only add classes / inline transforms to static markup,
// so they work on the DOM directly from an effect, exactly like the original script did.

/** Header shrinks and blurs once the page is scrolled. */
export function headerOnScroll(header: HTMLElement): () => void {
	const update = () => header.classList.toggle('is-scrolled', window.scrollY > 55);
	window.addEventListener('scroll', update, { passive: true });
	update();
	return () => window.removeEventListener('scroll', update);
}

/** [data-reveal] elements fade in when scrolled into view, staggered within their [data-stagger] group. */
export function revealOnScroll(root: HTMLElement): () => void {
	const io = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const el = entry.target as HTMLElement;
				const staggerParent = el.closest('[data-stagger]') ?? el.parentElement;
				const siblings = staggerParent ? [...staggerParent.querySelectorAll('[data-reveal]')] : [el];
				el.style.transitionDelay = `${siblings.indexOf(el) * 0.09}s`;
				el.classList.add('is-revealed');
				io.unobserve(el);
			}
		},
		{ threshold: 0.1, rootMargin: '0px 0px -40px 0px' },
	);
	root.querySelectorAll('[data-reveal]').forEach((el) => io.observe(el));
	return () => io.disconnect();
}

/** The hero background moves slower than the page (GPU-friendly translate). */
export function heroParallax(bg: HTMLElement): () => void {
	let ticking = false;
	let lastY = 0;
	let frame = 0;
	const update = () => {
		const heroHeight = bg.parentElement?.offsetHeight ?? 0;
		if (lastY < heroHeight) bg.style.transform = `translateY(${lastY * 0.28}px)`;
		ticking = false;
	};
	const onScroll = () => {
		lastY = window.scrollY;
		if (!ticking) {
			ticking = true;
			frame = requestAnimationFrame(update);
		}
	};
	window.addEventListener('scroll', onScroll, { passive: true });
	return () => {
		window.removeEventListener('scroll', onScroll);
		cancelAnimationFrame(frame);
	};
}
