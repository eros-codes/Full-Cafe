import { pickOne, type Rng } from '../kit/random.js';

// «منچ» (ludo) for 2–4 players on one phone. The board is the classic 15 × 15 cross: a track of 52 cells
// around it, each colour's home column of 5 cells and the centre. Each player has 4 pawns.
//
// A pawn's progress: -1 in the yard, 0…50 on the track counted from its own start cell, 51…55 in its home
// column, 56 home (the centre, by exact count only). A pawn landing on others' pawns sends them back to their
// yard, except on a safe cell (when that rule is on). Pure functions over plain data.

export const TRACK = 52;
export const HOME = 56;
export const SEATS = 4;
export const PAWNS = 4;

export interface LudoRules {
	/** A pawn leaves the yard only with a 6 (otherwise with a 1 or a 6). */
	sixToEnter: boolean;
	/** A 6 gives another roll. */
	sixAgain: boolean;
	/** The start cells and the four star cells protect the pawns on them. */
	safeCells: boolean;
}

export const DEFAULT_RULES: LudoRules = { sixToEnter: true, sixAgain: true, safeCells: true };

/** Where each seat (0–3) enters the track, as a track index. */
export const startIndex = (seat: number) => seat * 13;
/** The star cells (track indices) that are safe besides the start cells. */
export const STAR_CELLS = [8, 21, 34, 47];

export const isSafeTrackCell = (index: number) => index % 13 === 0 || STAR_CELLS.includes(index);

/** The track cell (0…51) of a pawn of `seat` at `progress` (0…50), or null when it is not on the shared track. */
export function trackCell(seat: number, progress: number): number | null {
	if (progress < 0 || progress > 50) return null;
	return (startIndex(seat) + progress) % TRACK;
}

// ─── the board's geometry (for drawing) ───────────────────────────────────────

/** The 52 track cells as [row, column] of the 15 × 15 grid, clockwise from seat 0's start cell. */
export const TRACK_CELLS: readonly (readonly [number, number])[] = [
	[6, 1], [6, 2], [6, 3], [6, 4], [6, 5],
	[5, 6], [4, 6], [3, 6], [2, 6], [1, 6], [0, 6],
	[0, 7], [0, 8],
	[1, 8], [2, 8], [3, 8], [4, 8], [5, 8],
	[6, 9], [6, 10], [6, 11], [6, 12], [6, 13], [6, 14],
	[7, 14], [8, 14],
	[8, 13], [8, 12], [8, 11], [8, 10], [8, 9],
	[9, 8], [10, 8], [11, 8], [12, 8], [13, 8], [14, 8],
	[14, 7], [14, 6],
	[13, 6], [12, 6], [11, 6], [10, 6], [9, 6],
	[8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0],
	[7, 0], [6, 0],
];

/** Each seat's home column (progress 51…55), outside in. */
export const HOME_CELLS: readonly (readonly (readonly [number, number])[])[] = [
	[[7, 1], [7, 2], [7, 3], [7, 4], [7, 5]],
	[[1, 7], [2, 7], [3, 7], [4, 7], [5, 7]],
	[[7, 13], [7, 12], [7, 11], [7, 10], [7, 9]],
	[[13, 7], [12, 7], [11, 7], [10, 7], [9, 7]],
];

/** The four yard spots of each seat (its 6 × 6 corner). */
export const YARD_CELLS: readonly (readonly (readonly [number, number])[])[] = [
	[[1.5, 1.5], [1.5, 3.5], [3.5, 1.5], [3.5, 3.5]],
	[[1.5, 10.5], [1.5, 12.5], [3.5, 10.5], [3.5, 12.5]],
	[[10.5, 10.5], [10.5, 12.5], [12.5, 10.5], [12.5, 12.5]],
	[[10.5, 1.5], [10.5, 3.5], [12.5, 1.5], [12.5, 3.5]],
];

/** Where a finished pawn rests: the seat's side of the centre. */
export const CENTER_CELLS: readonly (readonly [number, number])[] = [
	[7, 6.2],
	[6.2, 7],
	[7, 7.8],
	[7.8, 7],
];

/** [row, column] of a pawn (yard spot `pawn` while in the yard). */
export function pawnCell(seat: number, pawn: number, progress: number): readonly [number, number] {
	if (progress < 0) return YARD_CELLS[seat][pawn];
	if (progress >= HOME) return CENTER_CELLS[seat];
	if (progress > 50) return HOME_CELLS[seat][progress - 51];
	return TRACK_CELLS[(startIndex(seat) + progress) % TRACK];
}

// ─── the game ─────────────────────────────────────────────────────────────────

export interface LudoBoard {
	/** The seats in play, in turn order (e.g. [0, 2] for two players facing each other). */
	seats: number[];
	/** progress[seat][pawn]; seats not in play keep −1. */
	progress: number[][];
}

export function newBoard(seats: number[]): LudoBoard {
	return { seats: [...seats], progress: Array.from({ length: SEATS }, () => Array.from({ length: PAWNS }, () => -1)) };
}

