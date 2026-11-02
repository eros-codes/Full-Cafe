import type { Rng } from '../kit/random.js';

// «تخته نرد» for two on one phone (or one against the bot), the way it is played in Iran: no doubling cube,
// a game is worth 1 point and a «مارس» (the loser has not borne off a single checker) 2; a match goes to a
// number of points. Pure functions over plain data.
//
// The 24 points are indices 0…23 (index 0 = point 1 of player 0). points[i] > 0: player 0's checkers,
// < 0: player 1's. Player 0 moves down (23 → 0) and bears off below 0; player 1 moves up and bears off above 23.
// Each player's home board is its last six points: 0…5 for player 0, 18…23 for player 1.

export type Player = 0 | 1;

export interface BgBoard {
	points: number[];
	bar: [number, number];
	off: [number, number];
}

/** One checker moved by one die. */
export interface BgMove {
	from: number | 'bar';
	to: number | 'off';
	die: number;
}

export const CHECKERS = 15;

export function newBgBoard(): BgBoard {
	const points = Array.from({ length: 24 }, () => 0);
	// player 0: 2 on its 24-point, 5 on 13, 3 on 8, 5 on 6; player 1 the mirror image
	points[23] = 2;
	points[12] = 5;
	points[7] = 3;
	points[5] = 5;
	points[0] = -2;
	points[11] = -5;
	points[16] = -3;
	points[18] = -5;
	return { points, bar: [0, 0], off: [0, 0] };
}

export const opponent = (p: Player): Player => (p === 0 ? 1 : 0);
/** How many checkers of `p` stand on point `i`. */
export const countAt = (board: BgBoard, p: Player, i: number) => (p === 0 ? Math.max(0, board.points[i]) : Math.max(0, -board.points[i]));
/** The point's distance from `p`'s bearing-off edge, 0…23 (0 = the last point before bearing off). */
export const rel = (p: Player, i: number) => (p === 0 ? i : 23 - i);
const abs = (p: Player, r: number) => (p === 0 ? r : 23 - r);

/** Pips `p` still has to travel (bar = 25). */
export function pips(board: BgBoard, p: Player): number {
	let total = board.bar[p] * 25;
	for (let i = 0; i < 24; i++) total += countAt(board, p, i) * (rel(p, i) + 1);
	return total;
}

const allHome = (board: BgBoard, p: Player) => board.bar[p] === 0 && board.points.every((_, i) => rel(p, i) < 6 || countAt(board, p, i) === 0);
const canLand = (board: BgBoard, p: Player, i: number) => countAt(board, opponent(p), i) <= 1;

/** The single moves `p` can make with one die (from the bar first, when there are checkers on it). */
export function singleMoves(board: BgBoard, p: Player, die: number): BgMove[] {
	if (board.bar[p] > 0) {
		const to = abs(p, 24 - die);
		return canLand(board, p, to) ? [{ from: 'bar', to, die }] : [];
	}
	const moves: BgMove[] = [];
	const home = allHome(board, p);
	for (let i = 0; i < 24; i++) {
		if (!countAt(board, p, i)) continue;
		const r = rel(p, i) - die;
		if (r >= 0) {
			const to = abs(p, r);
			if (canLand(board, p, to)) moves.push({ from: i, to, die });
		} else if (home) {
			// bearing off: the exact number, or a bigger one when no checker stands further back
			const furtherBack = board.points.some((_, j) => rel(p, j) > rel(p, i) && countAt(board, p, j) > 0);
			if (r === -1 || !furtherBack) moves.push({ from: i, to: 'off', die });
		}
	}
	return moves;
}

export function applyBgMove(board: BgBoard, p: Player, m: BgMove): BgBoard {
	const points = board.points.slice();
	const bar: [number, number] = [board.bar[0], board.bar[1]];
	const off: [number, number] = [board.off[0], board.off[1]];
	const sign = p === 0 ? 1 : -1;
	if (m.from === 'bar') bar[p]--;
	else points[m.from] -= sign;
	if (m.to === 'off') off[p]++;
	else {
		// a lone opponent checker there is hit and goes to the bar
		if (countAt(board, opponent(p), m.to) === 1) {
			points[m.to] = 0;
			bar[opponent(p)]++;
		}
		points[m.to] += sign;
	}
	return { points, bar, off };
}

export const hasWon = (board: BgBoard, p: Player) => board.off[p] === CHECKERS;

export const sameBgMove = (a: BgMove, b: BgMove) => a.from === b.from && a.to === b.to && a.die === b.die;

/** The dice to play for a roll: a double is played four times. */
export const diceOf = (roll: readonly [number, number]) => (roll[0] === roll[1] ? [roll[0], roll[0], roll[0], roll[0]] : [roll[0], roll[1]]);

/**
 * Every complete way to play the roll. As many dice as possible must be played; when only one of two
 * different dice can be played, it must be the bigger one if that is possible. Bearing off the last checker
 * ends the game, so a play that does it counts as complete even with dice left. Empty list inside = no move.
 */
export function plays(board: BgBoard, p: Player, dice: readonly number[]): BgMove[][] {
	const found: { seq: BgMove[]; won: boolean }[] = [];
	const walk = (b: BgBoard, left: readonly number[], seq: BgMove[]) => {
		let moved = false;
		const tried = new Set<number>();
		left.forEach((die, k) => {
			if (tried.has(die)) return;
			tried.add(die);
			for (const m of singleMoves(b, p, die)) {
				moved = true;
				const next = applyBgMove(b, p, m);
				if (hasWon(next, p)) found.push({ seq: [...seq, m], won: true });
				else
					walk(
						next,
						left.filter((_, j) => j !== k),
						[...seq, m],
					);
			}
		});
		if (!moved) found.push({ seq, won: false });
	};
	walk(board, dice, []);
	const size = (f: { seq: BgMove[]; won: boolean }) => (f.won ? dice.length : f.seq.length);
	const longest = Math.max(...found.map(size));
	let best = found.filter((f) => size(f) === longest).map((f) => f.seq);
	if (longest === 1 && dice.length === 2 && dice[0] !== dice[1]) {
		const high = Math.max(dice[0], dice[1]);
		if (best.some((s) => s[0].die === high)) best = best.filter((s) => s[0].die === high);
	}
	return best;
}

