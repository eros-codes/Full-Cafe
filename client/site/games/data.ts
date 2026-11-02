import { api } from '../../shared/api.js';
import { safeStorage } from '../../shared/storage.js';

// The data of the games page (GET /api/games, src/services/games.service.ts): the games the café shows and
// the cards of the word games. A copy is kept on the phone, so the games still open when the café's
// Wi-Fi drops; everything else happens on the phone.

export type GameKey = 'spy' | 'heads_up' | 'charades' | 'taboo' | 'tic_tac_toe' | 'connect_four' | 'dots' | 'mafia' | 'ludo' | 'chess' | 'backgammon';

export interface Card {
	id: number;
	text: string;
	/** «کلمات ممنوعه» only. */
	forbidden?: string[];
}

export interface Deck {
	id: number;
	name: string;
	games: GameKey[];
	cards: Card[];
}

export type GamesData = { enabled: false } | { enabled: true; games: GameKey[]; decks: Deck[] };

const CACHE_KEY = 'roof.games.data';

function readCache(): GamesData | null {
	try {
		const value = JSON.parse(safeStorage.get(CACHE_KEY) || 'null') as { data?: GamesData } | null;
		return value?.data && typeof value.data === 'object' ? value.data : null;
	} catch {
		return null;
	}
}

/**
 * The games and their cards. Without a connection the last copy on the phone is used (`offline`); only when
 * there is none either does it fail.
 */
export async function loadGames(): Promise<{ data: GamesData; offline: boolean }> {
	try {
		const data = await api<GamesData>('/api/games', { fallbackMessage: 'خطا در دریافت بازی‌ها' });
		safeStorage.set(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
		return { data, offline: false };
	} catch (error) {
		const cached = readCache();
		if (cached) return { data: cached, offline: true };
		throw error;
	}
}

/** The decks that serve a game. */
export const decksFor = (decks: readonly Deck[], game: GameKey) => decks.filter((deck) => deck.games.includes(game) && deck.cards.length > 0);
