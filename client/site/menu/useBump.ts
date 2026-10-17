import { useLayoutEffect, useRef } from 'react';

/**
 * A small "pulse" each time a number changes (the .is-bumped animation in common/motion.css).
 * Returns a ref for the element showing the value.
 */
export function useBump<T extends HTMLElement>(value: string) {
	const ref = useRef<T>(null);
	const previous = useRef(value);
	useLayoutEffect(() => {
		const el = ref.current;
		if (el && value && value !== previous.current) {
			el.classList.remove('is-bumped');
			void el.offsetWidth; // restart the animation
			el.classList.add('is-bumped');
		}
		previous.current = value;
	}, [value]);
	return ref;
}
