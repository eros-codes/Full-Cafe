import type { Card } from '../data.js';
import { startClock, type Clock } from '../kit/clock.js';

// The three word games share one engine: a side (a team, or one player in «گوشی رو پیشونی») plays a turn
// against the clock; every card is guessed (+1), passed (0) or, in «کلمات ممنوعه», lost to a forbidden
// word (−1). After the turn the cards are listed and a wrong tap can still be fixed. Every side plays
// `rounds` turns; the most points wins. Pure functions over plain data (saved on the phone as it is).

export type WordMode = 'heads_up' | 'charades' | 'taboo';
export type Outcome = 'correct' | 'pass' | 'buzz';

export interface WordResult {
	id: number;
	text: string;
	outcome: Outcome;
}

export interface WordSettings {
	mode: WordMode;
	/** Team names, or the players' names in «گوشی رو پیشونی». */
	sides: string[];
	seconds: number;
	rounds: number;
	deckIds: number[];
	/** «پانتومیم»: one word per turn (the turn ends at the first guess) instead of as many as fit. */
	oneWord: boolean;
}

export type WordPhase =
	| { kind: 'setup' }
	/** Between turns: whose turn, the scores, a button to start. */
	| { kind: 'ready' }
	| { kind: 'play'; clock: Clock; card: Card; results: WordResult[] }
	| { kind: 'review'; results: WordResult[] }
	| { kind: 'over' };

export interface WordState {
	settings: WordSettings;
	scores: number[];
	/** Turns finished so far. */
	turn: number;
	/** Cards drawn in this game (never drawn twice while others are left). */
	used: number[];
	phase: WordPhase;
}

export const WORD_LIMITS = {
	heads_up: { sides: { min: 2, max: 12 }, seconds: [45, 60, 90], defaultSeconds: 60, rounds: { min: 1, max: 5 }, defaultRounds: 2 },
	charades: { sides: { min: 2, max: 4 }, seconds: [60, 90, 120, 180], defaultSeconds: 90, rounds: { min: 1, max: 10 }, defaultRounds: 3 },
	taboo: { sides: { min: 2, max: 4 }, seconds: [45, 60, 90], defaultSeconds: 60, rounds: { min: 1, max: 10 }, defaultRounds: 3 },
} as const;

export function initialWordState(mode: WordMode, sides: string[], deckIds: number[] = []): WordState {
	const limits = WORD_LIMITS[mode];
	return {
		settings: { mode, sides, seconds: limits.defaultSeconds, rounds: limits.defaultRounds, deckIds, oneWord: false },
		scores: sides.map(() => 0),
		turn: 0,
		used: [],
		phase: { kind: 'setup' },
	};
}

export const totalTurns = (state: WordState) => state.settings.rounds * state.settings.sides.length;
/** The side whose turn it is. */
export const currentSide = (state: WordState) => state.turn % state.settings.sides.length;
/** 1-based round of the current turn. */
export const currentRound = (state: WordState) => Math.floor(state.turn / state.settings.sides.length) + 1;

export function startWordGame(settings: WordSettings): WordState {
	return { settings, scores: settings.sides.map(() => 0), turn: 0, used: [], phase: { kind: 'ready' } };
}

export function startTurn(state: WordState, card: Card, now = Date.now()): WordState {
	return {
		...state,
		used: [...state.used, card.id],
		phase: { kind: 'play', clock: startClock(state.settings.seconds * 1000, now), card, results: [] },
	};
}

/**
 * Whether this answer ends the turn on its own (pantomime with one word per turn, once it is guessed). The game
 * then draws no next card: a card drawn and never shown would only be marked "seen" on the phone for nothing.
 */
export const endsTurn = (state: WordState, outcome: Outcome) => state.settings.mode === 'charades' && state.settings.oneWord && outcome === 'correct';

/**
 * The players' answer to the card on screen. `next` is the following card (null when there is none left);
 * the turn goes on with it, unless the turn is over (one word per turn and it was guessed, or no card left).
 */
export function answer(state: WordState, outcome: Outcome, next: Card | null): WordState {
	if (state.phase.kind !== 'play') return state;
	const { card, results, clock } = state.phase;
	if (outcome === 'buzz' && state.settings.mode !== 'taboo') return state;
	const done = [...results, { id: card.id, text: card.text, outcome }];
	if (endsTurn(state, outcome) || !next) return { ...state, phase: { kind: 'review', results: done } };
	return { ...state, used: [...state.used, next.id], phase: { kind: 'play', clock, card: next, results: done } };
}

/** The clock ran out: the card on screen was not guessed in time. */
export function timeUp(state: WordState): WordState {
	if (state.phase.kind !== 'play') return state;
	const { card, results } = state.phase;
	return { ...state, phase: { kind: 'review', results: [...results, { id: card.id, text: card.text, outcome: 'pass' }] } };
}

const CYCLE: Record<WordMode, Outcome[]> = {
	heads_up: ['correct', 'pass'],
	charades: ['correct', 'pass'],
	taboo: ['correct', 'pass', 'buzz'],
};

/** Fixing a wrong tap in the list after the turn: the next outcome of the cycle. */
export function toggleResult(state: WordState, index: number): WordState {
	if (state.phase.kind !== 'review' || !state.phase.results[index]) return state;
	const cycle = CYCLE[state.settings.mode];
	const results = state.phase.results.map((result, i) => {
		if (i !== index) return result;
		const at = cycle.indexOf(result.outcome);
		return { ...result, outcome: cycle[(at + 1) % cycle.length] };
	});
	return { ...state, phase: { kind: 'review', results } };
}

export function turnPoints(results: readonly WordResult[]): number {
	return results.reduce((sum, r) => sum + (r.outcome === 'correct' ? 1 : r.outcome === 'buzz' ? -1 : 0), 0);
}

/** The turn's points go to its side; then the next side's turn, or the end of the game. */
export function finishTurn(state: WordState): WordState {
	if (state.phase.kind !== 'review') return state;
	const side = currentSide(state);
	const points = turnPoints(state.phase.results);
	const scores = state.scores.map((score, i) => (i === side ? score + points : score));
	const turn = state.turn + 1;
	return { ...state, scores, turn, phase: turn >= totalTurns(state) ? { kind: 'over' } : { kind: 'ready' } };
}

/** Indices of the sides with the best score (more than one on a tie). */
export function leaders(scores: readonly number[]): number[] {
	const best = Math.max(...scores);
	return scores.flatMap((score, i) => (score === best ? [i] : []));
}

/** The same sides and settings, from zero. */
export const playAgain = (state: WordState): WordState => startWordGame(state.settings);
