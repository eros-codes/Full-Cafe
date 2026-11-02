// The games of the games page (/games) and when one can be played. Pure: shared by the server, the seed
// scripts and the tests. The games themselves are code on the site (client/site/games).

export const GAME_KEYS = ['spy', 'heads_up', 'charades', 'taboo', 'tic_tac_toe', 'connect_four', 'dots', 'mafia', 'ludo', 'chess', 'backgammon'] as const;
export type GameKey = (typeof GAME_KEYS)[number];

export interface GameDef {
	key: GameKey;
	/** Name in the admin panel (the site has its own texts). */
	name: string;
	/**
	 * Word games: how many cards (from the active decks of the game) it needs to be playable, and whether
	 * a card only counts with forbidden words. Null for games without cards.
	 */
	cards: { min: number; needsForbidden: boolean } | null;
	defaultActive: boolean;
}

/** Every game, in the default order of the games page. Adding a game = a row here + its code on the site. */
export const GAMES: readonly GameDef[] = [
	{ key: 'spy', name: 'جاسوس', cards: { min: 10, needsForbidden: false }, defaultActive: true },
	{ key: 'heads_up', name: 'گوشی رو پیشونی', cards: { min: 30, needsForbidden: false }, defaultActive: true },
	{ key: 'charades', name: 'پانتومیم', cards: { min: 20, needsForbidden: false }, defaultActive: true },
	{ key: 'taboo', name: 'کلمات ممنوعه', cards: { min: 20, needsForbidden: true }, defaultActive: true },
	{ key: 'tic_tac_toe', name: 'دوز', cards: null, defaultActive: true },
	{ key: 'connect_four', name: 'چهار در یک ردیف', cards: null, defaultActive: true },
	{ key: 'dots', name: 'نقطه‌بازی', cards: null, defaultActive: true },
	{ key: 'mafia', name: 'مافیا', cards: null, defaultActive: true },
	{ key: 'ludo', name: 'منچ', cards: null, defaultActive: true },
	{ key: 'chess', name: 'شطرنج', cards: null, defaultActive: true },
	// off until the café turns it on: some audiences (state TV among them) do not show نرد
	{ key: 'backgammon', name: 'تخته نرد', cards: null, defaultActive: false },
];

/** The games that draw cards from decks (a deck can only be given to these). */
export const CARD_GAME_KEYS = GAMES.filter((game) => game.cards).map((game) => game.key);

export const isCardGameKey = (value: unknown): value is GameKey => isGameKey(value) && CARD_GAME_KEYS.includes(value);

export function isGameKey(value: unknown): value is GameKey {
	return typeof value === 'string' && (GAME_KEYS as readonly string[]).includes(value);
}

/** A card counts for a game when the game can use it (کلمات ممنوعه: only with forbidden words). */
export function cardCountsFor(game: GameDef, card: { forbidden: readonly string[] }): boolean {
	return Boolean(game.cards) && (!game.cards!.needsForbidden || card.forbidden.length > 0);
}

// ─── Game list (shared by the site and the admin panel) ───────────────────────

export interface GameState {
	key: GameKey;
	name: string;
	isActive: boolean;
	sortOrder: number;
	cards: GameDef['cards'];
	/** Cards the game can draw from (active decks that serve it). */
	available: number;
	/** Shown on the site: switched on and, for a word game, enough cards. */
	playable: boolean;
}

interface DeckForCount {
	games: string[];
	isActive: boolean;
	cards: { forbidden: string[] }[];
}

export function gameStates(settings: { key: string; isActive: boolean; sortOrder: number }[], decks: DeckForCount[]): GameState[] {
	const byKey = new Map(settings.map((s) => [s.key, s]));
	return GAMES.map((game, index) => {
		const row = byKey.get(game.key);
		const isActive = row ? row.isActive : game.defaultActive;
		let available = 0;
		if (game.cards) {
			for (const deck of decks) {
				if (!deck.isActive || !deck.games.includes(game.key)) continue;
				available += deck.cards.filter((card) => cardCountsFor(game, card)).length;
			}
		}
		return {
			key: game.key,
			name: game.name,
			isActive,
			sortOrder: row ? row.sortOrder : index,
			cards: game.cards,
			available,
			playable: isActive && (!game.cards || available >= game.cards.min),
		};
	}).sort((a, b) => a.sortOrder - b.sortOrder || GAME_KEYS.indexOf(a.key) - GAME_KEYS.indexOf(b.key));
}
