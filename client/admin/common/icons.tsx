// Icons only the admin panel's frame uses (the shared ones are in client/shared/icons.tsx). Same line style.

const svg = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

export const ADMIN_ICONS = {
	sun: (
		<svg {...svg} aria-hidden="true">
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2.5v2M12 19.5v2M4.6 4.6l1.4 1.4M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4L6 18M18 6l1.4-1.4" />
		</svg>
	),
	moon: (
		<svg {...svg} aria-hidden="true">
			<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
		</svg>
	),
	menu: (
		<svg {...svg} aria-hidden="true">
			<path d="M4 7h16M4 12h16M4 17h10" />
		</svg>
	),
	close: (
		<svg {...svg} aria-hidden="true">
			<path d="M6 6l12 12M18 6L6 18" />
		</svg>
	),
	external: (
		<svg {...svg} aria-hidden="true">
			<path d="M14 4h6v6M20 4l-8.5 8.5" />
			<path d="M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4" />
		</svg>
	),
	key: (
		<svg {...svg} aria-hidden="true">
			<circle cx="8" cy="15" r="4" />
			<path d="M11 12l9-9M17 6l2.5 2.5M15 8l2 2" />
		</svg>
	),
	logout: (
		<svg {...svg} aria-hidden="true">
			<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" />
			<path d="M10 16l-4-4 4-4M6 12h10" />
		</svg>
	),
	chevronDown: (
		<svg {...svg} aria-hidden="true">
			<path d="M6 9l6 6 6-6" />
		</svg>
	),
	chevronLeft: (
		<svg {...svg} aria-hidden="true">
			<path d="M15 6l-6 6 6 6" />
		</svg>
	),
	trendUp: (
		<svg {...svg} strokeWidth={2} aria-hidden="true">
			<path d="M12 19V5M6 11l6-6 6 6" />
		</svg>
	),
	trendDown: (
		<svg {...svg} strokeWidth={2} aria-hidden="true">
			<path d="M12 5v14M6 13l6 6 6-6" />
		</svg>
	),
	info: (
		<svg {...svg} aria-hidden="true">
			<circle cx="12" cy="12" r="9" />
			<path d="M12 11v5M12 8h.01" />
		</svg>
	),
	eye: (
		<svg {...svg} aria-hidden="true">
			<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	),
} as const;
