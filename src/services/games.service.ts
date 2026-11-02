import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { getSettings, type Settings } from './settings.service.js';
import { gameStates, isGameKey, type GameKey, type GameState } from './game-catalog.js';

// The games page (/games): which games the café shows and the cards of the word games. Everything is
// played on one phone in the browser (client/site/games); the server only serves and stores the data.

export const GAMES_SETTING = 'gamesEnabled';

export function isGamesEnabled(settings: Settings): boolean {
	return settings[GAMES_SETTING] === '1';
}

// ─── Site ─────────────────────────────────────────────────────────────────────

export interface PublicCard {
	id: number;
	text: string;
	/** Only present when the card has forbidden words. */
	forbidden?: string[];
}

export interface PublicDeck {
	id: number;
	name: string;
	games: GameKey[];
	cards: PublicCard[];
}

export type GamesData = { enabled: false } | { enabled: true; games: GameKey[]; decks: PublicDeck[] };

async function loadGamesData(): Promise<GamesData> {
	if (!isGamesEnabled(await getSettings())) return { enabled: false };
	const [settings, decks] = await Promise.all([
		prisma.gameSetting.findMany(),
		prisma.gameDeck.findMany({
			where: { isActive: true },
			orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
			include: { cards: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, text: true, forbidden: true } } },
		}),
	]);
	const games = gameStates(settings, decks)
		.filter((g) => g.playable)
		.map((g) => g.key);
	return {
		enabled: true,
		games,
		decks: decks
			.map((deck) => ({
				id: deck.id,
				name: deck.name,
				games: deck.games.filter((key): key is GameKey => isGameKey(key) && games.includes(key)),
				cards: deck.cards.map((card) => (card.forbidden.length ? card : { id: card.id, text: card.text })),
			}))
			.filter((deck) => deck.games.length > 0 && deck.cards.length > 0),
	};
}

const CACHE_TTL_MS = 60 * 1000;
let cache: { data: GamesData; at: number } | null = null;
let pending: Promise<GamesData> | null = null;
let generation = 0;

/** Called after every admin change to the games, the decks or the settings. */
export function invalidateGamesCache(): void {
	cache = null;
	generation++;
}

/** The games page data, cached for a minute (and dropped at once after any admin change). */
export async function getGamesData(): Promise<GamesData> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
	if (pending) return pending;
	const startedAt = generation;
	pending = loadGamesData()
		.then((data) => {
			if (startedAt === generation) cache = { data, at: Date.now() };
			return data;
		})
		.finally(() => {
			pending = null;
		});
	return pending;
}

/** Whether the site links to the games page: switched on and at least one game can be played. */
export async function getGamesStatus(): Promise<{ enabled: boolean }> {
	const data = await getGamesData();
	return { enabled: data.enabled && data.games.length > 0 };
}

// ─── Admin ────────────────────────────────────────────────────────────────────

const deckSummarySelect = {
	id: true,
	name: true,
	games: true,
	isActive: true,
	sortOrder: true,
	cards: { select: { forbidden: true } },
} satisfies Prisma.GameDeckSelect;

export interface DeckSummary {
	id: number;
	name: string;
	games: GameKey[];
	isActive: boolean;
	cardCount: number;
	/** Cards with forbidden words (usable in «کلمات ممنوعه»). */
	withForbidden: number;
}

export async function getAdminGames(): Promise<{ enabled: boolean; games: GameState[]; decks: DeckSummary[] }> {
	const [settings, rows, gameSettings] = await Promise.all([
		getSettings(),
		prisma.gameDeck.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: deckSummarySelect }),
		prisma.gameSetting.findMany(),
	]);
	return {
		enabled: isGamesEnabled(settings),
		games: gameStates(gameSettings, rows),
		decks: rows.map((deck) => ({
			id: deck.id,
			name: deck.name,
			games: deck.games.filter(isGameKey),
			isActive: deck.isActive,
			cardCount: deck.cards.length,
			withForbidden: deck.cards.filter((card) => card.forbidden.length > 0).length,
		})),
	};
}
