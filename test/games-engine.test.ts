import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import type { Card, Deck } from '../client/site/games/data.js';
import { clockLeft, pauseClock, resumeClock, startClock } from '../client/site/games/kit/clock.js';
import { cardPool, nextSeen, pickCards } from '../client/site/games/kit/deck.js';
import { finalNames, joinNames } from '../client/site/games/kit/names.js';
import type { Rng } from '../client/site/games/kit/random.js';
import {
	SPY_CANDIDATES,
	accuse,
	declareGuess,
	defaultMinutes,
	guessPlace,
	maxSpies,
	newRound,
	nextSpyRound,
	startQuestions,
	startSpyGame,
	type SpySettings,
	type SpyState,
} from '../client/site/games/spy/engine.js';
import {
	answer,
	endsTurn,
	currentRound,
	currentSide,
	finishTurn,
	leaders,
	playAgain,
	startTurn,
	startWordGame,
	timeUp,
	toggleResult,
	turnPoints,
	type WordSettings,
	type WordState,
} from '../client/site/games/words/engine.js';
import { HOLD_MS, faceUp, initialTilt, tiltStep, type TiltState } from '../client/site/games/words/tilt.js';
import { cardLine, normalizeCardText, parseCardLines } from '../src/services/game-cards.js';
import { GAMES, gameStates } from '../src/services/game-catalog.js';

// Unit tests of the games page: the card text format, when a game can be shown, and the engines of
// «جاسوس», the word games and the forehead tilt (all pure functions).

/** A repeatable random source (mulberry32). */
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

const cards = (texts: string[], from = 1): Card[] => texts.map((text, i) => ({ id: from + i, text }));
const PLACES = cards(['فرودگاه', 'بیمارستان', 'مدرسه', 'سینما', 'بانک', 'کافه', 'پارک', 'موزه', 'استخر', 'هتل', 'ساحل', 'مزرعه', 'قطار', 'هواپیما', 'کتابخانه', 'باغ وحش', 'بازار', 'نانوایی', 'سیرک', 'دانشگاه', 'آرایشگاه', 'کویر', 'جنگل', 'کشتی', 'رستوران']);

describe('card text (admin editor and seed file)', () => {
	test('one card per line; «:» gives the forbidden words, split by «،» or «,»', () => {
		const { cards: parsed, errors, duplicates } = parseCardLines('فرودگاه\n\n  قهوه : فنجان، کافئین ,تلخ؛ اسپرسو  \n');
		assert.deepEqual(errors, []);
		assert.equal(duplicates, 0);
		assert.deepEqual(parsed, [
			{ text: 'فرودگاه', forbidden: [] },
			{ text: 'قهوه', forbidden: ['فنجان', 'کافئین', 'تلخ', 'اسپرسو'] },
		]);
		assert.equal(cardLine(parsed[1]), 'قهوه: فنجان، کافئین، تلخ، اسپرسو');
		assert.deepEqual(parseCardLines(parsed.map(cardLine)).cards, parsed, 'the editor text reads back the same');
	});

	test('Arabic «ي» and «ك» are Persian letters; a card repeated with another keyboard is one card', () => {
		assert.equal(normalizeCardText('  كافه   ي '), 'کافه ی');
		const result = parseCardLines(['کافه', 'كافه', 'کافه: میز']);
		assert.equal(result.cards.length, 1);
		assert.equal(result.duplicates, 2);
	});

	test('mistakes are reported with their line numbers', () => {
		const long = 'ا'.repeat(81);
		const result = parseCardLines([': بدون کلمه', long, 'قهوه: قهوه، فنجان', `نان: ${Array.from({ length: 9 }, (_, i) => `ک${i}`).join('، ')}`]);
		assert.deepEqual(
			result.errors.map((e) => e.line),
			[1, 2, 3, 4],
		);
		assert.equal(result.cards.length, 0);
	});
});

