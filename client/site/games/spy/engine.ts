import type { Card } from '../data.js';
import { startClock, type Clock } from '../kit/clock.js';
import { pickCards } from '../kit/deck.js';
import { randomInt, shuffle, type Rng } from '../kit/random.js';

// «جاسوس»: everyone sees the same place except the spy (or two spies), who sees nothing. They take turns
// asking each other questions; the citizens try to find the spy, the spy tries to find out the place
// without being found. Pure functions over plain data (the state is saved on the phone as it is).
//
// How a round ends:
//   - the group accuses a citizen        → the spies win
//   - the group catches a spy            → that spy may still name the place: right → spies, wrong → citizens
//   - a spy stops the game to name it    → right → spies, wrong → citizens (the phone first checks privately
//                                          that whoever stopped it really is a spy: a citizen knows the place)
// Points: every spy +2 when the spies win, every citizen +1 when the citizens win.

export const SPY_PLAYERS = { min: 3, max: 12 } as const;
/** Two spies only make sense in a big group. */
export const TWO_SPIES_FROM = 6;
/** How many places everyone sees in the list (the real one among them). */
export const SPY_CANDIDATES = 20;
export const SPY_MINUTES = { min: 3, max: 12 } as const;

export interface SpySettings {
	players: string[];
	spies: 1 | 2;
	minutes: number;
	/** Decks to draw the places from (empty = all). */
	deckIds: number[];
}

export interface SpyRound {
	place: string;
	placeId: number;
	/** The list everyone may look at, in alphabetical order. */
	candidates: string[];
	/** Indices of the spies in `settings.players`. */
	spies: number[];
	/** Who asks the first question. */
	starter: number;
}

export type SpyOutcome =
	| { winner: 'citizens'; how: 'caught'; accused: number; guess: string }
	| { winner: 'spies'; how: 'escaped'; accused: number; guess: string }
	| { winner: 'spies'; how: 'wrong'; accused: number }
	| { winner: 'spies'; how: 'guessed'; by: number; guess: string }
	| { winner: 'citizens'; how: 'missed'; by: number; guess: string };

export type SpyPhase =
	| { kind: 'setup' }
	/** Passing the phone: `index` is the player whose turn it is to see their card. */
	| { kind: 'deal'; index: number; showing: boolean }
	| { kind: 'play' }
	/** Someone forgot their card: they see it again while the clock runs on. */
	| { kind: 'peek'; index: number | null; showing: boolean }
	/** Someone wants to stop the game and name the place: who (null = still choosing), then a private check. */
	| { kind: 'declare'; index: number | null; showing: boolean }
	| { kind: 'vote' }
	/** A spy names the place: the one just caught (`accused`), or `by` who stopped the game (`accused` null). */
	| { kind: 'guess'; accused: number | null; by: number | null }
	| { kind: 'result'; outcome: SpyOutcome };

export interface SpyState {
	settings: SpySettings;
	round: SpyRound | null;
	/** 1, 2, … */
	roundNo: number;
	scores: number[];
	clock: Clock | null;
	phase: SpyPhase;
}

/** A good length for the questions: longer for bigger groups. */
export function defaultMinutes(players: number): number {
	if (players <= 4) return 5;
	if (players <= 6) return 6;
	if (players <= 8) return 7;
	return 8;
}

export const maxSpies = (players: number): 1 | 2 => (players >= TWO_SPIES_FROM ? 2 : 1);

export function initialSpyState(players: string[], deckIds: number[] = []): SpyState {
	return {
		settings: { players, spies: 1, minutes: defaultMinutes(players.length), deckIds },
		round: null,
		roundNo: 0,
		scores: players.map(() => 0),
		clock: null,
		phase: { kind: 'setup' },
	};
}

/** A new place, new spies and a new first asker. `avoid` = places to keep away from (seen lately). */
export function newRound(settings: SpySettings, pool: readonly Card[], avoid: ReadonlySet<number>, rng: Rng = Math.random): SpyRound {
	if (pool.length < 2) throw new Error('not enough places');
	const [place] = pickCards(pool, 1, avoid, rng);
	const others = shuffle(
		pool.filter((card) => card.id !== place.id && card.text !== place.text),
		rng,
	).slice(0, SPY_CANDIDATES - 1);
	const candidates = [place, ...others].map((card) => card.text).sort((a, b) => a.localeCompare(b, 'fa'));
	const count = Math.min(settings.spies, maxSpies(settings.players.length));
	const spies = shuffle(
		settings.players.map((_, index) => index),
		rng,
	)
		.slice(0, count)
		.sort((a, b) => a - b);
	return { place: place.text, placeId: place.id, candidates, spies, starter: randomInt(settings.players.length, rng) };
}

/** Starts (or restarts) the game with these settings: scores from zero, first round dealt. */
export function startSpyGame(settings: SpySettings, pool: readonly Card[], avoid: ReadonlySet<number>, rng: Rng = Math.random): SpyState {
	return {
		settings: { ...settings, spies: Math.min(settings.spies, maxSpies(settings.players.length)) as 1 | 2 },
		round: newRound(settings, pool, avoid, rng),
		roundNo: 1,
		scores: settings.players.map(() => 0),
		clock: null,
		phase: { kind: 'deal', index: 0, showing: false },
	};
}

/** Same players and scores, the next round. */
export function nextSpyRound(state: SpyState, pool: readonly Card[], avoid: ReadonlySet<number>, rng: Rng = Math.random): SpyState {
	return {
		...state,
		round: newRound(state.settings, pool, avoid, rng),
		roundNo: state.roundNo + 1,
		clock: null,
		phase: { kind: 'deal', index: 0, showing: false },
	};
}

/** After the last player saw their card: the questions start, and the clock with them. */
export function startQuestions(state: SpyState, now = Date.now()): SpyState {
	return { ...state, clock: startClock(state.settings.minutes * 60_000, now), phase: { kind: 'play' } };
}

export const isSpy = (round: SpyRound, player: number) => round.spies.includes(player);

function finish(state: SpyState, outcome: SpyOutcome): SpyState {
	const round = state.round!;
	const scores = state.scores.map((score, player) => {
		if (outcome.winner === 'spies') return isSpy(round, player) ? score + 2 : score;
		return isSpy(round, player) ? score : score + 1;
	});
	return { ...state, scores, phase: { kind: 'result', outcome } };
}

/** The group's choice in the vote. */
export function accuse(state: SpyState, player: number): SpyState {
	if (!state.round) return state;
	if (isSpy(state.round, player)) return { ...state, phase: { kind: 'guess', accused: player, by: null } };
	return finish(state, { winner: 'spies', how: 'wrong', accused: player });
}

/** `player` stops the game to name the place. Only a spy may: for anyone else nothing changes. */
export function declareGuess(state: SpyState, player: number): SpyState {
	if (!state.round || !isSpy(state.round, player)) return state;
	return { ...state, phase: { kind: 'guess', accused: null, by: player } };
}

export function guessPlace(state: SpyState, place: string): SpyState {
	if (!state.round || state.phase.kind !== 'guess') return state;
	const right = place === state.round.place;
	const { accused, by } = state.phase;
	if (accused !== null) {
		return finish(state, right ? { winner: 'spies', how: 'escaped', accused, guess: place } : { winner: 'citizens', how: 'caught', accused, guess: place });
	}
	const spy = by ?? state.round.spies[0];
	return finish(state, right ? { winner: 'spies', how: 'guessed', by: spy, guess: place } : { winner: 'citizens', how: 'missed', by: spy, guess: place });
}
