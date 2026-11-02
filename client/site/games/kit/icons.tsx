// Line icons of the games page (24×24, currentColor), drawn for it.

export const GAME_ICONS = {
	spy: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M2.5 11h19" />
			<path d="M5.5 11l1.6-5.2a1.2 1.2 0 0 1 1.5-.8l1.9.6a2 2 0 0 0 1.2 0l1.9-.6a1.2 1.2 0 0 1 1.5.8L18.5 11" />
			<circle cx="8" cy="16.2" r="2.6" />
			<circle cx="16" cy="16.2" r="2.6" />
			<path d="M10.6 16.2c.9-.6 1.9-.6 2.8 0" />
		</svg>
	),
	heads_up: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="6.5" y="2.5" width="11" height="6.5" rx="1.5" />
			<path d="M9.5 5.75h5" />
			<path d="M5.4 10.6a7 7 0 1 0 13.2 0" />
			<circle cx="9.6" cy="14" r=".7" fill="currentColor" />
			<circle cx="14.4" cy="14" r=".7" fill="currentColor" />
			<path d="M10 17.2c1.2.9 2.8.9 4 0" />
		</svg>
	),
	charades: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<circle cx="12" cy="4.6" r="2.1" />
			<path d="M12 7.5v6.5" />
			<path d="M12 14l-3.3 6.5M12 14l3.3 6.5" />
			<path d="M12 9.3L7 6.2M12 9.3l5.2 1.4" />
			<path d="M4.2 4.3l-1 -.9M4.6 2.6L4.5 1.4M19.6 12.6l1.3.3M19.3 10l1.1-.6" />
		</svg>
	),
	taboo: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M4 4.5h16a1.5 1.5 0 0 1 1.5 1.5v9a1.5 1.5 0 0 1-1.5 1.5H10l-4.5 4v-4H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5z" />
			<path d="M8.5 7.5l7 6M15.5 7.5l-7 6" />
		</svg>
	),
	tic_tac_toe: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M9 3.5v17M15 3.5v17M3.5 9h17M3.5 15h17" opacity=".55" />
			<path d="M4.6 4.6l2.8 2.8M7.4 4.6L4.6 7.4" />
			<circle cx="12" cy="12" r="1.6" />
			<path d="M16.6 16.6l2.8 2.8M19.4 16.6l-2.8 2.8" />
		</svg>
	),
	connect_four: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="3" y="4.5" width="18" height="15" rx="2.6" />
			<circle cx="7.5" cy="9" r="1.6" />
			<circle cx="12" cy="9" r="1.6" />
			<circle cx="16.5" cy="9" r="1.6" fill="currentColor" />
			<circle cx="7.5" cy="15" r="1.6" fill="currentColor" />
			<circle cx="12" cy="15" r="1.6" fill="currentColor" />
			<circle cx="16.5" cy="15" r="1.6" />
		</svg>
	),
	dots: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M5 5h7v7H5zM12 12h7" />
			<rect x="5.8" y="5.8" width="5.4" height="5.4" rx=".6" fill="currentColor" stroke="none" opacity=".35" />
			<g fill="currentColor" stroke="none">
				<circle cx="5" cy="5" r="1.3" />
				<circle cx="12" cy="5" r="1.3" />
				<circle cx="19" cy="5" r="1.3" />
				<circle cx="5" cy="12" r="1.3" />
				<circle cx="12" cy="12" r="1.3" />
				<circle cx="19" cy="12" r="1.3" />
				<circle cx="5" cy="19" r="1.3" />
				<circle cx="12" cy="19" r="1.3" />
				<circle cx="19" cy="19" r="1.3" />
			</g>
		</svg>
	),
	mafia: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M7 9.5l1.2-4.6a1.2 1.2 0 0 1 1.6-.8l1.5.6a2 2 0 0 0 1.4 0l1.5-.6a1.2 1.2 0 0 1 1.6.8L17 9.5" />
			<path d="M2.5 10.2c3 1.4 6.2 2 9.5 2s6.5-.6 9.5-2" />
			<path d="M6.2 13.5c.4 4 2.8 6.5 5.8 6.5s5.4-2.5 5.8-6.5" />
			<path d="M8.8 15.4h2M13.2 15.4h2" />
		</svg>
	),
	ludo: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="3" y="3" width="18" height="18" rx="2.4" />
			<path d="M9.5 3v18M14.5 3v18M3 9.5h18M3 14.5h18" opacity=".45" />
			<path d="M12 9.5l2.5 2.5L12 14.5 9.5 12z" fill="currentColor" stroke="none" />
			<circle cx="6.2" cy="6.2" r="1.4" />
			<circle cx="17.8" cy="17.8" r="1.4" fill="currentColor" />
		</svg>
	),
	chess: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M6.5 20.5h11M8 20.5c0-3 1.5-4.6 3-6.2-1.6-.2-3 .3-4.2 1.2L5.6 14c.5-2.4 1.9-4.6 4-5.8L9 5.8l2 .9c3.6-.4 6.4 2.3 6.6 6.1.1 2.9-1 5.4-1.6 7.7" />
			<circle cx="10.6" cy="10" r=".7" fill="currentColor" />
		</svg>
	),
	backgammon: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="2.5" y="4" width="19" height="16" rx="2" />
			<path d="M12 4v16" />
			<path d="M4.5 4l1.5 6 1.5-6M8.5 20l1.5-6 1.5 6M14.5 4l1.5 6 1.5-6" opacity=".55" />
			<circle cx="17.5" cy="16.3" r="1.7" fill="currentColor" stroke="none" />
			<circle cx="6" cy="16.3" r="1.7" />
		</svg>
	),
} as const;

