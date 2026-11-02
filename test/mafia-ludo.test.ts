import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Rng } from '../client/site/games/kit/random.js';
import {
	DEFAULT_RULES,
	HOME,
	HOME_CELLS,
	TRACK_CELLS,
	applyMove,
	botMove,
	distinctMoves,
	hasWon,
	isSafeTrackCell,
	legalMoves,
	newBoard,
	nextSeat,
	pawnCell,
	rollDie,
	rollsAgain,
	seatsFor,
	trackCell,
	type LudoBoard,
} from '../client/site/games/ludo/engine.js';
import {
	alive,
	canAct,
	chooseAtNight,
	defaultMafiaCount,
	fitSettings,
	initialMafiaState,
	looksMafia,
	maxMafia,
	nightSteps,
	rolesFor,
	startDay,
	startMafia,
	startNight,
	teammates,
	voteOut,
	winnerOf,
	type MafiaPlayer,
	type MafiaState,
	type Role,
} from '../client/site/games/mafia/engine.js';

// Unit tests of «مافیا» (roles, nights, votes, winners) and «منچ» (board, moves, captures, the bot).

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

const names = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

describe('«مافیا»', () => {
	test('role counts follow the settings and stay sensible for the group', () => {
		assert.equal(defaultMafiaCount(6), 2);
		assert.equal(defaultMafiaCount(5), 1);
		assert.equal(maxMafia(7), 3);
		const settings = { ...initialMafiaState(names(8)).settings, mafia: 3, sniper: true };
		const roles = rolesFor(settings);
		const count = (role: Role) => roles.filter((r) => r === role).length;
		assert.equal(roles.length, 8);
		assert.equal(count('godfather') + count('mafia'), 3);
		assert.equal(count('godfather'), 1);
		assert.deepEqual([count('doctor'), count('detective'), count('sniper'), count('citizen')], [1, 1, 1, 2]);
		const crowded = fitSettings({ ...initialMafiaState(names(5)).settings, mafia: 9, sniper: true });
		assert.equal(crowded.mafia, 2, 'never half of the group');
		assert.equal([crowded.doctor, crowded.detective, crowded.sniper].filter(Boolean).length, 3, '3 town roles fit in a town of 3');
	});

	test('dealing: every player gets a role; the mafia see each other', () => {
		const state = startMafia({ ...initialMafiaState(names(9)).settings, mafia: 3 }, seeded(1));
		assert.equal(state.players.length, 9);
		assert.deepEqual(state.phase, { kind: 'deal', index: 0, showing: false });
		const mafia = state.players.flatMap((p, i) => (p.role === 'mafia' || p.role === 'godfather' ? [i] : []));
		assert.equal(mafia.length, 3);
		assert.deepEqual(teammates(state.players, mafia[0]), mafia.slice(1));
	});

	const fixed = (roles: Role[]): MafiaState => {
		const base = initialMafiaState(names(roles.length));
		const players: MafiaPlayer[] = roles.map((role, i) => ({ name: `p${i}`, role, alive: true }));
		return startNight(startDay({ ...base, settings: { ...base.settings, mafia: 2, sniper: true }, players, phase: { kind: 'handover' } }));
	};
	// p0 godfather, p1 mafia, p2 doctor, p3 detective, p4 sniper, p5–p7 citizens
	const ROLES: Role[] = ['godfather', 'mafia', 'doctor', 'detective', 'sniper', 'citizen', 'citizen', 'citizen'];

	test('a night: the mafia shoot, the doctor saves, the detective sees through everyone but the godfather', () => {
		let s = fixed(ROLES);
		assert.deepEqual(nightSteps(s), ['mafia', 'doctor', 'detective', 'sniper']);
		s = chooseAtNight(s, 5); // mafia → p5
		s = chooseAtNight(s, 5); // doctor saves p5
		s = chooseAtNight(s, 0); // detective asks about the godfather
		assert.equal(looksMafia(s.players[0]), false, 'the godfather looks like a citizen');
		assert.equal(looksMafia(s.players[1]), true);
		s = chooseAtNight(s, null); // sniper keeps the bullet
		assert.equal(s.phase.kind, 'day');
		assert.equal(s.day, 2);
		assert.deepEqual(s.log.at(-1), { kind: 'night', day: 1, died: [], saved: true });
		assert.equal(s.sniperBullet, true);
	});

	test('the sniper: hits a mafia, or dies shooting the town; one bullet only', () => {
		let s = fixed(ROLES);
		for (const choice of [6, null, null, 1]) s = chooseAtNight(s, choice); // mafia kill p6, sniper shoots p1 (mafia)
		assert.deepEqual(s.log.at(-1), { kind: 'night', day: 1, died: [1, 6], saved: false });
		assert.equal(s.sniperBullet, false);
		s = startNight(s);
		assert.equal(canAct(s, 'sniper'), false);
		assert.ok(nightSteps(s).includes('sniper'), 'still called, so nobody learns the bullet is gone');
		let t = fixed(ROLES);
		for (const choice of [null, null, null, 7]) t = chooseAtNight(t, choice); // sniper shoots a citizen
		assert.deepEqual(t.log.at(-1)?.kind === 'night' && t.log.at(-1), { kind: 'night', day: 1, died: [4], saved: false });
	});

	test('a dead role is still called at night but its choice does nothing', () => {
		let s = fixed(ROLES);
		s = { ...s, players: s.players.map((p, i) => (i === 2 ? { ...p, alive: false } : p)) };
		for (const choice of [5, 5, null, null]) s = chooseAtNight(s, choice); // the dead doctor «saves» p5
		assert.equal(s.players[5].alive, false);
	});

	test('votes and winners', () => {
		let s = startDay({ ...fixed(ROLES), phase: { kind: 'day' } });
		s = voteOut(s, 0);
		assert.equal(s.phase.kind, 'night');
		assert.equal(winnerOf(s.players), null);
		s = voteOut(s, 1);
		assert.deepEqual(s.phase, { kind: 'over', winner: 'town' });
		const players: MafiaPlayer[] = ROLES.map((role, i) => ({ name: `p${i}`, role, alive: i < 4 }));
		assert.equal(winnerOf(players), 'mafia', '2 mafia against 2 town');
		assert.deepEqual(alive(players), [0, 1, 2, 3]);
	});
});

