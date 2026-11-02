import { pickOne, shuffle, type Rng } from '../kit/random.js';

// «نقطه‌بازی» (dots and boxes): an n×n grid of boxes. Players draw one line at a time between two neighbouring
// dots; whoever draws the fourth side of a box owns it and must draw again. When every line is drawn, the
// most boxes wins. 2–4 players.
//
// Lines: `h[r * n + c]` is the line on top of box row r (r = 0…n), column c; `v[r * (n + 1) + c]` the line on
// the left of box row r, column c (c = 0…n).
//
// The hard bot takes every box it can, otherwise draws a line that gives nothing away (no box with three
// sides), and when there is none left, the line that gives the fewest boxes. The easy bot takes a box only
// sometimes and otherwise draws any line.

export interface Line {
	kind: 'h' | 'v';
	r: number;
	c: number;
}

export interface DotsBoard {
	n: number;
	/** Who drew each line (player number), null while it is open. */
	h: (number | null)[];
	v: (number | null)[];
	/** Owner of each box (row × n + column), null while open. */
	boxes: (number | null)[];
}

export type Level = 'easy' | 'hard';

export function emptyDots(n: number): DotsBoard {
	return {
		n,
		h: Array.from({ length: (n + 1) * n }, () => null),
		v: Array.from({ length: n * (n + 1) }, () => null),
		boxes: Array.from({ length: n * n }, () => null),
	};
}

const lineIndex = (n: number, line: Line) => (line.kind === 'h' ? line.r * n + line.c : line.r * (n + 1) + line.c);
export const isDrawn = (board: DotsBoard, line: Line) => lineOwner(board, line) !== null;
/** The player who drew the line, or null while it is open. */
export const lineOwner = (board: DotsBoard, line: Line): number | null => (line.kind === 'h' ? board.h : board.v)[lineIndex(board.n, line)] ?? null;
const drawn = (owner: number | null | undefined) => (owner === null || owner === undefined ? 0 : 1);

/** The drawn sides of box (r, c). */
export function sides(board: DotsBoard, r: number, c: number): number {
	const { n } = board;
	return drawn(board.h[r * n + c]) + drawn(board.h[(r + 1) * n + c]) + drawn(board.v[r * (n + 1) + c]) + drawn(board.v[r * (n + 1) + c + 1]);
}

/** The one or two boxes a line borders. */
export function boxesOf(n: number, line: Line): [number, number][] {
	const result: [number, number][] = [];
	if (line.kind === 'h') {
		if (line.r > 0) result.push([line.r - 1, line.c]);
		if (line.r < n) result.push([line.r, line.c]);
	} else {
		if (line.c > 0) result.push([line.r, line.c - 1]);
		if (line.c < n) result.push([line.r, line.c]);
	}
	return result;
}

export function freeLines(board: DotsBoard): Line[] {
	const { n } = board;
	const lines: Line[] = [];
	for (let r = 0; r <= n; r++) for (let c = 0; c < n; c++) if (board.h[r * n + c] === null) lines.push({ kind: 'h', r, c });
	for (let r = 0; r < n; r++) for (let c = 0; c <= n; c++) if (board.v[r * (n + 1) + c] === null) lines.push({ kind: 'v', r, c });
	return lines;
}

export const isOver = (board: DotsBoard) => board.boxes.every((owner) => owner !== null);

/** Draws a line for `player`: the boxes it closes become theirs (`closed`: how many, 0 = the turn passes). */
export function drawLine(board: DotsBoard, line: Line, player: number): { board: DotsBoard; closed: number } {
	if (isDrawn(board, line)) return { board, closed: 0 };
	const next: DotsBoard = { ...board, h: board.h.slice(), v: board.v.slice(), boxes: board.boxes.slice() };
	(line.kind === 'h' ? next.h : next.v)[lineIndex(board.n, line)] = player;
	let closed = 0;
	for (const [r, c] of boxesOf(board.n, line)) {
		if (sides(next, r, c) === 4 && next.boxes[r * board.n + c] === null) {
			next.boxes[r * board.n + c] = player;
			closed++;
		}
	}
	return { board: next, closed };
}

export function scoresOf(board: DotsBoard, players: number): number[] {
	const scores = Array.from({ length: players }, () => 0);
	for (const owner of board.boxes) if (owner !== null) scores[owner]++;
	return scores;
}

// ─── the bot ──────────────────────────────────────────────────────────────────

/** Lines that close a box right now. */
const closing = (board: DotsBoard) => freeLines(board).filter((line) => boxesOf(board.n, line).some(([r, c]) => sides(board, r, c) === 3));

/** Lines that leave no box with three sides (the opponent gets nothing from them). */
const safe = (board: DotsBoard) => freeLines(board).filter((line) => boxesOf(board.n, line).every(([r, c]) => sides(board, r, c) < 2));

/** How many boxes the next player can take in a row after `line` is drawn (they take every one they can). */
function givenAway(board: DotsBoard, line: Line): number {
	let current = drawLine(board, line, 0).board;
	let taken = 0;
	for (;;) {
		const take = closing(current)[0];
		if (!take) return taken;
		const step = drawLine(current, take, 1);
		taken += step.closed;
		current = step.board;
	}
}

export function botLine(board: DotsBoard, level: Level, rng: Rng = Math.random): Line {
	const free = freeLines(board);
	const take = closing(board);
	if (level === 'easy') {
		if (take.length && rng() < 0.6) return pickOne(take, rng);
		return pickOne(free, rng);
	}
	if (take.length) return pickOne(take, rng);
	const quiet = safe(board);
	if (quiet.length) return pickOne(quiet, rng);
	let best: Line[] = [];
	let fewest = Infinity;
	for (const line of shuffle(free, rng)) {
		const given = givenAway(board, line);
		if (given < fewest) {
			fewest = given;
			best = [line];
		} else if (given === fewest) best.push(line);
	}
	return pickOne(best, rng);
}
