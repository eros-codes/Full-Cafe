import { safeStorage } from '../../../shared/storage.js';
import type { Card, Deck, GameKey } from '../data.js';
import { shuffle, type Rng } from './random.js';

// Drawing cards: from the decks the players chose, never twice in one game, and preferring the cards this
// phone has not seen lately (so the next game at the same table does not start with the same words).

/** The cards of the chosen decks (all of the game's decks when none are chosen), one card per text. */
export function cardPool(decks: readonly Deck[], game: GameKey, deckIds: readonly number[] | null, keep: (card: Card) => boolean = () => true): Card[] {
	const chosen = decks.filter((deck) => deck.games.includes(game) && (!deckIds?.length || deckIds.includes(deck.id)));
	const seen = new Set<string>();
	const pool: Card[] = [];
	for (const deck of chosen) {
		for (const card of deck.cards) {
			if (!keep(card) || seen.has(card.text)) continue;
			seen.add(card.text);
			pool.push(card);
		}
	}
	return pool;
}

/**
 * `count` different cards, in random order: first the ones outside `avoid`, then (only when there are not
 * enough) the avoided ones too.
 */
export function pickCards(pool: readonly Card[], count: number, avoid: ReadonlySet<number>, rng: Rng = Math.random): Card[] {
	const fresh = shuffle(
		pool.filter((card) => !avoid.has(card.id)),
		rng,
	);
	if (fresh.length >= count) return fresh.slice(0, count);
	const rest = shuffle(
		pool.filter((card) => avoid.has(card.id)),
		rng,
	);
	return [...fresh, ...rest].slice(0, count);
}

/**
 * The next card of a game: one not drawn in this game yet, preferably one this phone has not seen lately; a
 * card comes a second time only once every card of the pool was drawn. (Before, as soon as the cards left were
 * all "seen lately", a card already played in this very game could come back while others were never shown.)
 */
export function drawCard(pool: readonly Card[], used: readonly number[], seen: readonly number[], rng: Rng = Math.random): Card | null {
	const usedSet = new Set(used);
	const unused = pool.filter((card) => !usedSet.has(card.id));
	return pickCards(unused.length ? unused : pool, 1, new Set(seen), rng)[0] ?? null;
}

// ─── what this phone has seen ────────────────────────────────────────────────

const SEEN_PREFIX = 'roof.games.seen.';
/** At most this share of a pool is remembered, so there are always unseen cards to draw from. */
const SEEN_SHARE = 0.7;

export function readSeen(game: GameKey): number[] {
	try {
		const value = JSON.parse(safeStorage.get(SEEN_PREFIX + game) || '[]');
		return Array.isArray(value) ? value.filter((id): id is number => Number.isInteger(id)) : [];
	} catch {
		return [];
	}
}

/** Remembers the cards just drawn (newest last); the oldest are forgotten beyond SEEN_SHARE of the pool. */
export function nextSeen(seen: readonly number[], drawn: readonly number[], poolSize: number): number[] {
	const limit = Math.max(0, Math.floor(poolSize * SEEN_SHARE));
	const list = [...seen.filter((id) => !drawn.includes(id)), ...drawn];
	return list.slice(Math.max(0, list.length - limit));
}

export function rememberSeen(game: GameKey, drawn: readonly number[], poolSize: number): void {
	safeStorage.set(SEEN_PREFIX + game, JSON.stringify(nextSeen(readSeen(game), drawn, poolSize)));
}
