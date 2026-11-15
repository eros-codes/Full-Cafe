import { useEffect, useRef, useState } from 'react';

// The panel's small animations that need code (the rest is CSS). Each one runs once, when its part first appears,
// not on every visit: a dashboard opened ten times a day should not count up ten times. With «reduce motion» on in
// the device's settings, nothing moves.

export const reducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * A number that counts up from zero the first time it is shown (0.8 s, slowing at the end), then follows its
 * value at once. `format` turns the number on its way (not a whole number yet) into the text shown.
 */
export function CountUp({ value, format }: { value: number; format: (n: number) => string }) {
	const [shown, setShown] = useState(() => (reducedMotion() ? value : 0));
	const shownRef = useRef(shown);
	const done = useRef(false);

	useEffect(() => {
		if (done.current || reducedMotion()) {
			done.current = true;
			shownRef.current = value;
			setShown(value);
			return;
		}
		const from = shownRef.current;
		const start = performance.now();
		let frame = 0;
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / 800);
			const next = from + (value - from) * (1 - (1 - t) ** 3);
			shownRef.current = next;
			setShown(next);
			if (t < 1) frame = requestAnimationFrame(step);
			// counted once: later values (the dashboard read again) are shown as they are
			else done.current = true;
		};
		frame = requestAnimationFrame(step);
		return () => cancelAnimationFrame(frame);
	}, [value]);

	return <>{format(done.current ? value : shown)}</>;
}

/**
 * True for the first moments after a part appears (`ready`: once it can be drawn): the charts grow in only then.
 * Without it, the CSS animation would play again each time the section is opened (hidden → shown restarts it).
 */
export function useEntering(ready: boolean, ms = 1400): boolean {
	const [entering, setEntering] = useState(true);
	useEffect(() => {
		if (!ready || !entering) return;
		const timer = window.setTimeout(() => setEntering(false), ms);
		return () => window.clearTimeout(timer);
	}, [ready, entering, ms]);
	return entering;
}