/** The single moves allowed next, after `made` moves of this turn (they lead on to a complete play). */
export function nextMoves(turnPlays: readonly BgMove[][], made: readonly BgMove[]): BgMove[] {
	const result: BgMove[] = [];
	for (const play of turnPlays) {
		if (play.length <= made.length || !made.every((m, k) => sameBgMove(m, play[k]))) continue;
		const m = play[made.length];
		if (!result.some((o) => sameBgMove(o, m))) result.push(m);
	}
	return result;
}

/** The dice not used yet this turn. */
export function diceLeft(dice: readonly number[], made: readonly BgMove[]): number[] {
	const left = dice.slice();
	for (const m of made) {
		const k = left.indexOf(m.die);
		if (k >= 0) left.splice(k, 1);
	}
	return left;
}

/** The winner's points: 2 for a «مارس» (the loser has borne off nothing), otherwise 1. */
export const gamePoints = (board: BgBoard, winner: Player) => (board.off[opponent(winner)] === 0 ? 2 : 1);

export const rollDie = (rng: Rng = Math.random) => 1 + Math.floor(rng() * 6);

/** The opening: each player throws one die until they differ; the higher starts and plays both numbers. */
export function openingRoll(rng: Rng = Math.random): { rolls: [number, number][]; starter: Player; dice: [number, number] } {
	const rolls: [number, number][] = [];
	for (;;) {
		const pair: [number, number] = [rollDie(rng), rollDie(rng)];
		rolls.push(pair);
		if (pair[0] !== pair[1]) return { rolls, starter: pair[0] > pair[1] ? 0 : 1, dice: pair };
	}
}

/** A string that is the same for the same position (to drop plays that end the same way). */
export const boardKey = (board: BgBoard) => `${board.points.join(',')}|${board.bar.join(',')}|${board.off.join(',')}`;

// ─── the bot ──────────────────────────────────────────────────────────────────

export type Level = 'easy' | 'hard';

/** How many of the 36 rolls can hit something `distance` points ahead (blocked points are not considered). */
function rollsThatHit(distances: readonly number[]): number {
	let n = 0;
	for (let a = 1; a <= 6; a++)
		for (let b = 1; b <= 6; b++) {
			const reach = a === b ? [a, 2 * a, 3 * a, 4 * a] : [a, b, a + b];
			if (distances.some((d) => reach.includes(d))) n++;
		}
	return n;
}

/** Whether the two armies can still meet (otherwise it is a race). */
function contact(board: BgBoard): boolean {
	if (board.bar[0] || board.bar[1]) return true;
	let lowest1 = 24;
	let highest0 = -1;
	for (let i = 0; i < 24; i++) {
		if (board.points[i] > 0) highest0 = Math.max(highest0, i);
		if (board.points[i] < 0) lowest1 = Math.min(lowest1, i);
	}
	return highest0 > lowest1;
}

/** How good `board` is for `p` (bigger = better): the race, safety of lone checkers, points made, primes. */
export function bgEvaluate(board: BgBoard, p: Player): number {
	const q = opponent(p);
	let score = (pips(board, q) - pips(board, p)) + 8 * (board.off[p] - board.off[q]);
	if (!contact(board)) return score;
	score += 14 * board.bar[q] - 14 * board.bar[p];
	let run = 0;
	let prime = 0;
	for (let r = 0; r < 24; r++) {
		const i = abs(p, r);
		const mine = countAt(board, p, i);
		if (mine >= 2) {
			score += r < 6 ? 7 : r < 12 ? 4 : r >= 18 ? 3 : 2;
			run++;
			prime = Math.max(prime, run);
		} else run = 0;
		if (mine === 1) {
			// a lone checker: what the opponent's checkers behind it (and on the bar) need to hit it
			const distances: number[] = [];
			if (board.bar[q]) distances.push(24 - rel(q, i));
			for (let j = 0; j < 24; j++) {
				if (!countAt(board, q, j)) continue;
				const d = rel(q, j) - rel(q, i);
				if (d > 0) distances.push(d);
			}
			if (distances.length) score -= (rollsThatHit(distances) / 36) * (24 - r + 10) * 0.9;
		}
	}
	score += prime >= 3 ? (prime - 2) * 6 : 0;
	return score;
}

/** The bot's whole play for the roll (empty when it cannot move). */
export function botPlay(board: BgBoard, p: Player, dice: readonly number[], level: Level, rng: Rng = Math.random): BgMove[] {
	const options = plays(board, p, dice);
	const seen = new Set<string>();
	let best: BgMove[] = [];
	let bestScore = -Infinity;
	for (const play of options) {
		const end = play.reduce((b, m) => applyBgMove(b, p, m), board);
		const key = boardKey(end);
		if (seen.has(key)) continue;
		seen.add(key);
		// «آسون» weighs the same things very loosely, so it often picks a poor play
		const score = bgEvaluate(end, p) + (level === 'easy' ? (rng() * 2 - 1) * 45 : rng() * 0.01);
		if (score > bestScore) {
			bestScore = score;
			best = play;
		}
	}
	return best;
}