describe('which games the site shows', () => {
	const deck = (games: string[], texts: string[], forbidden = false, isActive = true) => ({
		games,
		isActive,
		cards: texts.map(() => ({ forbidden: forbidden ? ['x'] : [] })),
	});
	const many = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`);

	test('without settings: every game on, in the default order, word games need their minimum of cards', () => {
		const states = gameStates([], [deck(['spy'], many(10)), deck(['heads_up', 'charades'], many(25))]);
		assert.deepEqual(
			states.map((s) => s.key),
			GAMES.map((g) => g.key),
		);
		const byKey = Object.fromEntries(states.map((s) => [s.key, s]));
		assert.equal(byKey.spy.playable, true, '10 places are enough');
		assert.equal(byKey.charades.playable, true, '25 ≥ 20');
		assert.equal(byKey.heads_up.playable, false, '25 < 30');
		assert.equal(byKey.heads_up.available, 25);
		assert.equal(byKey.taboo.playable, false);
	});

	test('«کلمات ممنوعه» only counts cards with forbidden words; inactive decks count for nothing', () => {
		const states = gameStates([], [deck(['taboo'], many(30)), deck(['taboo'], many(15), true), deck(['taboo'], many(40), true, false)]);
		const taboo = states.find((s) => s.key === 'taboo')!;
		assert.equal(taboo.available, 15);
		assert.equal(taboo.playable, false);
	});

	test('the admin’s order and on/off win over the defaults', () => {
		const states = gameStates(
			[
				{ key: 'taboo', isActive: true, sortOrder: 0 },
				{ key: 'spy', isActive: false, sortOrder: 1 },
			],
			[deck(['spy'], many(30))],
		);
		assert.equal(states[0].key, 'taboo');
		assert.equal(states.find((s) => s.key === 'spy')!.playable, false, 'switched off');
	});
});

describe('drawing cards', () => {
	const decks: Deck[] = [
		{ id: 1, name: 'a', games: ['heads_up'], cards: cards(['سیب', 'موز', 'انار']) },
		{ id: 2, name: 'b', games: ['heads_up', 'charades'], cards: [...cards(['موز'], 10), ...cards(['هلو'], 11)] },
		{ id: 3, name: 'c', games: ['taboo'], cards: [{ id: 20, text: 'قهوه', forbidden: ['فنجان'] }, { id: 21, text: 'چای' }] },
	];

	test('the pool: the chosen decks of the game (all when none chosen), one card per text', () => {
		assert.deepEqual(
			cardPool(decks, 'heads_up', []).map((c) => c.text),
			['سیب', 'موز', 'انار', 'هلو'],
		);
		assert.deepEqual(
			cardPool(decks, 'heads_up', [2]).map((c) => c.text),
			['موز', 'هلو'],
		);
		assert.deepEqual(
			cardPool(decks, 'taboo', [], (c) => Boolean(c.forbidden?.length)).map((c) => c.text),
			['قهوه'],
		);
	});

	test('fresh cards first; the avoided ones only when nothing else is left', () => {
		const pool = cards(['a', 'b', 'c', 'd']);
		const avoid = new Set([1, 2, 3]);
		assert.deepEqual(
			pickCards(pool, 1, avoid, seeded(1)).map((c) => c.id),
			[4],
		);
		const two = pickCards(pool, 2, avoid, seeded(2));
		assert.equal(two[0].id, 4);
		assert.equal(two.length, 2);
		assert.equal(new Set(pickCards(pool, 4, new Set(), seeded(3)).map((c) => c.id)).size, 4, 'never the same card twice');
	});

	test('the phone remembers at most 70% of a pool, newest last', () => {
		assert.deepEqual(nextSeen([1, 2, 3], [4], 5), [2, 3, 4]);
		assert.deepEqual(nextSeen([1, 2], [1], 10), [2, 1], 'seen again moves to the end');
		assert.deepEqual(nextSeen([1], [2], 1), []);
	});
});

describe('clock and names', () => {
	test('a paused clock keeps its time; resumed, it counts down again', () => {
		const clock = startClock(60_000, 1_000);
		assert.equal(clockLeft(clock, 11_000), 50_000);
		const paused = pauseClock(clock, 11_000);
		assert.equal(clockLeft(paused, 99_000), 50_000);
		const resumed = resumeClock(paused, 100_000);
		assert.equal(clockLeft(resumed, 110_000), 40_000);
		assert.equal(clockLeft(resumed, 999_000), 0);
	});

	test('empty names become «بازیکن n»; repeated names get a number', () => {
		const placeholder = (i: number) => `بازیکن ${i + 1}`;
		assert.deepEqual(finalNames(['سارا', '  ', 'سارا', ' علی  رضا '], placeholder), ['سارا', 'بازیکن 2', 'سارا ۲', 'علی رضا']);
		assert.equal(joinNames(['سارا', 'علی', 'رضا']), 'سارا، علی و رضا');
	});
});

describe('«جاسوس»', () => {
	const players = ['سارا', 'علی', 'رضا', 'مینا', 'نیما', 'لیلا', 'آرش'];
	const settings: SpySettings = { players, spies: 1, minutes: 6, deckIds: [] };

	test('a round: one real place, a sorted list of candidates with it, spies among the players', () => {
		const round = newRound(settings, PLACES, new Set(), seeded(7));
		assert.equal(round.candidates.length, SPY_CANDIDATES);
		assert.ok(round.candidates.includes(round.place));
		assert.deepEqual(round.candidates, [...round.candidates].sort((a, b) => a.localeCompare(b, 'fa')));
		assert.equal(round.spies.length, 1);
		assert.ok(round.starter >= 0 && round.starter < players.length);
	});

	test('two spies only from six players up', () => {
		assert.equal(maxSpies(5), 1);
		assert.equal(maxSpies(6), 2);
		assert.equal(newRound({ ...settings, spies: 2 }, PLACES, new Set(), seeded(3)).spies.length, 2);
		assert.equal(newRound({ ...settings, players: players.slice(0, 4), spies: 2 }, PLACES, new Set(), seeded(3)).spies.length, 1);
		assert.equal(defaultMinutes(3), 5);
		assert.equal(defaultMinutes(12), 8);
	});

	test('a place seen lately is avoided while others are left', () => {
		const avoid = new Set(PLACES.slice(1).map((c) => c.id));
		assert.equal(newRound(settings, PLACES, avoid, seeded(5)).place, PLACES[0].text);
	});

	const started = (): SpyState => startQuestions(startSpyGame(settings, PLACES, new Set(), seeded(11)), 0);
	const citizen = (state: SpyState) => players.findIndex((_, i) => !state.round!.spies.includes(i));

	test('accusing a citizen: the spies win, +2 for each spy', () => {
		const state = started();
		const result = accuse(state, citizen(state));
		assert.equal(result.phase.kind, 'result');
		assert.equal(result.phase.kind === 'result' && result.phase.outcome.how, 'wrong');
		assert.equal(result.scores[state.round!.spies[0]], 2);
		assert.equal(result.scores.reduce((a, b) => a + b, 0), 2);
	});

	test('catching the spy: the spy still gets one guess at the place', () => {
		const state = started();
		const spy = state.round!.spies[0];
		const caught = accuse(state, spy);
		assert.deepEqual(caught.phase, { kind: 'guess', accused: spy, by: null });
		const wrongPlace = state.round!.candidates.find((p) => p !== state.round!.place)!;
		const lost = guessPlace(caught, wrongPlace);
		assert.equal(lost.phase.kind === 'result' && lost.phase.outcome.winner, 'citizens');
		assert.equal(lost.scores[spy], 0);
		assert.equal(lost.scores.reduce((a, b) => a + b, 0), players.length - 1, '+1 for every citizen');
		const escaped = guessPlace(caught, state.round!.place);
		assert.equal(escaped.phase.kind === 'result' && escaped.phase.outcome.how, 'escaped');
	});

	test('a spy who stops the game: right place wins, wrong place loses', () => {
		const begun = started();
		const spy = begun.round!.spies[0];
		const state = declareGuess(begun, spy);
		assert.deepEqual(state.phase, { kind: 'guess', accused: null, by: spy });
		const right = guessPlace(state, state.round!.place);
		assert.equal(right.phase.kind === 'result' && right.phase.outcome.how, 'guessed');
		assert.equal(right.phase.kind === 'result' && right.phase.outcome.how === 'guessed' && right.phase.outcome.by, spy);
		const wrong = guessPlace(state, state.round!.candidates.find((p) => p !== state.round!.place)!);
		assert.equal(wrong.phase.kind === 'result' && wrong.phase.outcome.how, 'missed');
	});

	test('only a spy can stop the game to guess: a citizen knows the place and would win it for the spies', () => {
		const begun = started();
		const citizen = begun.settings.players.findIndex((_, i) => !begun.round!.spies.includes(i));
		assert.equal(declareGuess(begun, citizen), begun);
	});

	test('the next round keeps the scores and deals again from the first player', () => {
		const done = accuse(started(), 0);
		const next = nextSpyRound(done, PLACES, new Set(), seeded(99));
		assert.equal(next.roundNo, 2);
		assert.deepEqual(next.scores, done.scores);
		assert.deepEqual(next.phase, { kind: 'deal', index: 0, showing: false });
		assert.equal(next.clock, null);
	});
});

describe('word games', () => {
	const words = cards(['سیب', 'موز', 'انار', 'هلو', 'گیلاس']);
	const base: WordSettings = { mode: 'charades', sides: ['تیم ۱', 'تیم ۲'], seconds: 60, rounds: 2, deckIds: [], oneWord: false };
	const playing = (settings: Partial<WordSettings> = {}): WordState => startTurn(startWordGame({ ...base, ...settings }), words[0], 0);

	test('a turn: guessed, passed, then the clock runs out on the card on screen', () => {
		let state = playing();
		state = answer(state, 'correct', words[1]);
		state = answer(state, 'pass', words[2]);
		state = timeUp(state);
		assert.equal(state.phase.kind, 'review');
		const results = state.phase.kind === 'review' ? state.phase.results : [];
		assert.deepEqual(
			results.map((r) => [r.text, r.outcome]),
			[
				['سیب', 'correct'],
				['موز', 'pass'],
				['انار', 'pass'],
			],
		);
		assert.deepEqual(state.used, [1, 2, 3]);
		assert.equal(turnPoints(results), 1);
	});

	test('«پانتومیم» one word per turn: the first guess ends the turn', () => {
		assert.equal(endsTurn(playing({ oneWord: true }), 'correct'), true, 'no next card is drawn for nothing');
		assert.equal(endsTurn(playing({ oneWord: true }), 'pass'), false);
		assert.equal(endsTurn(playing({ oneWord: false }), 'correct'), false);
		const state = answer(playing({ oneWord: true }), 'correct', words[1]);
		assert.equal(state.phase.kind, 'review');
	});

	test('a forbidden word only exists in «کلمات ممنوعه» and costs a point', () => {
		const charades = playing();
		assert.equal(answer(charades, 'buzz', words[1]), charades, 'no buzz in charades');
		let taboo = playing({ mode: 'taboo' });
		taboo = answer(taboo, 'buzz', words[1]);
		taboo = answer(taboo, 'correct', null);
		assert.equal(taboo.phase.kind, 'review', 'no card left: the turn ends');
		assert.equal(taboo.phase.kind === 'review' && turnPoints(taboo.phase.results), 0);
	});

	test('fixing the list after a turn cycles the outcome (taboo has three)', () => {
		let taboo = timeUp(playing({ mode: 'taboo' }));
		taboo = toggleResult(taboo, 0);
		assert.equal(taboo.phase.kind === 'review' && taboo.phase.results[0].outcome, 'buzz');
		taboo = toggleResult(taboo, 0);
		assert.equal(taboo.phase.kind === 'review' && taboo.phase.results[0].outcome, 'correct');
		let heads = timeUp(playing({ mode: 'heads_up', sides: ['a', 'b'] }));
		heads = toggleResult(toggleResult(heads, 0), 0);
		assert.equal(heads.phase.kind === 'review' && heads.phase.results[0].outcome, 'pass', 'two outcomes only');
	});

	test('turns go round the sides; after the last round the game is over', () => {
		let state = startWordGame(base);
		const play = (points: number) => {
			state = startTurn(state, words[0], 0);
			for (let i = 0; i < points; i++) state = answer(state, 'correct', words[i + 1] ?? words[0]);
			state = finishTurn(timeUp(state));
		};
		assert.equal(currentSide(state), 0);
		play(2);
		assert.equal(currentSide(state), 1);
		assert.equal(currentRound(state), 1);
		play(1);
		assert.equal(currentRound(state), 2);
		play(0);
		assert.equal(state.phase.kind, 'ready');
		play(3);
		assert.equal(state.phase.kind, 'over');
		assert.deepEqual(state.scores, [2, 4]);
		assert.deepEqual(leaders(state.scores), [1]);
		assert.deepEqual(leaders([3, 3, 1]), [0, 1], 'a tie');
		const again = playAgain(state);
		assert.deepEqual(again.scores, [0, 0]);
		assert.equal(again.phase.kind, 'ready');
	});
});

describe('forehead tilt', () => {
	test('screen up = 1, upright (portrait or landscape) = 0, face down = −1', () => {
		assert.equal(Math.round(faceUp(0, 0) * 100) / 100, 1);
		assert.ok(Math.abs(faceUp(90, 0)) < 1e-9);
		assert.ok(Math.abs(faceUp(0, 90)) < 1e-9);
		assert.ok(Math.abs(faceUp(0, -90)) < 1e-9);
		assert.equal(Math.round(faceUp(180, 0)), -1);
		// landscape past upright: the browser flips beta by 180 and gamma changes sign, the value stays continuous
		assert.ok(faceUp(180, 60) < -0.4);
		assert.ok(faceUp(0, 60) > 0.4);
	});

	const run = (readings: [number, number][]) => {
		let state: TiltState = initialTilt();
		const events: string[] = [];
		for (const [value, at] of readings) {
			const step = tiltStep(state, value, at);
			state = step.state;
			if (step.event) events.push(step.event);
		}
		return events;
	};

	test('nothing counts until the phone stood upright once', () => {
		assert.deepEqual(
			run([
				[-0.9, 0],
				[-0.9, 500],
			]),
			[],
		);
	});

	test('down = correct, up = pass, each tilt counted once until the phone is upright again', () => {
		assert.deepEqual(
			run([
				[0, 0],
				[-0.8, 100],
				[-0.8, 100 + HOLD_MS],
				[-0.9, 400],
				[0.1, 600],
				[0.8, 700],
				[0.8, 700 + HOLD_MS],
			]),
			['correct', 'pass'],
		);
	});

	test('a quick shake is not an answer', () => {
		assert.deepEqual(
			run([
				[0, 0],
				[-0.8, 100],
				[0.1, 120],
				[0.7, 140],
				[0, 160],
			]),
			[],
		);
	});
});
