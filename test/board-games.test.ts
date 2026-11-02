import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { COLS, ROWS, botColumn, drop, emptyC4, isBoardFull, landingRow, winLineAt, winningColumn, type C4Board, type Disc } from '../client/site/games/board/connect4.js';
import { botLine, drawLine, emptyDots, freeLines, isOver, scoresOf, sides, type DotsBoard, type Line } from '../client/site/games/board/dots-rules.js';
import { botMove, emptyCells, emptyBoard, isFull, play, winnerOf, type Mark, type TttBoard } from '../client/site/games/board/tictactoe-rules.js';
import type { Rng } from '../client/site/games/kit/random.js';

// Unit tests of the board games and their bots (pure functions).

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

describe('«دوز»', () => {
	test('three in a row wins; a full board without one is a draw', () => {
		let board = emptyBoard();
		for (const [cell, player] of [
			[0, 0],
			[3, 1],
			[1, 0],
			[4, 1],
			[2, 0],
		] as [number, Mark][])
			board = play(board, cell, player);
		assert.deepEqual(winnerOf(board), { player: 0, line: [0, 1, 2] });
		const draw: TttBoard = [0, 1, 0, 0, 1, 1, 1, 0, 0];
		assert.equal(winnerOf(draw), null);
		assert.ok(isFull(draw));
		assert.equal(play(board, 0, 1), board, 'a taken cell stays');
	});

	/** Every game the opponent can play against the hard bot: the bot must never lose. */
	function neverLoses(board: TttBoard, toMove: Mark, bot: Mark): boolean {
		const won = winnerOf(board);
		if (won) return won.player === bot;
		if (isFull(board)) return true;
		if (toMove === bot) return neverLoses(play(board, botMove(board, bot, 'hard', seeded(1)), bot), (1 - bot) as Mark, bot);
		return emptyCells(board).every((cell) => neverLoses(play(board, cell, toMove), bot, bot));
	}

	test('the hard bot never loses, starting or second', () => {
		assert.ok(neverLoses(emptyBoard(), 0, 0), 'bot starts');
		assert.ok(neverLoses(emptyBoard(), 0, 1), 'bot second');
	});

	test('the hard bot wins when it can and blocks when it must', () => {
		const win: TttBoard = [1, 1, null, 0, 0, null, null, null, null];
		assert.equal(botMove(win, 1, 'hard', seeded(2)), 2);
		const block: TttBoard = [0, 0, null, null, 1, null, null, null, null];
		assert.equal(botMove(block, 1, 'hard', seeded(3)), 2);
	});

	test('the easy bot can be beaten', () => {
		let losses = 0;
		for (let game = 0; game < 40; game++) {
			const rng = seeded(100 + game);
			let board = emptyBoard();
			let toMove: Mark = 0;
			while (!winnerOf(board) && !isFull(board)) {
				// the human plays perfectly
				const cell = toMove === 1 ? botMove(board, 1, 'easy', rng) : botMove(board, 0, 'hard', rng);
				board = play(board, cell, toMove);
				toMove = (1 - toMove) as Mark;
			}
			if (winnerOf(board)?.player === 0) losses++;
		}
		assert.ok(losses >= 10, `easy bot lost ${losses} of 40`);
	});
});

describe('«چهار در یک ردیف»', () => {
	const play4 = (moves: number[]): { board: C4Board; last: number } => {
		let board = emptyC4();
		let last = -1;
		moves.forEach((col, i) => {
			const step = drop(board, col, (i % 2) as Disc)!;
			board = step.board;
			last = step.index;
		});
		return { board, last };
	};

	test('a disc falls to the lowest free cell; a full column takes no more', () => {
		const { board } = play4([3, 3, 3]);
		assert.equal(landingRow(board, 3), ROWS - 4);
		const full = play4([0, 0, 0, 0, 0, 0]).board;
		assert.equal(landingRow(full, 0), -1);
		assert.equal(drop(full, 0, 0), null);
		assert.equal(COLS * ROWS, 42);
	});

	test('four across, down and diagonal win', () => {
		const across = play4([0, 0, 1, 1, 2, 2, 3]);
		assert.equal(winLineAt(across.board, across.last)?.length, 4);
		const down = play4([5, 6, 5, 6, 5, 6, 5]);
		assert.ok(winLineAt(down.board, down.last));
		// diagonal for player 0: (5,0) (4,1) (3,2) (2,3)
		const diagonal = play4([0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3]);
		assert.ok(winLineAt(diagonal.board, diagonal.last), 'diagonal');
		const none = play4([0, 1, 2]);
		assert.equal(winLineAt(none.board, none.last), null);
	});

	test('both bots take a win; the hard bot blocks a threat', () => {
		const threat = play4([0, 6, 1, 6, 2]).board; // player 0 has three at the bottom, player 1 to move
		assert.equal(winningColumn(threat, 0), 3);
		assert.equal(botColumn(threat, 1, 'hard', seeded(4)), 3, 'block');
		const chance = play4([0, 6, 1, 6, 2, 6]).board; // player 0 to move, can win in column 3
		assert.equal(botColumn(chance, 0, 'easy', seeded(5)), 3);
		assert.equal(botColumn(chance, 0, 'hard', seeded(5)), 3);
	});

	test('the hard bot beats a random player', () => {
		let wins = 0;
		for (let game = 0; game < 10; game++) {
			const rng = seeded(500 + game);
			let board = emptyC4();
			let turn: Disc = (game % 2) as Disc;
			let winner: Disc | null = null;
			while (winner === null && !isBoardFull(board)) {
				const open = Array.from({ length: COLS }, (_, c) => c).filter((c) => landingRow(board, c) >= 0);
				const col = turn === 1 ? botColumn(board, 1, 'hard', rng) : open[Math.floor(rng() * open.length)];
				const step = drop(board, col, turn)!;
				board = step.board;
				if (winLineAt(board, step.index)) winner = turn;
				turn = (1 - turn) as Disc;
			}
			if (winner === 1) wins++;
		}
		assert.equal(wins, 10);
	});
});

