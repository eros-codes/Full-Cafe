// Line icons used across the reservation pages and the admin panel (same drawings as phase 1).
// Generated from the old ui.js ICONS and admin roles.js ADMIN_ICONS.

import type { ReactElement } from 'react';

export const ICONS = {
	calendar: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="5" width="17" height="15" rx="3" /><path d="M8 3v4M16 3v4M3.5 10h17" /></svg>
	),
	users: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="9" cy="8" r="3.2" /><path d="M2.8 19c.6-3.2 3-5 6.2-5s5.6 1.8 6.2 5" /><path d="M16 4.2c1.7.3 3 1.8 3 3.6s-1.3 3.3-3 3.6M21.2 19c-.4-2.4-1.6-4-3.5-4.7" /></svg>
	),
	clock: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>
	),
	stop: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M12 8v4" /><path d="M12 16h.01" /></svg>
	),
	table: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><ellipse cx="12" cy="8" rx="7" ry="3.2" /><path d="M5 8v4c0 1.8 3.1 3.2 7 3.2s7-1.4 7-3.2V8M12 15.2V20M8 20h8" /></svg>
	),
	receipt: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.6z" /><path d="M8.5 8h7M8.5 12h7M8.5 16h4" /></svg>
	),
	check: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 13l5 5L20 6" /></svg>
	),
	x: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5l14 14M19 5L5 19" /></svg>
	),
	phone: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.3 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.9 21 3 13.1 3 3.6c0-.6.4-1 1-1H7.6c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.3 0 .7-.3 1z" /></svg>
	),
	shield: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l7 3v6c0 4.5-3 7.8-7 9-4-1.2-7-4.5-7-9V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></svg>
	),
	chart: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20V10M12 20V4M20 20v-7" /></svg>
	),
	gear: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3.2" /><path d="M19.4 13.5a7.6 7.6 0 000-3l1.9-1.5-2-3.4-2.2.9a7.6 7.6 0 00-2.6-1.5L14 2.5h-4l-.5 2.5a7.6 7.6 0 00-2.6 1.5l-2.2-.9-2 3.4L4.6 10.5a7.6 7.6 0 000 3L2.7 15l2 3.4 2.2-.9c.8.7 1.6 1.2 2.6 1.5l.5 2.5h4l.5-2.5a7.6 7.6 0 002.6-1.5l2.2.9 2-3.4z" /></svg>
	),
	logout: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" /></svg>
	),
	plus: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
	),
	trash: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 7h16M9 7V4.5A1.5 1.5 0 0110.5 3h3A1.5 1.5 0 0115 4.5V7m2 0-.7 12.4A2 2 0 0114.3 21H9.7a2 2 0 01-2-1.6L7 7" /></svg>
	),
	home: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 11L12 4l8.5 7" /><path d="M6 9.5V20h12V9.5" /></svg>
	),
	list: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" /></svg>
	),
	door: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 21V4.5L15 3v18M15 12.2h.01" /><path d="M5 21h14" /></svg>
	),
	ban: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M6.5 6.5l11 11" /></svg>
	),
	search: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="10.5" cy="10.5" r="6.5" /><path d="M20 20l-4.3-4.3" /></svg>
	),
	empty: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="7" width="17" height="13" rx="2.5" /><path d="M8 7V5.5A2.5 2.5 0 0110.5 3h3A2.5 2.5 0 0116 5.5V7M3.5 12h17" /></svg>
	),
	cup: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 9h12v5a5 5 0 01-5 5H9a5 5 0 01-5-5z" /><path d="M16 11h1.5a2.5 2.5 0 010 5H16" /><path d="M8 3.5c0 1.2 1 1.6 1 2.8M12 3.5c0 1.2 1 1.6 1 2.8" /></svg>
	),
	tag: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3.5 12.3V4.5a1 1 0 011-1h7.8l8.2 8.2a1.5 1.5 0 010 2.1l-6.2 6.2a1.5 1.5 0 01-2.1 0z" /><circle cx="8" cy="8" r="1.4" /></svg>
	),
	chat: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 5.5h16v10H9l-4.5 3.5v-3.5H4z" /><path d="M8 9.5h8M8 12.5h5" /></svg>
	),
	edit: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="M13.5 6.5l4 4" /></svg>
	),
	image: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3.5" y="4.5" width="17" height="15" rx="2.5" /><circle cx="9" cy="10" r="1.6" /><path d="M20.5 16l-5-5-9 8.5" /></svg>
	),
	eye: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="2.8" /></svg>
	),
	eyeOff: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18" /><path d="M10.6 5.6A9.6 9.6 0 0112 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 01-3 3.8M6.4 6.6A16.5 16.5 0 002.5 12S6 18.5 12 18.5a9.3 9.3 0 004.1-.9" /><path d="M9.9 9.9a2.8 2.8 0 004.2 4.2" /></svg>
	),
	// phase 2: menu types (layers) and add-ons
	layers: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3.5l8.5 4.5-8.5 4.5-8.5-4.5z" /><path d="M3.5 12l8.5 4.5 8.5-4.5" /><path d="M3.5 16l8.5 4.5 8.5-4.5" /></svg>
	),
	addOn: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="8.5" /><path d="M12 8v8M8 12h8" /></svg>
	),
	up: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 14l6-6 6 6" /></svg>
	),
	down: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M6 10l6 6 6-6" /></svg>
	),
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof ICONS;

/** The Roof monogram in the reservation header. */
export const ROOF_MONOGRAM = (
	<svg viewBox="0 0 24 24" fill="none" stroke="#EFEAE4" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
		<path d="M4 12.5L12 5l8 7.5" />
		<path d="M6.5 10.7V19h11v-8.3" />
	</svg>
);
