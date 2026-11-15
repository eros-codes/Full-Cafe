// «چکرز» (client/site/games/board/checkers-rules.ts): the rules and the bot. Pure functions, no database.
import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	DRAW_PLIES,
	applyMove,
	botMove,
	countPieces,
	isDark,
	isKing,
	isProgress,
	legalMoves,
	startBoard,
	winnerOf,
	type Cell,
	type CheckersBoard,
	type Side,
} from '../client/site/games/board/checkers-rules.js';
import type { Rng } from '../client/site/games/kit/random.js';

function seeded(seed: number): Rng {
	let a = seed;
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A board from [row, column, piece] triples (0 / 1 men, 2 / 3 kings of player 0 / 1). */
function board(...pieces: [number, number, Cell][]): CheckersBoard {
	const cells: CheckersBoard = Array.from({ length: 64 }, () => null);
	for (const [row, col, piece] of pieces) {
		assert.ok(isDark(row * 8 + col), `(${row}, ${col}) is a light square`);
		cells[row * 8 + col] = piece;
	}
	return cells;
}
const sq = (row: number, col: number) => row * 8 + col;

describe('«چکرز»', () => {
	test('the start: 12 men each on the dark squares; seven first moves, no capture', () => {
		const start = startBoard();
		assert.equal(countPieces(start, 0), 12);
		assert.equal(countPieces(start, 1), 12);
		assert.ok(start.every((cell, index) => cell === null || isDark(index)));
		for (const side of [0, 1] as Side[]) {
			const moves = legalMoves(start, side);
			assert.equal(moves.length, 7);
			assert.ok(moves.every((m) => m.captured.length === 0 && m.path.length === 1));
		}
	});

	test('a man moves forward only; a king both ways', () => {
		const man = legalMoves(board([4, 3, 0]), 0);
		assert.deepEqual(man.map((m) => m.path[0]).sort(), [sq(3, 2), sq(3, 4)]);
		const down = legalMoves(board([4, 3, 1]), 1);
		assert.deepEqual(down.map((m) => m.path[0]).sort(), [sq(5, 2), sq(5, 4)]);
		assert.equal(legalMoves(board([4, 3, 2]), 0).length, 4);
	});

	test('capturing is compulsory: with a capture on the board, plain moves are not allowed', () => {
		// player 0 can take the man on (3,4); its other man could otherwise just move
		const b = board([4, 3, 0], [3, 4, 1], [6, 1, 0]);
		const moves = legalMoves(b, 0);
		assert.equal(moves.length, 1);
		assert.deepEqual(moves[0], { from: sq(4, 3), path: [sq(2, 5)], captured: [sq(3, 4)] });
		const after = applyMove(b, moves[0]);
		assert.equal(after[sq(3, 4)], null, 'the taken man leaves the board');
		assert.equal(after[sq(2, 5)], 0);
		// a man never captures backwards
		assert.ok(legalMoves(board([3, 4, 0], [4, 3, 1]), 0).every((m) => m.captured.length === 0));
	});

	test('a chain of captures is one move and must be finished; any line may be chosen', () => {
		const b = board([6, 1, 0], [5, 2, 1], [3, 4, 1], [3, 2, 1]);
		const moves = legalMoves(b, 0);
		// over (5,2) to (4,3), then left over (3,2) or right over (3,4): two full lines, no stopping after one jump
		assert.deepEqual(
			moves.map((m) => m.path).sort(),
			[
				[sq(4, 3), sq(2, 1)],
				[sq(4, 3), sq(2, 5)],
			].sort(),
		);
		assert.ok(moves.every((m) => m.captured.length === 2));
		// half-way through (what the screen shows between two taps): one man taken, not crowned
		const half = applyMove(b, moves[0], 1);
		assert.equal(half[sq(4, 3)], 0);
		assert.equal(countPieces(half, 1), 2);
	});

	test('a man reaching the last row is crowned and its move ends there', () => {
		// after jumping to row 0 it could go on backwards as a king, but the move ends
		const b = board([2, 1, 0], [1, 2, 1], [1, 4, 1]);
		const moves = legalMoves(b, 0);
		assert.deepEqual(moves, [{ from: sq(2, 1), path: [sq(0, 3)], captured: [sq(1, 2)] }]);
		const after = applyMove(b, moves[0]);
		assert.ok(isKing(after[sq(0, 3)]));
		// player 1 crowns on the bottom row
		assert.equal(applyMove(board([6, 1, 1]), { from: sq(6, 1), path: [sq(7, 0)], captured: [] })[sq(7, 0)], 3);
	});

	test('a king captures in every direction and may come back to its own square; a piece is taken once', () => {
		const b = board([4, 3, 2], [3, 2, 1], [1, 2, 1], [1, 4, 1], [3, 4, 1]);
		const moves = legalMoves(b, 0);
		assert.ok(moves.length >= 2);
		for (const move of moves) {
			assert.equal(move.captured.length, 4, 'round the square and back');
			assert.equal(new Set(move.captured).size, 4);
			assert.equal(move.path.at(-1), sq(4, 3));
			assert.equal(countPieces(applyMove(b, move), 1), 0);
		}
	});

	test('no piece or no move loses; quiet king moves count towards the draw', () => {
		assert.equal(winnerOf(board([4, 3, 0]), 1), 0, 'no pieces');
		// player 1's man in the corner is blocked by two men it cannot jump
		const blocked = board([7, 0, 0], [6, 1, 1], [5, 2, 1], [0, 1, 1]);
		assert.equal(winnerOf(blocked, 0), 1, 'a blocked side loses');
		assert.equal(winnerOf(startBoard(), 0), null);
		const kings = board([4, 3, 2], [0, 1, 3]);
		assert.equal(isProgress(kings, legalMoves(kings, 0)[0]), false);
		assert.equal(isProgress(startBoard(), legalMoves(startBoard(), 0)[0]), true);
		assert.equal(DRAW_PLIES, 80);
	});

	test('the bot: takes what it must, sees a two-for-one, and its move is always legal', () => {
		const rng = seeded(7);
		const forced = board([4, 3, 1], [5, 4, 0], [1, 0, 1]);
		for (const level of ['easy', 'hard'] as const) assert.deepEqual(botMove(forced, 1, level, rng)?.captured, [sq(5, 4)]);
		// moving to (4,3) gives a man away and loses two for it; the hard bot keeps away
		const trap = board([5, 2, 0], [5, 6, 0], [3, 4, 1], [2, 5, 1], [0, 7, 1]);
		const choice = botMove(trap, 0, 'hard', rng)!;
		const reply = legalMoves(applyMove(trap, choice), 1);
		assert.ok(!reply.some((m) => m.captured.length > 0), 'does not walk into a capture');
		assert.equal(botMove(board([4, 3, 0]), 1, 'hard', rng), null);
	});

	test('hard beats easy, and every game ends', { timeout: 120_000 }, () => {
		let hardWins = 0;
		const games = 4;
		for (let game = 0; game < games; game++) {
			const rng = seeded(100 + game);
			const hard: Side = game % 2 === 0 ? 0 : 1;
			let b = startBoard();
			let turn: Side = 0;
			let quiet = 0;
			let winner: Side | null = null;
			for (let ply = 0; ply < 400; ply++) {
				const move = botMove(b, turn, turn === hard ? 'hard' : 'easy', rng);
				if (!move) {
					winner = (1 - turn) as Side;
					break;
				}
				assert.ok(legalMoves(b, turn).some((m) => m.from === move.from && m.path.join() === move.path.join()));
				quiet = isProgress(b, move) ? 0 : quiet + 1;
				b = applyMove(b, move);
				turn = (1 - turn) as Side;
				if (quiet >= DRAW_PLIES) break;
			}
			if (winner === hard) hardWins++;
			else assert.notEqual(winner, 1 - hard, `game ${game}: the hard bot lost to the easy one`);
		}
		assert.ok(hardWins >= games - 1, `hard won ${hardWins} of ${games}`);
	});
});
