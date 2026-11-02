import { pickOne, type Rng } from '../kit/random.js';

// «چهار در یک ردیف» (connect four): 7 columns, 6 rows; a disc falls to the lowest free cell of its column,
// four in a row (across, down or diagonal) wins. Cell index = row × COLS + column, row 0 at the top.
//
// The hard bot looks HARD_DEPTH moves ahead (negamax with alpha-beta, centre columns first) and scores the
// positions by their open lines; the easy one wins when it can, blocks only sometimes and otherwise plays
// a random column, leaning to the centre.

export const COLS = 7;
export const ROWS = 6;
export const HARD_DEPTH = 6;

export type Disc = 0 | 1;
export type C4Board = (Disc | null)[];
export type Level = 'easy' | 'hard';

export const emptyC4 = (): C4Board => Array.from({ length: COLS * ROWS }, () => null);

/** The row a disc dropped in `col` lands on, or -1 when the column is full. */
export function landingRow(board: readonly (Disc | null)[], col: number): number {
	for (let row = ROWS - 1; row >= 0; row--) if (board[row * COLS + col] === null) return row;
	return -1;
}

export const openColumns = (board: readonly (Disc | null)[]) => Array.from({ length: COLS }, (_, c) => c).filter((c) => board[c] === null);
export const isBoardFull = (board: readonly (Disc | null)[]) => openColumns(board).length === 0;

export function drop(board: C4Board, col: number, player: Disc): { board: C4Board; index: number } | null {
	const row = landingRow(board, col);
	if (row < 0) return null;
	const next = board.slice();
	next[row * COLS + col] = player;
	return { board: next, index: row * COLS + col };
}

const DIRECTIONS: readonly [number, number][] = [
	[0, 1],
	[1, 0],
	[1, 1],
	[1, -1],
];

/** The winning line through the disc at `index` (4 or more cells), or null. */
export function winLineAt(board: readonly (Disc | null)[], index: number): number[] | null {
	const player = board[index];
	if (player === null) return null;
	const row = Math.floor(index / COLS);
	const col = index % COLS;
	for (const [dr, dc] of DIRECTIONS) {
		const line = [index];
		for (const sign of [1, -1]) {
			let r = row + dr * sign;
			let c = col + dc * sign;
			while (r >= 0 && r < ROWS && c >= 0 && c < COLS && board[r * COLS + c] === player) {
				line.push(r * COLS + c);
				r += dr * sign;
				c += dc * sign;
			}
		}
		if (line.length >= 4) return line.sort((a, b) => a - b);
	}
	return null;
}

// ─── the bot ──────────────────────────────────────────────────────────────────

/** Every group of four cells in a row (69 of them). */
const WINDOWS: number[][] = [];
for (let r = 0; r < ROWS; r++) {
	for (let c = 0; c < COLS; c++) {
		for (const [dr, dc] of DIRECTIONS) {
			const cells = [0, 1, 2, 3].map((k) => [r + dr * k, c + dc * k]);
			if (cells.every(([rr, cc]) => rr >= 0 && rr < ROWS && cc >= 0 && cc < COLS)) WINDOWS.push(cells.map(([rr, cc]) => rr * COLS + cc));
		}
	}
}

const ORDER = [3, 2, 4, 1, 5, 0, 6];
const WIN = 1_000_000;

/** How good the position is for `player`: open threes and twos, minus the opponent's, plus the centre. */
export function evaluate(board: readonly (Disc | null)[], player: Disc): number {
	let score = 0;
	for (let r = 0; r < ROWS; r++) {
		const cell = board[r * COLS + 3];
		if (cell === player) score += 3;
		else if (cell !== null) score -= 3;
	}
	for (const window of WINDOWS) {
		let mine = 0;
		let theirs = 0;
		for (const i of window) {
			const cell = board[i];
			if (cell === player) mine++;
			else if (cell !== null) theirs++;
		}
		if (mine && theirs) continue;
		if (mine === 3) score += 8;
		else if (mine === 2) score += 2;
		else if (theirs === 3) score -= 9;
		else if (theirs === 2) score -= 2;
	}
	return score;
}

/** Positions already searched during one bot move: value and whether it is exact or only a bound. */
type Table = Map<string, { value: number; flag: 0 | 1 | 2 }>;
const EXACT = 0;
const LOWER = 1;
const UPPER = 2;

function negamax(board: C4Board, player: Disc, depth: number, alpha: number, beta: number, table: Table): number {
	if (depth === 0) return evaluate(board, player);
	const columns = ORDER.filter((c) => board[c] === null);
	if (!columns.length) return 0;
	// a win right now needs no deeper look (and it is the best this position can be)
	for (const col of columns) {
		const move = drop(board, col, player)!;
		if (winLineAt(move.board, move.index)) return WIN + depth;
	}
	const key = `${board.map((cell) => (cell === null ? '.' : cell)).join('')}${player}${depth}`;
	const known = table.get(key);
	if (known) {
		if (known.flag === EXACT) return known.value;
		if (known.flag === LOWER && known.value >= beta) return known.value;
		if (known.flag === UPPER && known.value <= alpha) return known.value;
	}
	const alphaStart = alpha;
	let best = -Infinity;
	for (const col of columns) {
		const move = drop(board, col, player)!;
		const value = -negamax(move.board, (1 - player) as Disc, depth - 1, -beta, -alpha, table);
		if (value > best) best = value;
		if (best > alpha) alpha = best;
		if (alpha >= beta) break;
	}
	table.set(key, { value: best, flag: best <= alphaStart ? UPPER : best >= beta ? LOWER : EXACT });
	return best;
}

/**
 * Every column with the best value for `player`, looking `depth` moves ahead (the bot picks one of them).
 * The bound found so far is shared between the columns: each next column is only searched for "at least as
 * good" (window best − 1 … ∞). That finds exactly the same best columns as searching each one in full, at a
 * fraction of the work (a full search per column froze slower phones for a moment at the start).
 */
export function bestColumns(board: C4Board, player: Disc, depth: number): number[] {
	let best = -Infinity;
	let columns: number[] = [];
	const table: Table = new Map();
	for (const col of ORDER) {
		if (board[col] !== null) continue;
		const move = drop(board, col, player)!;
		const value = winLineAt(move.board, move.index) ? WIN + depth : -negamax(move.board, (1 - player) as Disc, depth - 1, -Infinity, -(best - 1), table);
		if (value > best) {
			best = value;
			columns = [col];
		} else if (value === best) columns.push(col);
	}
	return columns;
}

/** A column that wins at once for `player`, if any. */
export function winningColumn(board: C4Board, player: Disc): number | null {
	for (const col of openColumns(board)) {
		const move = drop(board, col, player)!;
		if (winLineAt(move.board, move.index)) return col;
	}
	return null;
}

export function botColumn(board: C4Board, player: Disc, level: Level, rng: Rng = Math.random): number {
	const open = openColumns(board);
	if (level === 'easy') {
		const win = winningColumn(board, player);
		if (win !== null) return win;
		const block = winningColumn(board, (1 - player) as Disc);
		if (block !== null && rng() < 0.5) return block;
		// random, but the centre columns twice as often
		return pickOne(
			open.flatMap((c) => (c >= 2 && c <= 4 ? [c, c] : [c])),
			rng,
		);
	}
	return pickOne(bestColumns(board, player, HARD_DEPTH), rng);
}