describe('«نقطه‌بازی»', () => {
	const line = (kind: 'h' | 'v', r: number, c: number): Line => ({ kind, r, c });

	test('the fourth side closes the box for the player, who keeps the turn', () => {
		let board = emptyDots(2);
		assert.equal(freeLines(board).length, 12);
		for (const l of [line('h', 0, 0), line('v', 0, 0), line('h', 1, 0)]) board = drawLine(board, l, 0).board;
		assert.equal(sides(board, 0, 0), 3);
		const step = drawLine(board, line('v', 0, 1), 1);
		assert.equal(step.closed, 1);
		assert.equal(step.board.boxes[0], 1);
		assert.deepEqual(scoresOf(step.board, 2), [0, 1]);
		assert.equal(drawLine(step.board, line('v', 0, 1), 0).closed, 0, 'a drawn line stays as it is');
	});

	test('one line can close two boxes', () => {
		let board = emptyDots(2);
		for (const l of [line('h', 0, 0), line('v', 0, 0), line('h', 1, 0), line('h', 0, 1), line('v', 0, 2), line('h', 1, 1)]) board = drawLine(board, l, 0).board;
		assert.equal(drawLine(board, line('v', 0, 1), 1).closed, 2);
	});

	test('the hard bot takes a box, otherwise gives nothing away, otherwise gives the least', () => {
		let board = emptyDots(3);
		for (const l of [line('h', 0, 0), line('v', 0, 0), line('h', 1, 0)]) board = drawLine(board, l, 0).board;
		const taken = drawLine(board, botLine(board, 'hard', seeded(6)), 1);
		assert.equal(taken.closed, 1);
		const fresh = emptyDots(3);
		const quiet = drawLine(fresh, botLine(fresh, 'hard', seeded(7)), 1).board;
		assert.ok(quiet.boxes.every((o) => o === null));
		// no safe line left (only the top row is open, each box has two sides): the bot's line gives away no
		// more boxes than any other line would
		let strip: DotsBoard = emptyDots(3);
		for (let c = 0; c < 3; c++) for (const r of [0, 1, 2, 3]) strip = drawLine(strip, line('h', r, c), 0).board;
		for (let r = 1; r < 3; r++) for (let c = 0; c <= 3; c++) strip = drawLine(strip, line('v', r, c), 0).board;
		const given = (l: Line) => {
			let b = drawLine(strip, l, 0).board;
			let taken = 0;
			for (;;) {
				const take = freeLines(b).find((x) => drawLine(b, x, 1).closed > 0);
				if (!take) return taken;
				const s2 = drawLine(b, take, 1);
				taken += s2.closed;
				b = s2.board;
			}
		};
		const choice = botLine(strip, 'hard', seeded(8));
		const least = Math.min(...freeLines(strip).map(given));
		assert.equal(given(choice), least);
	});

	test('a full game ends with every box owned; the hard bot beats the easy one', () => {
		let hardWins = 0;
		for (let game = 0; game < 10; game++) {
			const rng = seeded(900 + game);
			let board = emptyDots(4);
			let turn = game % 2;
			while (!isOver(board)) {
				const step = drawLine(board, botLine(board, turn === 0 ? 'hard' : 'easy', rng), turn);
				board = step.board;
				if (!step.closed) turn = 1 - turn;
			}
			assert.equal(freeLines(board).length, 0);
			const [hard, easy] = scoresOf(board, 2);
			assert.equal(hard + easy, 16);
			if (hard > easy) hardWins++;
		}
		assert.ok(hardWins >= 8, `hard won ${hardWins} of 10`);
	});
});
