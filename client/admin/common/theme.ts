import { useCallback, useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { reducedMotion } from './motion';

// The panel's light / dark theme. Until the manager picks one, it follows the device; the choice is kept in
// localStorage and put on <html data-theme> (before the page draws, by client/public/admin-theme.js).
//
// Switching: the new theme spreads in a circle from the button (the browser's View Transitions); a browser
// without them fades every colour at once instead (html.theme-fade in theme.css), so cards and page change together.

export type Theme = 'light' | 'dark';
const KEY = 'admin-theme';
const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)');

function current(): Theme {
	const set = document.documentElement.getAttribute('data-theme');
	if (set === 'light' || set === 'dark') return set;
	return darkQuery().matches ? 'dark' : 'light';
}

type ViewTransitionDocument = Document & { startViewTransition?: (update: () => void) => { ready: Promise<void> } };

export function useTheme(): { theme: Theme; toggle: (from?: { x: number; y: number }) => void } {
	const [theme, setTheme] = useState<Theme>(current);

	// the device switching theme (evening mode) while no choice was made
	useEffect(() => {
		const query = darkQuery();
		const follow = () => setTheme(current());
		query.addEventListener('change', follow);
		return () => query.removeEventListener('change', follow);
	}, []);

	const toggle = useCallback((from?: { x: number; y: number }) => {
		const next: Theme = current() === 'dark' ? 'light' : 'dark';
		const root = document.documentElement;
		const apply = () => {
			root.setAttribute('data-theme', next);
			try {
				localStorage.setItem(KEY, next);
			} catch {
				// storage blocked (private window): the choice lasts until the page is closed
			}
			setTheme(next);
		};

		if (reducedMotion()) return apply();

		const doc = document as ViewTransitionDocument;
		if (doc.startViewTransition) {
			const transition = doc.startViewTransition(() => flushSync(apply));
			const x = from?.x ?? window.innerWidth / 2;
			const y = from?.y ?? 0;
			const radius = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
			transition.ready
				.then(() =>
					root.animate(
						{ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
						{ duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
					),
				)
				.catch(() => {
					// the transition was skipped (tab hidden): the theme is already switched
				});
			return;
		}

		root.classList.add('theme-fade');
		apply();
		window.setTimeout(() => root.classList.remove('theme-fade'), 400);
	}, []);

	return { theme, toggle };
}