export const UI_ICONS = {
	close: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
			<path d="M6 6l12 12M18 6L6 18" />
		</svg>
	),
	soundOn: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
			<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11" />
		</svg>
	),
	soundOff: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z" />
			<path d="M16 9.5l5 5M21 9.5l-5 5" />
		</svg>
	),
	rules: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<circle cx="12" cy="12" r="9" />
			<path d="M9.6 9.3a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2.2-2.4 3.6" />
			<path d="M12 17h.01" />
		</svg>
	),
	plus: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
			<path d="M12 5v14M5 12h14" />
		</svg>
	),
	minus: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
			<path d="M5 12h14" />
		</svg>
	),
	trash: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M4.5 7h15M9.5 7V4.8h5V7M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
		</svg>
	),
	pause: (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<rect x="6.5" y="5" width="4" height="14" rx="1.2" />
			<rect x="13.5" y="5" width="4" height="14" rx="1.2" />
		</svg>
	),
	play: (
		<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
			<path d="M17.5 12.9a1 1 0 0 0 0-1.8L8.4 5.6A1 1 0 0 0 6.9 6.5v11a1 1 0 0 0 1.5.9z" />
		</svg>
	),
	check: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M4.5 12.5l5 5L19.5 7" />
		</svg>
	),
	skip: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M15 6l-6 6 6 6" />
		</svg>
	),
	buzz: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
			<path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
		</svg>
	),
	eye: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
			<circle cx="12" cy="12" r="3" />
		</svg>
	),
	list: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
			<path d="M9 6.5h11M9 12h11M9 17.5h11" />
			<circle cx="4.8" cy="6.5" r=".9" fill="currentColor" />
			<circle cx="4.8" cy="12" r=".9" fill="currentColor" />
			<circle cx="4.8" cy="17.5" r=".9" fill="currentColor" />
		</svg>
	),
	trophy: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<path d="M8 4h8v5a4 4 0 0 1-8 0z" />
			<path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4" />
			<path d="M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z" />
		</svg>
	),
	bot: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="4.5" y="7.5" width="15" height="11" rx="3" />
			<path d="M12 7.5V4.5M12 4.5h.01" />
			<circle cx="9.3" cy="12.5" r="1.1" fill="currentColor" />
			<circle cx="14.7" cy="12.5" r="1.1" fill="currentColor" />
			<path d="M9.8 15.8h4.4M2.5 12v2.5M21.5 12v2.5" />
		</svg>
	),
	phone: (
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
			<rect x="6.5" y="2.5" width="11" height="19" rx="2.4" />
			<path d="M10.5 18.5h3" />
		</svg>
	),
} as const;
