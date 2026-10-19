import type { ReactElement } from 'react';
import type { Kind } from './engine';

// Line icons of «انتخاب برای من» (the launcher and the kind screen), drawn like the site's other icons.

const svg = (children: ReactElement) => (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		{children}
	</svg>
);

export const SPARK_ICON = svg(
	<>
		<path d="M10 3.5l1.6 4.4a2 2 0 0 0 1.2 1.2l4.4 1.6-4.4 1.6a2 2 0 0 0-1.2 1.2L10 17.9l-1.6-4.4a2 2 0 0 0-1.2-1.2L2.8 10.7l4.4-1.6a2 2 0 0 0 1.2-1.2z" />
		<path d="M18 14.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z" />
	</>,
);

export const KIND_ICONS: Record<Kind, ReactElement> = {
	// a cup on a saucer
	DRINK: svg(
		<>
			<path d="M5 9h11v4.5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" />
			<path d="M16 10.5h1.2a2.3 2.3 0 0 1 0 4.6H16" />
			<path d="M8.5 3.5c0 1 .9 1.4.9 2.6M12 3.5c0 1 .9 1.4.9 2.6" />
			<path d="M4 21h14" />
		</>,
	),
	// fork and knife
	FOOD: svg(
		<>
			<path d="M6 3v5.5a2 2 0 0 0 4 0V3M8 3v18" />
			<path d="M17.5 21V3c-2.2 1.4-3.5 4-3.5 7.5V13h3.5" />
		</>,
	),
	// a cake with a candle
	DESSERT: svg(
		<>
			<rect x="4" y="11.5" width="16" height="8.5" rx="1.5" />
			<path d="M4 15.5c2 0 2-1.4 4-1.4s2 1.4 4 1.4 2-1.4 4-1.4 2 1.4 4 1.4" />
			<path d="M12 11.5V8.5" />
			<path d="M12 4.2c.9.9.9 2.1 0 2.8-.9-.7-.9-1.9 0-2.8z" />
		</>,
	),
};
