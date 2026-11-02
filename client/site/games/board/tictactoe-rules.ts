import { pickOne, type Rng } from '../kit/random.js';

// «دوز» (tic-tac-toe): a 3×3 board, the first to get three in a row wins. Player 0 plays ✕, player 1 plays ◯.
// The hard bot plays perfectly (minimax: it never loses); the easy one makes a random move half the time.

export type Mark = 0 | 1;
export type TttBoard = (Mark | null)[];

export const LINES: readonly (readonly number[])[] = [
	[0, 1, 2],
	[3, 4, 5],
	[6, 7, 8],
	[0, 3, 6],
	[1, 4, 7],
	[2, 5, 8],
	[0, 4, 8],
	[2, 4, 6],
];

export const emptyBoard = (): TttBoard => Array.from({ length: 9 }, () => null);

export function winnerOf(board: readonly (Mark | null)[]): { player: Mark; line: number[] } | null {
	for (const line of LINES) {
		const [a, b, c] = line;
		const mark = board[a];
		if (mark !== null && mark === board[b] && mark === board[c]) return { player: mark, line: [...line] };
	}
	return null;
}

export const isFull = (board: readonly (Mark | null)[]) => board.every((cell) => cell !== null);
export const emptyCells = (board: readonly (Mark | null)[]) => board.flatMap((cell, i) => (cell === null ? [i] : []));

export function play(board: TttBoard, index: number, player: Mark): TttBoard {
	if (board[index] !== null) return board;
	const next = board.slice();
	next[index] = player;
	return next;
}

const memo = new Map<string, number>();
const other = (player: Mark): Mark => (player === 0 ? 1 : 0);

/**
 * The value of playing `cell` for `player`: 9 for a win now, 0 for a draw, negative for a loss; one point
 * less per move it takes, so a quick win beats a slow one and a late loss beats an early one.
 */
function moveValue(board: TttBoard, cell: number, player: Mark): number {
	const next = play(board, cell, player);
	const raw = winnerOf(next) ? 10 : isFull(next) ? 0 : -bestValue(next, other(player));
	return raw > 0 ? raw - 1 : raw < 0 ? raw + 1 : 0;
}

/** The best value `player` (to move) can force. */
function bestValue(board: TttBoard, player: Mark): number {
	const key = board.map((c) => (c === null ? '-' : c)).join('') + player;
	const cached = memo.get(key);
	if (cached !== undefined) return cached;
	const best = Math.max(...emptyCells(board).map((cell) => moveValue(board, cell, player)));
	memo.set(key, best);
	return best;
}

/** Every move with its value for `player` (higher is better). */
export function moveValues(board: TttBoard, player: Mark): { cell: number; value: number }[] {
	return emptyCells(board).map((cell) => ({ cell, value: moveValue(board, cell, player) }));
}

export type Level = 'easy' | 'hard';

export function botMove(board: TttBoard, player: Mark, level: Level, rng: Rng = Math.random): number {
	const cells = emptyCells(board);
	if (level === 'easy' && rng() < 0.5) return pickOne(cells, rng);
	const values = moveValues(board, player);
	const best = Math.max(...values.map((v) => v.value));
	return pickOne(
		values.filter((v) => v.value === best).map((v) => v.cell),
		rng,
	);
}