/** Which seats play for 2, 3 or 4 players (two players sit opposite each other). */
export function seatsFor(players: number): number[] {
	if (players === 2) return [0, 2];
	if (players === 3) return [0, 1, 2];
	return [0, 1, 2, 3];
}

export interface LudoMove {
	pawn: number;
	from: number;
	to: number;
	/** Pawns sent back to their yard: [seat, pawn]. */
	captures: [number, number][];
}

/** The pawns of other seats on track cell `cell`. */
function othersOn(board: LudoBoard, seat: number, cell: number): [number, number][] {
	const found: [number, number][] = [];
	for (const other of board.seats) {
		if (other === seat) continue;
		board.progress[other].forEach((p, pawn) => {
			if (trackCell(other, p) === cell) found.push([other, pawn]);
		});
	}
	return found;
}

export function legalMoves(board: LudoBoard, seat: number, roll: number, rules: LudoRules): LudoMove[] {
	const moves: LudoMove[] = [];
	board.progress[seat].forEach((from, pawn) => {
		let to: number;
		if (from < 0) {
			if (roll !== 6 && (rules.sixToEnter || roll !== 1)) return;
			to = 0;
		} else {
			to = from + roll;
			if (from >= HOME || to > HOME) return;
		}
		const cell = trackCell(seat, to);
		const captures = cell === null || (rules.safeCells && isSafeTrackCell(cell)) ? [] : othersOn(board, seat, cell);
		moves.push({ pawn, from, to, captures });
	});
	return moves;
}

/** The moves that really differ (two pawns in the yard, or on one cell, make the same move). */
export function distinctMoves(moves: readonly LudoMove[]): LudoMove[] {
	return moves.filter((m, i) => moves.findIndex((o) => o.from === m.from && o.to === m.to) === i);
}

export function applyMove(board: LudoBoard, seat: number, move: LudoMove): LudoBoard {
	const progress = board.progress.map((pawns) => pawns.slice());
	progress[seat][move.pawn] = move.to;
	for (const [other, pawn] of move.captures) progress[other][pawn] = -1;
	return { ...board, progress };
}

export const hasWon = (board: LudoBoard, seat: number) => board.progress[seat].every((p) => p >= HOME);

/** The seat after `seat` in turn order. */
export function nextSeat(board: LudoBoard, seat: number): number {
	const i = board.seats.indexOf(seat);
	return board.seats[(i + 1) % board.seats.length];
}

/** The player rolls again: a 6 (when that rule is on). */
export const rollsAgain = (roll: number, rules: LudoRules) => rules.sixAgain && roll === 6;

// ─── the bot ──────────────────────────────────────────────────────────────────

export type Level = 'easy' | 'hard';

/** Whether a pawn of `seat` on track cell `cell` could be hit by another seat's next roll (1–6 behind it). */
function threatened(board: LudoBoard, seat: number, cell: number, rules: LudoRules): boolean {
	if (rules.safeCells && isSafeTrackCell(cell)) return false;
	for (const other of board.seats) {
		if (other === seat) continue;
		for (const p of board.progress[other]) {
			const at = trackCell(other, p);
			if (at === null) {
				// a yard pawn enters on its start cell
				if (p < 0 && startIndex(other) === cell) return true;
				continue;
			}
			const distance = (cell - at + TRACK) % TRACK;
			// it must not have passed its own entry to the home column before reaching the cell
			if (distance >= 1 && distance <= 6 && p + distance <= 50) return true;
		}
	}
	return false;
}

/** How good a move is for the hard bot. */
export function moveScore(board: LudoBoard, seat: number, move: LudoMove, rules: LudoRules): number {
	let score = move.captures.length * 100;
	if (move.to >= HOME) score += 70;
	else if (move.to > 50 && move.from <= 50) score += 45;
	if (move.from < 0) score += 35;
	const fromCell = trackCell(seat, move.from);
	const toCell = trackCell(seat, move.to);
	const after = applyMove(board, seat, move);
	if (toCell !== null) {
		if (threatened(after, seat, toCell, rules)) score -= 40;
		else if (rules.safeCells && isSafeTrackCell(toCell)) score += 15;
	}
	if (fromCell !== null && threatened(board, seat, fromCell, rules) && (toCell === null || !threatened(after, seat, toCell, rules))) score += 30;
	return score + move.to * 0.3;
}

export function botMove(board: LudoBoard, seat: number, roll: number, rules: LudoRules, level: Level, rng: Rng = Math.random): LudoMove | null {
	const moves = distinctMoves(legalMoves(board, seat, roll, rules));
	if (!moves.length) return null;
	if (level === 'easy') {
		// takes a pawn when it sees one, otherwise any move
		const capture = moves.filter((m) => m.captures.length);
		return capture.length && rng() < 0.5 ? pickOne(capture, rng) : pickOne(moves, rng);
	}
	const scored = moves.map((m) => ({ m, s: moveScore(board, seat, m, rules) }));
	const best = Math.max(...scored.map((x) => x.s));
	return pickOne(
		scored.filter((x) => x.s === best).map((x) => x.m),
		rng,
	);
}

export const rollDie = (rng: Rng = Math.random) => 1 + Math.floor(rng() * 6);
