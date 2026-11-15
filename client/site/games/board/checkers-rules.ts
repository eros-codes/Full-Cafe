import { pickOne, type Rng } from '../kit/random.js';

// «چکرز» (English draughts) on the 32 dark squares of an 8×8 board. Cell index = row × 8 + column, row 0 at the
// top. Player 0 starts at the bottom and moves up; player 1 starts at the top and moves down.
//
//   · a man moves one square diagonally forward; a king one square in any diagonal direction
//   · a capture jumps over a neighbouring enemy piece onto the empty square behind it; men capture forward only
//   · capturing is compulsory, and a piece that can capture again must go on (any capturing line may be chosen)
//   · a man that reaches the last row becomes a king and its move ends there
//   · no piece left, or no legal move: the other player wins; 40 moves each without a capture or a man's move: a draw
//
// The hard bot looks HARD_DEPTH moves ahead (negamax with alpha-beta); the easy one looks one move ahead and
// plays a random move a good part of the time.

export const SIZE = 8;
export const HARD_DEPTH = 7;
/** Moves by both players together without a capture or a man's move before the game is a draw. */
export const DRAW_PLIES = 80;

export type Side = 0 | 1;
/** null = empty; 0 / 1 = a man of that player; 2 / 3 = a king of player 0 / 1. */
export type Cell = 0 | 1 | 2 | 3 | null;
export type CheckersBoard = Cell[];
export type Level = 'easy' | 'hard';

export interface Move {
	from: number;
	/** The squares the piece lands on, in order (one for a plain move, one per jump for a capture). */
	path: number[];
	/** The squares of the pieces taken, one per jump. */
	captured: number[];
}

export const ownerOf = (cell: Cell): Side | null => (cell === null ? null : ((cell & 1) as Side));
export const isKing = (cell: Cell): boolean => cell !== null && cell >= 2;
export const isDark = (index: number): boolean => ((index >> 3) + (index & 7)) % 2 === 1;

export function startBoard(): CheckersBoard {
	return Array.from({ length: SIZE * SIZE }, (_, index): Cell => {
		if (!isDark(index)) return null;
		const row = index >> 3;
		return row < 3 ? 1 : row > 4 ? 0 : null;
	});
}

export const countPieces = (board: readonly Cell[], side: Side): number => board.filter((cell) => ownerOf(cell) === side).length;

/** The row directions a piece may move in: up (−1) for player 0, down (+1) for player 1, both for a king. */
const rowSteps = (cell: Cell): number[] => (isKing(cell) ? [-1, 1] : ownerOf(cell) === 0 ? [-1] : [1]);
const crownRow = (side: Side): number => (side === 0 ? 0 : SIZE - 1);
const inside = (row: number, col: number) => row >= 0 && row < SIZE && col >= 0 && col < SIZE;

/** Every capturing line of the piece at `from` (each as long as it can go). */
function jumpsFrom(board: readonly Cell[], from: number): Move[] {
	const piece = board[from];
	const side = ownerOf(piece);
	if (piece === null || side === null) return [];
	const moves: Move[] = [];
	const walk = (at: number, path: number[], captured: number[]) => {
		let extended = false;
		const row = at >> 3;
		const col = at & 7;
		// a man crowned on this square stops here
		const crowned = path.length > 0 && !isKing(piece) && row === crownRow(side);
		if (!crowned) {
			for (const dr of rowSteps(piece)) {
				for (const dc of [-1, 1]) {
					const overRow = row + dr;
					const overCol = col + dc;
					const toRow = row + 2 * dr;
					const toCol = col + 2 * dc;
					if (!inside(toRow, toCol)) continue;
					const over = overRow * SIZE + overCol;
					const to = toRow * SIZE + toCol;
					const victim = ownerOf(board[over]);
					if (victim === null || victim === side || captured.includes(over)) continue;
					// the square behind must be empty (the moving piece's own start square is empty by now)
					if (board[to] !== null && to !== from) continue;
					extended = true;
					walk(to, [...path, to], [...captured, over]);
				}
			}
		}
		if (!extended && path.length) moves.push({ from, path, captured });
	};
	walk(from, [], []);
	return moves;
}

function stepsFrom(board: readonly Cell[], from: number): Move[] {
	const piece = board[from];
	if (piece === null) return [];
	const moves: Move[] = [];
	const row = from >> 3;
	const col = from & 7;
	for (const dr of rowSteps(piece)) {
		for (const dc of [-1, 1]) {
			if (!inside(row + dr, col + dc)) continue;
			const to = (row + dr) * SIZE + col + dc;
			if (board[to] === null) moves.push({ from, path: [to], captured: [] });
		}
	}
	return moves;
}

