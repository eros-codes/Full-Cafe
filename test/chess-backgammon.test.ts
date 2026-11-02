import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Rng } from '../client/site/games/kit/random.js';
import {
	botMove,
	captured,
	fromFen,
	inCheck,
	insufficientMaterial,
	legalMoves,
	makeMove,
	outcomeOf,
	perft,
	replay,
	san,
	startPosition,
	toFen,
	type Move,
	type Position,
} from '../client/site/games/chess/engine.js';
import {
	applyBgMove,
	botPlay,
	diceLeft,
	diceOf,
	gamePoints,
	hasWon,
	newBgBoard,
	nextMoves,
	openingRoll,
	pips,
	plays,
	rollDie,
	singleMoves,
	type BgBoard,
	type Player,
} from '../client/site/games/backgammon/engine.js';

/** A seeded random source (mulberry32), so bot games repeat exactly. */
function seeded(seed: number): Rng {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const sq = (name: string) => 'abcdefgh'.indexOf(name[0]) + (8 - Number(name[1])) * 8;
const mv = (from: string, to: string, promo?: Move['promo']): Move => ({ from: sq(from), to: sq(to), ...(promo ? { promo } : {}) });
/** Plays moves in standard notation from `pos`. */
function playSan(pos: Position, moves: string[]): Position[] {
	const positions = [pos];
	for (const text of moves) {
		const here = positions[positions.length - 1];
		const m = legalMoves(here).find((l) => san(here, l).replace(/[+#]$/, '') === text.replace(/[+#]$/, ''));
		assert.ok(m, `${text} is legal in ${toFen(here)}`);
		positions.push(makeMove(here, m));
	}
	return positions;
}

describe('chess: moves', () => {
	// leaf counts of the standard test positions (chessprogramming.org «Perft Results»)
	test('perft of the standard positions', () => {
		assert.equal(perft(startPosition(), 3), 8902);
		assert.equal(perft(fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1'), 2), 2039);
		assert.equal(perft(fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1'), 3), 2812);
		assert.equal(perft(fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1'), 2), 264);
		assert.equal(perft(fromFen('rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8'), 2), 1486);
	});

	test('castling: not out of, through or into check; rights go with the king and rooks', () => {
		const open = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
		const castles = (pos: Position) => legalMoves(pos).filter((m) => pos.board[m.from].toLowerCase() === 'k' && Math.abs(m.to - m.from) === 2).length;
		assert.equal(castles(open), 2);
		assert.equal(castles(fromFen('r3k2r/8/8/8/8/8/8/R3K2R w - - 0 1')), 0);
		// a black rook on f8 covers f1: no short castling; on e8 the king is in check: none
		assert.equal(castles(fromFen('4kr2/8/8/8/8/8/8/R3K2R w KQ - 0 1')), 1);
		assert.equal(castles(fromFen('4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1')), 0);
		// b1 attacked does not stop long castling (only the king's squares count)
		assert.equal(castles(fromFen('1r5k/8/8/8/8/8/8/R3K2R w KQ - 0 1')), 2);
		const castled = makeMove(open, mv('e1', 'g1'));
		assert.equal(castled.board[sq('f1')], 'R');
		assert.equal(castled.board[sq('h1')], '.');
		assert.equal(castled.castling, 'kq');
		// taking the rook on a8 takes away black's long castling
		assert.equal(makeMove(open, mv('a1', 'a8')).castling, 'Kk');
	});

	test('en passant: right after the double step only, and it removes the pawn', () => {
		const positions = playSan(startPosition(), ['e4', 'a6', 'e5', 'd5']);
		const pos = positions[positions.length - 1];
		assert.equal(toFen(pos).split(' ')[3], 'd6');
		const ep = legalMoves(pos).find((m) => m.from === sq('e5') && m.to === sq('d6'));
		assert.ok(ep);
		assert.equal(san(pos, ep), 'exd6');
		const after = makeMove(pos, ep);
		assert.equal(after.board[sq('d5')], '.');
		assert.equal(after.board[sq('d6')], 'P');
		// one move later it is gone
		const later = playSan(pos, ['Nf3', 'Nf6'])[2];
		assert.equal(legalMoves(later).some((m) => m.from === sq('e5') && m.to === sq('d6')), false);
	});

	test('promotion: four choices, written e8=Q', () => {
		const pos = fromFen('7k/4P3/8/8/8/8/8/4K3 w - - 0 1');
		const promos = legalMoves(pos).filter((m) => m.from === sq('e7'));
		assert.deepEqual(promos.map((m) => m.promo).sort(), ['b', 'n', 'q', 'r']);
		assert.equal(san(pos, mv('e7', 'e8', 'q')), 'e8=Q+');
		assert.equal(makeMove(pos, mv('e7', 'e8', 'n')).board[sq('e8')], 'N');
	});

	test('notation: which knight, castling, mate', () => {
		const pos = fromFen('4k3/8/8/8/8/8/8/1N1NK3 w - - 0 1');
		assert.equal(san(pos, mv('b1', 'c3')), 'Nbc3');
		assert.equal(san(fromFen('4k3/8/8/8/8/8/8/R3K2R w KQ - 0 1'), mv('e1', 'c1')), 'O-O-O');
		const fool = playSan(startPosition(), ['f3', 'e5', 'g4']);
		assert.equal(san(fool[3], mv('d8', 'h4')), 'Qh4#');
	});
});

describe('chess: the end of a game', () => {
	test('checkmate, stalemate, too little material, fifty moves, repetition', () => {
		const fool = playSan(startPosition(), ['f3', 'e5', 'g4', 'Qh4']);
		assert.deepEqual(outcomeOf(fool), { kind: 'checkmate', winner: 'b' });
		assert.ok(inCheck(fool[fool.length - 1]));
		assert.deepEqual(outcomeOf([fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1')]), { kind: 'stalemate' });
		assert.deepEqual(outcomeOf([fromFen('8/8/4k3/8/8/2B5/4K3/8 w - - 0 1')]), { kind: 'material' });
		assert.equal(insufficientMaterial(fromFen('8/8/4k3/8/8/2N5/4KN2/8 w - - 0 1').board), false);
		// bishops on the same colour cannot mate; on both colours they can
		assert.equal(insufficientMaterial(fromFen('8/8/4k3/2b5/8/2B5/4K3/8 w - - 0 1').board), true);
		assert.equal(insufficientMaterial(fromFen('8/8/4k3/3b4/8/2B5/4K3/8 w - - 0 1').board), false);
		assert.deepEqual(outcomeOf([fromFen('4k3/8/8/8/8/8/4P3/R3K3 w - - 100 80')]), { kind: 'fifty' });
		const shuffle = playSan(startPosition(), ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']);
		assert.deepEqual(outcomeOf(shuffle), { kind: 'repetition' });
		assert.equal(outcomeOf(shuffle.slice(0, -1)), null);
	});

	test('replay rebuilds a game and refuses an illegal move', () => {
		const moves = [mv('e2', 'e4'), mv('e7', 'e5'), mv('g1', 'f3')];
		const positions = replay(moves);
		assert.ok(positions);
		assert.equal(positions.length, 4);
		assert.equal(replay([mv('e2', 'e5')]), null);
		assert.equal(replay([mv('e2', 'e4'), mv('e2', 'e4')]), null);
	});

	test('captured pieces and the balance', () => {
		const pos = fromFen('rnb1kbnr/pppp1ppp/8/8/8/8/PPP2PPP/RNBQKBNR w KQkq - 0 1');
		const lost = captured(pos.board);
		assert.deepEqual(lost.w, ['p', 'p']);
		assert.deepEqual(lost.b, ['q', 'p']);
		assert.equal(lost.balance, 8);
	});
});

describe('chess: the bot', () => {
	test('both levels take a mate in one', () => {
		const pos = playSan(startPosition(), ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5', 'Nf6'])[6];
		for (const level of ['easy', 'hard'] as const) {
			for (let seed = 1; seed <= 5; seed++) {
				const m = botMove(pos, level, seeded(seed));
				assert.ok(m);
				assert.equal(san(pos, m), 'Qxf7#', `${level} seed ${seed}`);
			}
		}
	});

	test('hard sees the mate it is threatened with, and takes a free queen', () => {
		const threatened = playSan(startPosition(), ['e4', 'e5', 'Bc4', 'Nc6', 'Qh5'])[5];
		for (let seed = 1; seed <= 5; seed++) {
			const m = botMove(threatened, 'hard', seeded(seed));
			assert.ok(m);
			const after = makeMove(threatened, m);
			const mates = legalMoves(after).filter((r) => outcomeOf([makeMove(after, r)])?.kind === 'checkmate');
			assert.equal(mates.length, 0, `after ${san(threatened, m)} white mates`);
		}
		// the black queen on d5 stands unprotected in front of a pawn and a knight
		const hanging = fromFen('rnb1kbnr/pppp1ppp/8/3qp3/4P3/2N5/PPPP1PPP/R1BQKBNR w KQkq - 0 1');
		for (let seed = 1; seed <= 3; seed++) assert.equal(botMove(hanging, 'hard', seeded(seed))!.to, sq('d5'));
	});

	test('hard beats easy', () => {
		// two games, hard with white and with black (fixed seeds; in a longer run hard won every game)
		for (const game of [3, 4]) {
			const rng = seeded(100 + game);
			const hardSide = game % 2 ? 'w' : 'b';
			const positions = [startPosition()];
			let outcome = null;
			for (let ply = 0; ply < 120 && !outcome; ply++) {
				const pos = positions[positions.length - 1];
				positions.push(makeMove(pos, botMove(pos, pos.turn === hardSide ? 'hard' : 'easy', rng)!));
				outcome = outcomeOf(positions);
			}
			assert.deepEqual(outcome, { kind: 'checkmate', winner: hardSide }, `game ${game}`);
		}
	});
});

// ─── تخته نرد ─────────────────────────────────────────────────────────────────

const total = (b: BgBoard, p: Player) => {
	let n = b.bar[p] + b.off[p];
	for (const v of b.points) n += p === 0 ? Math.max(0, v) : Math.max(0, -v);
	return n;
};
/** A board from player 0's points (index → count) and player 1's; the checkers not placed are borne off. */
function bg(zero: Record<number, number>, one: Record<number, number>, extra: Partial<BgBoard> = {}): BgBoard {
	const points = Array.from({ length: 24 }, () => 0);
	for (const [i, n] of Object.entries(zero)) points[Number(i)] = n;
	for (const [i, n] of Object.entries(one)) points[Number(i)] = -n;
	const bar = extra.bar ?? [0, 0];
	const placed = (p: Player) => total({ points, bar, off: [0, 0] }, p);
	return { points, bar, off: extra.off ?? [15 - placed(0), 15 - placed(1)] };
}

describe('backgammon: rules', () => {
	test('the start: 15 checkers each, 167 pips each', () => {
		const board = newBgBoard();
		assert.equal(total(board, 0), 15);
		assert.equal(total(board, 1), 15);
		assert.equal(pips(board, 0), 167);
		assert.equal(pips(board, 1), 167);
	});

	test('a checker on the bar enters first, into the opponent home; a closed point keeps it out', () => {
		const board = bg({ 12: 14 }, { 18: 2, 19: 2, 2: 11 }, { bar: [1, 0] });
		// die 6 → point 19 (index 18) is closed, die 5 → index 19 closed, die 4 → index 20 free
		assert.deepEqual(singleMoves(board, 0, 6), []);
		assert.deepEqual(singleMoves(board, 0, 4), [{ from: 'bar', to: 20, die: 4 }]);
		assert.equal(plays(board, 0, [6, 5])[0].length, 0);
		// player 1 enters from its side
		const other = bg({ 0: 2, 12: 13 }, { 20: 14 }, { bar: [0, 1] });
		assert.deepEqual(singleMoves(other, 1, 1), []);
		assert.deepEqual(singleMoves(other, 1, 3), [{ from: 'bar', to: 2, die: 3 }]);
	});

	test('a lone checker is hit and goes to the bar', () => {
		const board = bg({ 10: 1, 23: 14 }, { 7: 1, 0: 14 });
		const after = applyBgMove(board, 0, { from: 10, to: 7, die: 3 });
		assert.equal(after.points[7], 1);
		assert.deepEqual(after.bar, [0, 1]);
		assert.equal(total(after, 1), 15);
	});

	test('bearing off: only with all checkers home; a bigger die only from the furthest point', () => {
		const notHome = bg({ 3: 13, 8: 2 }, { 20: 15 });
		assert.equal(singleMoves(notHome, 0, 4).some((m) => m.to === 'off'), false);
		const home = bg({ 1: 2, 3: 3 }, { 20: 15 });
		assert.ok(singleMoves(home, 0, 4).some((m) => m.from === 3 && m.to === 'off'));
		// a 6 bears off from the furthest point (index 3), not from index 1
		const six = singleMoves(home, 0, 6).filter((m) => m.to === 'off');
		assert.deepEqual(six, [{ from: 3, to: 'off', die: 6 }]);
		// a 3 cannot bear off from index 1 while index 3 is occupied: it moves inside instead
		assert.deepEqual(singleMoves(home, 0, 3).filter((m) => m.to === 'off'), []);
	});

	test('play as many dice as possible; with one only, the bigger', () => {
		// one checker outside home on index 13, the rest home (so nothing can bear off yet)
		// 6 first is blocked (index 7), 5 then 6 works: that is the only way, both dice are played
		const order = bg({ 13: 1, 0: 14 }, { 7: 2, 20: 13 });
		assert.deepEqual(plays(order, 0, [6, 5]), [[{ from: 13, to: 8, die: 5 }, { from: 8, to: 2, die: 6 }]]);
		// either die alone but not both (index 2 blocked): the 6 must be played
		const either = bg({ 13: 1, 0: 14 }, { 2: 2, 20: 13 });
		assert.deepEqual(plays(either, 0, [6, 5]), [[{ from: 13, to: 7, die: 6 }]]);
		// the 6 cannot be played at all: then the 5
		const onlyFive = bg({ 13: 1, 0: 14 }, { 7: 2, 2: 2, 20: 11 });
		assert.deepEqual(plays(onlyFive, 0, [6, 5]), [[{ from: 13, to: 8, die: 5 }]]);
	});

	test('bearing off the last checker ends the turn, even with a die left', () => {
		const last = bg({ 2: 1 }, { 20: 15 });
		const options = plays(last, 0, [5, 2]);
		assert.ok(options.some((p) => p.length === 1 && p[0].to === 'off' && p[0].die === 5), JSON.stringify(options));
		assert.ok(options.some((p) => p.length === 2), 'or 2 first, then the 5');
	});

	test('a double is played four times', () => {
		assert.deepEqual(diceOf([4, 4]), [4, 4, 4, 4]);
		assert.deepEqual(diceOf([2, 5]), [2, 5]);
		const options = plays(newBgBoard(), 0, diceOf([3, 3]));
		assert.ok(options.every((p) => p.length === 4));
	});

	test('the moves allowed next follow a complete play, and the dice left', () => {
		const board = newBgBoard();
		const turn = plays(board, 0, [6, 5]);
		const first = nextMoves(turn, []);
		assert.ok(first.some((m) => m.from === 23 && m.to === 17 && m.die === 6));
		const made = [{ from: 23, to: 17, die: 6 } as const];
		const second = nextMoves(turn, made);
		assert.ok(second.length > 0 && second.every((m) => m.die === 5));
		assert.deepEqual(diceLeft([6, 5], made), [5]);
		assert.deepEqual(diceLeft([4, 4, 4, 4], [{ from: 12, to: 8, die: 4 }]), [4, 4, 4]);
	});

	test('a win is 1 point, a «مارس» 2', () => {
		const won = bg({}, { 20: 3 }, { off: [15, 12] });
		assert.ok(hasWon(won, 0));
		assert.equal(gamePoints(won, 0), 1);
		const mars = bg({}, { 20: 15 }, { off: [15, 0] });
		assert.equal(gamePoints(mars, 0), 2);
	});

	test('the opening roll never ties and the higher die starts', () => {
		for (let seed = 1; seed <= 30; seed++) {
			const { dice, starter } = openingRoll(seeded(seed));
			assert.notEqual(dice[0], dice[1]);
			assert.equal(starter, dice[0] > dice[1] ? 0 : 1);
		}
	});
});

describe('backgammon: the bot', () => {
	test('its play is always a complete legal one, and hard beats easy', () => {
		const rng = seeded(7);
		let hardWins = 0;
		for (let game = 0; game < 10; game++) {
			let board = newBgBoard();
			const hard: Player = (game % 2) as Player;
			const opening = openingRoll(rng);
			let turn = opening.starter;
			let dice: number[] = [...opening.dice];
			for (let t = 0; t < 600; t++) {
				const options = plays(board, turn, dice);
				const play = botPlay(board, turn, dice, turn === hard ? 'hard' : 'easy', rng);
				assert.equal(play.length, options[0].length);
				for (const m of play) board = applyBgMove(board, turn, m);
				assert.equal(total(board, 0) + total(board, 1), 30);
				if (hasWon(board, turn)) {
					if (turn === hard) hardWins++;
					break;
				}
				turn = turn === 0 ? 1 : 0;
				dice = diceOf([rollDie(rng), rollDie(rng)]);
			}
		}
		assert.ok(hardWins >= 7, `hard won ${hardWins} of 10`);
	});

	test('hard hits a lone checker when it can do it safely', () => {
		// player 1 has a blot on index 8; player 0 can hit it from index 12 with a 4
		const board = bg({ 12: 2, 5: 5, 7: 3, 23: 5 }, { 8: 1, 0: 2, 11: 4, 16: 3, 18: 5 });
		const play = botPlay(board, 0, [4, 4, 4, 4], 'hard', seeded(1));
		const end = play.reduce((b, m) => applyBgMove(b, 0, m), board);
		assert.equal(end.bar[1], 1);
	});
});