describe('«منچ»', () => {
	test('the board: 52 track cells, no cell twice, home columns off the track', () => {
		assert.equal(TRACK_CELLS.length, 52);
		assert.equal(new Set(TRACK_CELLS.map(([r, c]) => `${r},${c}`)).size, 52);
		const track = new Set(TRACK_CELLS.map(([r, c]) => `${r},${c}`));
		for (const column of HOME_CELLS) for (const [r, c] of column) assert.ok(!track.has(`${r},${c}`));
		// every seat's last track cell is next to the first cell of its home column
		for (let seat = 0; seat < 4; seat++) {
			const [lr, lc] = pawnCell(seat, 0, 50);
			const [hr, hc] = pawnCell(seat, 0, 51);
			assert.equal(Math.abs(lr - hr) + Math.abs(lc - hc), 1, `seat ${seat}`);
		}
		assert.deepEqual(seatsFor(2), [0, 2]);
		assert.ok(isSafeTrackCell(0) && isSafeTrackCell(13) && isSafeTrackCell(8) && !isSafeTrackCell(5));
	});

	test('leaving the yard needs a 6 (or a 1 too when that rule is off); a 6 rolls again', () => {
		const board = newBoard([0, 2]);
		assert.equal(legalMoves(board, 0, 5, DEFAULT_RULES).length, 0);
		assert.equal(distinctMoves(legalMoves(board, 0, 6, DEFAULT_RULES)).length, 1, 'the four yard pawns make one move');
		assert.equal(legalMoves(board, 0, 1, { ...DEFAULT_RULES, sixToEnter: false }).length, 4);
		assert.ok(rollsAgain(6, DEFAULT_RULES));
		assert.ok(!rollsAgain(6, { ...DEFAULT_RULES, sixAgain: false }));
		assert.equal(nextSeat(board, 2), 0);
	});

	test('landing on another pawn sends it home, except on a safe cell', () => {
		let board: LudoBoard = newBoard([0, 1]);
		// seat 1's pawn on track cell 20 (its progress 7); seat 0's pawn 4 behind it (progress 16 = cell 16)
		board.progress[1][0] = 7;
		board.progress[0][0] = 16;
		assert.equal(trackCell(1, 7), 20);
		const [move] = legalMoves(board, 0, 4, DEFAULT_RULES).filter((m) => m.pawn === 0);
		assert.deepEqual(move.captures, [[1, 0]]);
		board = applyMove(board, 0, move);
		assert.equal(board.progress[1][0], -1);
		// on a star cell (21) nothing is taken
		const safe: LudoBoard = newBoard([0, 1]);
		safe.progress[1][0] = 8; // cell 21
		safe.progress[0][0] = 17;
		assert.deepEqual(legalMoves(safe, 0, 4, DEFAULT_RULES).find((m) => m.pawn === 0)?.captures, []);
		assert.deepEqual(legalMoves(safe, 0, 4, { ...DEFAULT_RULES, safeCells: false }).find((m) => m.pawn === 0)?.captures, [[1, 0]]);
	});

	test('home only by the exact count; four pawns home win', () => {
		const board = newBoard([0, 2]);
		board.progress[0] = [HOME, HOME, HOME, 53];
		assert.equal(legalMoves(board, 0, 4, DEFAULT_RULES).length, 0, '53 + 4 > 56');
		const [last] = legalMoves(board, 0, 3, DEFAULT_RULES);
		assert.ok(hasWon(applyMove(board, 0, last), 0));
	});

	test('the hard bot captures when it can and beats the easy one', () => {
		const board = newBoard([0, 1]);
		board.progress[1][0] = 7;
		board.progress[0][0] = 16;
		board.progress[0][1] = 2;
		assert.deepEqual(botMove(board, 0, 4, DEFAULT_RULES, 'hard', seeded(3))?.captures, [[1, 0]]);
		let hardWins = 0;
		for (let game = 0; game < 12; game++) {
			const rng = seeded(40 + game);
			let b = newBoard([0, 2]);
			let seat = game % 2 ? 2 : 0;
			for (let turn = 0; turn < 3000; turn++) {
				const roll = rollDie(rng);
				const move = botMove(b, seat, roll, DEFAULT_RULES, seat === 0 ? 'hard' : 'easy', rng);
				if (move) b = applyMove(b, seat, move);
				if (hasWon(b, seat)) {
					if (seat === 0) hardWins++;
					break;
				}
				if (!rollsAgain(roll, DEFAULT_RULES)) seat = nextSeat(b, seat);
			}
		}
		assert.ok(hardWins >= 8, `hard won ${hardWins} of 12`);
	});
});