/** The legal moves of `side`: the captures when there is one (capturing is compulsory), otherwise the plain moves. */
export function legalMoves(board: readonly Cell[], side: Side): Move[] {
	const jumps: Move[] = [];
	const steps: Move[] = [];
	for (let index = 0; index < board.length; index++) {
		if (ownerOf(board[index]) !== side) continue;
		jumps.push(...jumpsFrom(board, index));
		if (!jumps.length) steps.push(...stepsFrom(board, index));
	}
	return jumps.length ? jumps : steps;
}

/** The board after the first `steps` landings of a move (all of them by default); the man is crowned at the end of the whole move. */
export function applyMove(board: readonly Cell[], move: Move, steps = move.path.length): CheckersBoard {
	const next = board.slice();
	const piece = next[move.from];
	const side = ownerOf(piece);
	if (piece === null || side === null || steps < 1) return next;
	next[move.from] = null;
	for (const taken of move.captured.slice(0, steps)) next[taken] = null;
	const to = move.path[steps - 1];
	const done = steps >= move.path.length;
	next[to] = done && !isKing(piece) && to >> 3 === crownRow(side) ? ((side + 2) as Cell) : piece;
	return next;
}

/** Whether the move changes the position for good (a capture or a man's move): it restarts the draw count. */
export const isProgress = (board: readonly Cell[], move: Move): boolean => move.captured.length > 0 || !isKing(board[move.from]);

/** The winner when `toMove` cannot move (no piece or every piece blocked), otherwise null. */
export function winnerOf(board: readonly Cell[], toMove: Side): Side | null {
	return legalMoves(board, toMove).length ? null : ((1 - toMove) as Side);
}

export const sameMove = (a: Move, b: Move): boolean =>
	a.from === b.from && a.path.length === b.path.length && a.path.every((square, i) => square === b.path[i]);

// ─── the bot ─────────────────────────────────────────────────────────────────

const MAN = 100;
const KING = 175;
const WIN = 100_000;

/** The position seen by `side`: material first, then men advanced, the back row kept and the centre held. */
function evaluate(board: readonly Cell[], side: Side): number {
	let score = 0;
	for (let index = 0; index < board.length; index++) {
		const cell = board[index];
		const owner = ownerOf(cell);
		if (cell === null || owner === null) continue;
		const row = index >> 3;
		const col = index & 7;
		let value: number;
		if (isKing(cell)) {
			value = KING + (col > 0 && col < 7 && row > 0 && row < 7 ? 8 : 0);
		} else {
			const advanced = owner === 0 ? SIZE - 1 - row : row;
			value = MAN + advanced * 4;
			// a man still on its own back row keeps the opponent from crowning
			if (advanced === 0) value += 10;
			if (col >= 2 && col <= 5 && row >= 2 && row <= 5) value += 4;
		}
		score += owner === side ? value : -value;
	}
	return score;
}

function search(board: readonly Cell[], side: Side, depth: number, alpha: number, beta: number, ply: number): number {
	const moves = legalMoves(board, side);
	// no move = lost; sooner is worse
	if (!moves.length) return -WIN + ply;
	if (depth <= 0) {
		// do not stop in the middle of an exchange
		if (!moves[0].captured.length) return evaluate(board, side);
		depth = 1;
	}
	let best = -Infinity;
	// the longest captures first: they cut the search soonest
	moves.sort((a, b) => b.captured.length - a.captured.length);
	for (const move of moves) {
		const score = -search(applyMove(board, move), (1 - side) as Side, depth - 1, -beta, -alpha, ply + 1);
		if (score > best) best = score;
		if (best > alpha) alpha = best;
		if (alpha >= beta) break;
	}
	return best;
}

/** The bot's move for `side` (null when it has none). */
export function botMove(board: readonly Cell[], side: Side, level: Level, rng: Rng = Math.random): Move | null {
	const moves = legalMoves(board, side);
	if (!moves.length) return null;
	if (moves.length === 1) return moves[0];
	if (level === 'easy' && rng() < 0.45) return pickOne(moves, rng);
	const depth = level === 'hard' ? HARD_DEPTH : 1;
	let bestScore = -Infinity;
	let best: Move[] = [];
	for (const move of moves) {
		// a move only matters when it is at least as good as the best so far: anything below is cut off early
		const score = -search(applyMove(board, move), (1 - side) as Side, depth - 1, -Infinity, -(bestScore - 1), 1);
		if (score > bestScore) {
			bestScore = score;
			best = [move];
		} else if (score === bestScore) best.push(move);
	}
	// equally good moves: any of them, so two games are not the same
	return pickOne(best, rng);
}
