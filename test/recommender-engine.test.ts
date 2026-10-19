import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import {
	CONFIG,
	answer,
	answerOptions,
	availableKinds,
	buildCatalog,
	canStartRound2,
	chooseKind,
	contenders,
	groupInfo,
	initialState,
	keepAsking,
	more,
	nextQuestion,
	progress,
	questionText,
	scoreProduct,
	showNow,
	skip,
	startRound2,
	type Catalog,
	type EngineGroup,
	type EngineProduct,
	type Kind,
	type RecState,
} from '../client/site/menu/recommender/engine.js';

// Unit tests of «انتخاب برای من» (spec section 11, plus the three agreed corrections).

let nextOptionId = 1;
function group(id: number, name: string, labels: string[], extra: Partial<EngineGroup> = {}): EngineGroup {
	return {
		id,
		name,
		question: `${name}؟`,
		questionByKind: null,
		multi: false,
		strictness: 'SOFT',
		importance: 3,
		kinds: ['DRINK', 'FOOD', 'DESSERT'],
		options: labels.map((label) => ({ id: nextOptionId++, label })),
		...extra,
	};
}
const o = (g: EngineGroup, label: string) => g.options.find((x) => x.label === label)!.id;

interface P extends EngineProduct {
	name: string;
}
let nextProductId = 1;
const product = (name: string, kind: Kind, categoryId: number, optionIds: number[]): P => ({ id: nextProductId++, name, kind, categoryId, optionIds });
const names = (catalog: Catalog<P>, state: RecState) => (state.result?.suggestions ?? []).map((s) => catalog.byId.get(s.productId)!.name);

// ─── the 10-drink example discussed with the owner ────────────────────────────
const temp = group(1, 'دما', ['گرم', 'سرد'], { importance: 5, kinds: ['DRINK', 'DESSERT'] });
const caffeine = group(2, 'کافئین', ['با کافئین', 'بدون کافئین'], { importance: 4, kinds: ['DRINK'] });
const taste = group(3, 'طعم', ['شیرین', 'کم‌شیرین', 'تلخ'], { importance: 3, kinds: ['DRINK', 'DESSERT'] });
const weight = group(4, 'سنگینی', ['سبک', 'سنگین'], { importance: 4 });
const diet = group(5, 'محدودیت', ['گیاهخوار', 'بدون آجیل'], { strictness: 'HARD', multi: true });
const flavor = group(6, 'مزه', ['شکلاتی', 'میوه‌ای', 'قهوه‌ای'], { multi: true, kinds: ['DRINK', 'DESSERT'] });
const groups = [temp, caffeine, taste, weight, diet, flavor];

const HOT = 10;
const COLD = 11;
const drinks: P[] = [
	product('اسپرسو', 'DRINK', HOT, [o(temp, 'گرم'), o(caffeine, 'با کافئین'), o(taste, 'تلخ')]),
	product('لاته', 'DRINK', HOT, [o(temp, 'گرم'), o(caffeine, 'با کافئین'), o(taste, 'کم‌شیرین')]),
	product('کاپوچینو', 'DRINK', HOT, [o(temp, 'گرم'), o(caffeine, 'با کافئین'), o(taste, 'کم‌شیرین')]),
	product('موکا', 'DRINK', HOT, [o(temp, 'گرم'), o(caffeine, 'با کافئین'), o(taste, 'شیرین')]),
	product('هات‌چاکلت', 'DRINK', HOT, [o(temp, 'گرم'), o(caffeine, 'بدون کافئین'), o(taste, 'شیرین')]),
	product('دمنوش', 'DRINK', HOT, [o(temp, 'گرم'), o(caffeine, 'بدون کافئین'), o(taste, 'کم‌شیرین')]),
	product('لیموناد', 'DRINK', COLD, [o(temp, 'سرد'), o(caffeine, 'بدون کافئین'), o(taste, 'شیرین')]),
	product('شیک شکلات', 'DRINK', COLD, [o(temp, 'سرد'), o(caffeine, 'بدون کافئین'), o(taste, 'شیرین')]),
	product('شیک توت‌فرنگی', 'DRINK', COLD, [o(temp, 'سرد'), o(caffeine, 'بدون کافئین'), o(taste, 'شیرین')]),
	product('آیس‌تی', 'DRINK', COLD, [o(temp, 'سرد'), o(caffeine, 'بدون کافئین'), o(taste, 'کم‌شیرین')]),
];
const exampleGroups = [temp, caffeine, taste];

describe('recommender engine', () => {
	test('the owner\'s example: «سرد» → asks taste (not caffeine) → three cold sweet drinks after two questions', () => {
		const catalog = buildCatalog(exampleGroups, drinks);
		let s = chooseKind(initialState(7), catalog, 'DRINK');
		assert.equal(s.phase, 'question');
		assert.equal(s.current, temp.id, 'the most useful first question is the temperature');
		s = answer(s, catalog, [o(temp, 'سرد')]);
		assert.equal(s.current, taste.id, 'caffeine separates nothing among the cold drinks: not asked');
		s = answer(s, catalog, [o(taste, 'شیرین')]);
		assert.equal(s.phase, 'results', 'three contenders left: no more questions');
		assert.deepEqual(names(catalog, s).sort(), ['شیک توت‌فرنگی', 'شیک شکلات', 'لیموناد'].sort());
		assert.equal(s.result!.note, 'none');
		assert.deepEqual(s.result!.suggestions[0].reasons, ['سرد', 'شیرین'], 'reason: matching labels, most important first');
	});

	test('scoring: match 1, miss 0, unknown 0.5, and a group that is not for the kind is left out', () => {
		const salad = product('سالاد', 'FOOD', 20, [o(weight, 'سبک')]);
		const tea = product('چای', 'DRINK', 21, [o(weight, 'سبک'), o(caffeine, 'بدون کافئین')]);
		const untaggedTea = product('دمنوش بی‌برچسب', 'DRINK', 21, []);
		const catalog = buildCatalog(groups, [salad, tea, untaggedTea]);
		const state: RecState = { ...initialState(1), kind: 'ANY', answers: { [caffeine.id]: [o(caffeine, 'بدون کافئین')], [weight.id]: [o(weight, 'سبک')] } };
		assert.equal(scoreProduct(salad, state, catalog).score, 1, 'caffeine is not a food question: the salad is not punished for it');
		assert.equal(scoreProduct(tea, state, catalog).score, 1);
		assert.equal(scoreProduct(untaggedTea, state, catalog).score, 0.5, 'unknown everywhere');
		const miss: RecState = { ...state, answers: { [weight.id]: [o(weight, 'سنگین')] } };
		assert.equal(scoreProduct(tea, miss, catalog).score, 0);
		assert.equal(scoreProduct(tea, { ...initialState(1), kind: 'ANY' }, catalog).score, 0.5, 'no answers: everyone equal');
	});

	test('«هیچ‌کدام»: a group the admin set to none of its options is a miss, not unknown, and counts as tagged', () => {
		const water: P = { ...product('آب معدنی', 'DRINK', 30, [o(temp, 'سرد')]), noneGroupIds: [flavor.id] };
		const untagged = product('نوشیدنی بی‌مزه‌ی بی‌برچسب', 'DRINK', 30, [o(temp, 'سرد')]);
		const fruity = product('اسموتی', 'DRINK', 31, [o(temp, 'سرد'), o(flavor, 'میوه‌ای')]);
		const choco = product('شیک', 'DRINK', 31, [o(temp, 'سرد'), o(flavor, 'شکلاتی')]);
		const catalog = buildCatalog([temp, flavor], [water, untagged, fruity, choco]);
		const state: RecState = { ...initialState(1), kind: 'DRINK', answers: { [flavor.id]: [o(flavor, 'میوه‌ای')] } };
		assert.equal(scoreProduct(water, state, catalog).score, 0, '«هیچ‌کدام» = miss');
		assert.equal(scoreProduct(untagged, state, catalog).score, 0.5, 'untagged = unknown');
		assert.equal(scoreProduct(fruity, state, catalog).score, 1);
		// coverage: water is known (3 of 4 ≥ 30%); a group nobody has any option of is never asked
		const start = contenders([water, untagged, fruity, choco].map((p) => scoreProduct(p, { ...initialState(1), kind: 'DRINK' }, catalog)));
		assert.ok(groupInfo(flavor, start, catalog) > 0);
		const onlyNone = buildCatalog([temp, flavor], [water, { ...water, id: 999, noneGroupIds: [flavor.id] }]);
		const noneList = contenders(onlyNone.products.map((p) => scoreProduct(p, { ...initialState(1), kind: 'DRINK' }, onlyNone)));
		assert.equal(groupInfo(flavor, noneList, onlyNone), 0, 'no option to match: not asked (and no division by zero)');
	});

	test('multi-choice questions are measured like the others: importance decides («گرم یا سرد؟» before «کدوم طعم؟»)', () => {
		const flavors = ['قهوه‌ای', 'شکلاتی', 'قهوه‌ای', 'میوه‌ای'];
		const items = Array.from({ length: 12 }, (_, i) => product(`d${i}`, 'DRINK', 1 + (i % 3), [o(temp, i < 6 ? 'گرم' : 'سرد'), o(flavor, flavors[i % 4])]));
		const catalog = buildCatalog([temp, flavor], items);
		const s = chooseKind(initialState(5), catalog, 'DRINK');
		assert.equal(s.current, temp.id, 'importance 5 and an even split beat importance 3');
		const list = contenders(items.map((p) => scoreProduct(p, s, catalog)));
		// flavor: answers keep 6, 3 or 3 of 12 → expected share 4.5 / 12 → 0.625; temperature: 0.5
		assert.ok(Math.abs(groupInfo(flavor, list, catalog) - 0.625) < 1e-9);
		assert.ok(Math.abs(groupInfo(temp, list, catalog) - 0.5) < 1e-9);
	});

	test('only answers some product of the round has are offered', () => {
		const items = [
			product('اسپرسو', 'DRINK', 1, [o(temp, 'گرم'), o(flavor, 'قهوه‌ای')]),
			product('هات چاکلت', 'DRINK', 1, [o(temp, 'گرم'), o(flavor, 'شکلاتی')]),
			product('لیموناد', 'DRINK', 2, [o(temp, 'سرد'), o(flavor, 'میوه‌ای')]),
			product('آیس لاته', 'DRINK', 2, [o(temp, 'سرد'), o(flavor, 'قهوه‌ای')]),
		];
		const catalog = buildCatalog([temp, flavor], items);
		const hot = { ...initialState(1), kind: 'DRINK' as const, phase: 'question' as const, current: flavor.id, answers: { [temp.id]: [o(temp, 'گرم')] } };
		// taste answers never shrink the pool: every flavor of the drinks is still offered
		assert.deepEqual(answerOptions(hot, catalog).map((x) => x.label), ['شکلاتی', 'میوه‌ای', 'قهوه‌ای']);
		const round2 = { ...hot, round: 2 as const, pool2: [items[0].id, items[1].id] };
		assert.deepEqual(answerOptions(round2, catalog).map((x) => x.label), ['شکلاتی', 'قهوه‌ای'], 'round 2: only its own pool');
		assert.deepEqual(answerOptions({ ...hot, phase: 'results' }, catalog), []);
	});

	test('an untagged product is never suggested next to products that really match', () => {
		const tagged = [
			product('a', 'DRINK', 1, [o(temp, 'سرد'), o(taste, 'تلخ')]),
			product('b', 'DRINK', 2, [o(temp, 'سرد'), o(taste, 'تلخ')]),
		];
		const bare = product('بی‌برچسب', 'DRINK', 3, []);
		const catalog = buildCatalog([temp, taste], [...tagged, bare]);
		// score of a and b: (5·1 + 3·0) / 8 = 0.625; the bare one 0.5 is inside the 0.25 window
		const state: RecState = { ...initialState(3), kind: 'DRINK', answers: { [temp.id]: [o(temp, 'سرد')], [taste.id]: [o(taste, 'شیرین')] } };
		const s = showNow({ ...state, phase: 'question', current: null }, catalog);
		assert.ok(!names(catalog, s).includes('بی‌برچسب'), JSON.stringify(names(catalog, s)));
		assert.equal(names(catalog, s).length, 2);
	});

	test('a group with low tagging coverage among the contenders is not asked', () => {
		const items = Array.from({ length: 10 }, (_, i) =>
			product(`x${i}`, 'DRINK', 1, i < 2 ? [o(flavor, 'شکلاتی'), o(temp, i % 2 ? 'گرم' : 'سرد')] : [o(temp, i % 2 ? 'گرم' : 'سرد')]),
		);
		const catalog = buildCatalog([temp, flavor], items);
		const list = contenders(items.map((p) => scoreProduct(p, { ...initialState(1), kind: 'DRINK' }, catalog)));
		assert.equal(groupInfo(flavor, list, catalog), 0, 'only 2 of 10 tagged (< 30%)');
		assert.ok(groupInfo(temp, list, catalog) > CONFIG.MIN_INFO);
	});

	test('restrictions: every chosen option is required, unknown is removed, and an empty pool is said plainly', () => {
		const items = [
			product('سالاد', 'FOOD', 1, [o(diet, 'گیاهخوار'), o(diet, 'بدون آجیل'), o(weight, 'سبک')]),
			product('پاستا', 'FOOD', 1, [o(diet, 'گیاهخوار'), o(weight, 'سنگین')]),
			product('برگر', 'FOOD', 2, [o(weight, 'سنگین')]),
		];
		const catalog = buildCatalog(groups, items);
		const both = chooseKind(initialState(1), catalog, 'FOOD', [o(diet, 'گیاهخوار'), o(diet, 'بدون آجیل')]);
		assert.equal(both.phase, 'results', 'one product left: shown at once');
		assert.deepEqual(names(catalog, both), ['سالاد']);
		const nothing = chooseKind(initialState(1), catalog, 'DRINK', [o(diet, 'گیاهخوار')]);
		assert.equal(nothing.phase, 'empty');
		assert.equal(nothing.result, null);
		const ignoredSoft = chooseKind(initialState(1), catalog, 'FOOD', [o(weight, 'سبک')]);
		assert.deepEqual(ignoredSoft.constraints, [], 'only restriction options are accepted as restrictions');
	});

	test('«فرقی نداره» replaces the question and is never asked again; three in a row offer the result', () => {
		// twelve drinks spread over five taste groups, so there is always something left to ask
		const flavours = ['شکلاتی', 'میوه‌ای', 'قهوه‌ای'];
		const items = Array.from({ length: 12 }, (_, i) =>
			product(`n${i}`, 'DRINK', 1 + (i % 3), [
				o(temp, i % 2 ? 'گرم' : 'سرد'),
				o(caffeine, (i >> 1) % 2 ? 'با کافئین' : 'بدون کافئین'),
				o(taste, ['شیرین', 'کم‌شیرین', 'تلخ'][i % 3]),
				o(weight, (i >> 2) % 2 ? 'سبک' : 'سنگین'),
				o(flavor, flavours[(i >> 1) % 3]),
			]),
		);
		const catalog = buildCatalog([temp, caffeine, taste, weight, flavor], items);
		let s = chooseKind(initialState(5), catalog, 'DRINK');
		const first = s.current;
		s = skip(s, catalog);
		assert.equal(s.phase, 'question');
		assert.notEqual(s.current, first);
		assert.ok(s.skipped.includes(first!));
		assert.equal(s.answered, 0, 'a skip is not a real answer');
		assert.equal(s.screens, 1, 'but it is a screen');
		s = skip(s, catalog);
		assert.equal(s.phase, 'question', 'two in a row: still asking');
		s = skip(s, catalog);
		assert.equal(s.phase, 'skipPrompt', 'after three in a row: «با همین نتیجه بدم؟»');
		const more1 = keepAsking(s, catalog);
		assert.equal(more1.phase, 'question');
		assert.equal(more1.skipsInRow, 0);
		assert.ok(![...more1.skipped].includes(more1.current!), 'a skipped group never comes back');
		const shown = showNow(s, catalog);
		assert.equal(shown.phase, 'results');
		assert.equal(shown.result!.note, 'noTaste', 'no taste given: a varied pick');
		assert.equal(new Set(shown.result!.suggestions.map((x) => catalog.byId.get(x.productId)!.categoryId)).size, 3, 'varied');
	});

	test('right after «فرقی نداره» the most important useful question comes next', () => {
		const flavours = ['شکلاتی', 'میوه‌ای', 'قهوه‌ای'];
		const items = Array.from({ length: 12 }, (_, i) =>
			product(`m${i}`, 'DRINK', 1, [
				o(temp, i % 2 ? 'گرم' : 'سرد'),
				o(caffeine, (i >> 1) % 2 ? 'با کافئین' : 'بدون کافئین'),
				o(taste, ['شیرین', 'کم‌شیرین', 'تلخ'][i % 3]),
				o(flavor, flavours[(i >> 1) % 3]),
			]),
		);
		const catalog = buildCatalog([temp, caffeine, taste, flavor], items);
		let s = chooseKind(initialState(3), catalog, 'DRINK');
		for (let i = 0; i < 2 && s.phase === 'question'; i++) {
			s = skip(s, catalog);
			const list = contenders(catalog.products.map((p) => scoreProduct(p, s, catalog)));
			const useful = catalog.groups.filter(
				(g) => g.strictness === 'SOFT' && !s.skipped.includes(g.id) && !(g.id in s.answers) && groupInfo(g, list, catalog) >= CONFIG.MIN_INFO,
			);
			assert.equal(catalog.groupById.get(s.current!)!.importance, Math.max(...useful.map((g) => g.importance)));
		}
	});

	test('scales: the neighbour of the answer counts half; a product made for the answer comes before an all-rounder', () => {
		const sweetness = { ...taste, ordered: true };
		const items = [
			product('ش', 'DRINK', 1, [o(taste, 'شیرین')]),
			product('ک', 'DRINK', 1, [o(taste, 'کم‌شیرین')]),
			product('ت', 'DRINK', 1, [o(taste, 'تلخ')]),
		];
		const wantSweet = (): RecState => ({ ...initialState(1), kind: 'DRINK', answers: { [taste.id]: [o(taste, 'شیرین')] } });
		const scale = buildCatalog([sweetness], items);
		assert.deepEqual(items.map((p) => scoreProduct(p, wantSweet(), scale).score), [1, CONFIG.NEIGHBOR_CREDIT, 0]);
		assert.deepEqual(items.map((p) => scoreProduct(p, wantSweet(), scale).matches), [1, 0, 0], 'a neighbour is not a real match');
		const plain = buildCatalog([taste], items);
		assert.equal(scoreProduct(items[1], wantSweet(), plain).score, 0, 'not a scale: a miss');
		const twoWay = buildCatalog([{ ...temp, ordered: true }], [product('گ', 'DRINK', 1, [o(temp, 'گرم')])]);
		const wantCold: RecState = { ...initialState(1), kind: 'DRINK', answers: { [temp.id]: [o(temp, 'سرد')] } };
		assert.equal(scoreProduct(twoWay.products[0], wantCold, twoWay).score, 0, 'two options: the other end, not a neighbour');

		const allRounder = product('طعم‌دار', 'DRINK', 2, [o(flavor, 'شکلاتی'), o(flavor, 'میوه‌ای'), o(flavor, 'قهوه‌ای')]);
		const made = product('شکلاتی', 'DRINK', 3, [o(flavor, 'شکلاتی')]);
		const flav = buildCatalog([flavor], [allRounder, made]);
		const wantChoc: RecState = { ...initialState(1), kind: 'DRINK', phase: 'question', answers: { [flavor.id]: [o(flavor, 'شکلاتی')] } };
		assert.equal(scoreProduct(made, wantChoc, flav).score, 1);
		assert.ok(Math.abs(scoreProduct(allRounder, wantChoc, flav).score - (1 - CONFIG.SPECIFICITY_PENALTY * (2 / 3))) < 1e-9);
		assert.equal(scoreProduct(allRounder, wantChoc, flav).matches, 1, 'still a real match');
		assert.deepEqual(names(flav, showNow(wantChoc, flav)), ['شکلاتی', 'طعم‌دار'], 'both suggested, the specific one first');
	});

	test('five «فرقی نداره» in a row end with a result, never a crash or an endless loop', () => {
		const catalog = buildCatalog(groups, drinks);
		let s = chooseKind(initialState(9), catalog, 'ANY');
		for (let i = 0; i < 5 && s.phase !== 'results'; i++) {
			if (s.phase === 'skipPrompt') s = keepAsking(s, catalog);
			if (s.phase === 'question') s = skip(s, catalog);
		}
		if (s.phase === 'skipPrompt') s = showNow(s, catalog);
		assert.equal(s.phase, 'results');
		assert.ok(s.result!.suggestions.length >= 1 && s.result!.suggestions.length <= 3);
	});

	test('round 1 ends after four real answers', () => {
		const g = [1, 2, 3, 4, 5, 6].map((i) => group(100 + i, `g${i}`, ['a', 'b'], { importance: 3 }));
		const items = Array.from({ length: 64 }, (_, i) => product(`p${i}`, 'FOOD', i % 3, g.map((x, k) => x.options[(i >> k) & 1].id)));
		const catalog = buildCatalog(g, items);
		let s = chooseKind(initialState(11), catalog, 'FOOD');
		let answers = 0;
		while (s.phase === 'question') {
			s = answer(s, catalog, [catalog.groupById.get(s.current!)!.options[0].id]);
			answers++;
		}
		assert.equal(s.phase, 'results');
		assert.equal(answers, CONFIG.TARGET_ANSWERS, 'enough products to keep asking, but four real answers end the round');
		assert.ok(s.result!.suggestions.length >= 1 && s.result!.suggestions.length <= 3);
	});

	test('variety: one per category first, relaxed to fill three when only two categories exist', () => {
		const same = [o(temp, 'سرد'), o(taste, 'شیرین')];
		const items = [product('A1', 'DRINK', 1, same), product('A2', 'DRINK', 1, same), product('A3', 'DRINK', 1, same), product('B1', 'DRINK', 2, same)];
		const catalog = buildCatalog([temp, taste], items);
		const state: RecState = { ...initialState(4), kind: 'DRINK', phase: 'question', answers: { [temp.id]: [o(temp, 'سرد')] } };
		const s = showNow(state, catalog);
		const cats = s.result!.suggestions.map((x) => catalog.byId.get(x.productId)!.categoryId);
		assert.equal(cats.length, 3);
		assert.equal(new Set(cats).size, 2, 'both categories represented');
		assert.equal(cats.filter((c) => c === 2).length, 1, 'the only B is in');
	});

	test('a menu of three products gives the result without a single question', () => {
		const catalog = buildCatalog(exampleGroups, drinks.slice(0, 3));
		const s = chooseKind(initialState(1), catalog, 'DRINK');
		assert.equal(s.phase, 'results');
		assert.equal(s.result!.suggestions.length, 3);
	});

	test('round 2 never repeats a suggestion; «یه چیز دیگه» walks the rest and ends with «همه را دیدی»', () => {
		const catalog = buildCatalog(exampleGroups, drinks);
		// «نشونم بده» before any answer, then «یه چیز دیگه» once: six drinks seen, four left for round 2 to ask about
		let s = showNow(chooseKind(initialState(2), catalog, 'DRINK'), catalog);
		assert.equal(s.result!.suggestions.length, 3);
		s = more(s, catalog);
		const first = [...s.shown];
		assert.equal(first.length, 6);
		assert.ok(canStartRound2(s, catalog));
		s = startRound2(s, catalog);
		assert.equal(s.phase, 'question', 'round 2 is only offered when it asks something');
		while (s.phase === 'question') s = answer(s, catalog, [catalog.groupById.get(s.current!)!.options[0].id]);
		if (s.phase === 'moreOffer') s = more(s, catalog);
		const second = s.result!.suggestions.map((x) => x.productId);
		assert.ok(second.every((id) => !first.includes(id)), 'no repeats');
		const seen = new Set([...first, ...second]);
		for (let i = 0; i < 10 && !s.result!.exhausted; i++) {
			s = more(s, catalog);
			for (const x of s.result!.suggestions) {
				assert.ok(!seen.has(x.productId), 'never twice');
				seen.add(x.productId);
			}
		}
		assert.ok(s.result!.exhausted);
		assert.equal(seen.size, drinks.length, 'every drink was offered once');
	});

	test('round 2 is offered from the first «یه چیز دیگه» on (not with the first result) and stays after the next ones', () => {
		const many = [...drinks, ...drinks.map((p) => ({ ...p, id: p.id + 1000, name: `${p.name} ۲` }))];
		const catalog = buildCatalog(exampleGroups, many);
		const s0 = showNow(chooseKind(initialState(2), catalog, 'DRINK'), catalog);
		assert.equal(canStartRound2(s0, catalog), false, 'not with the first result');
		assert.equal(startRound2(s0, catalog), s0, 'nothing happens');
		const s1 = more(s0, catalog);
		assert.equal(s1.round, 1, '«یه چیز دیگه» stays in round 1');
		assert.ok(canStartRound2(s1, catalog), 'offered after the first «یه چیز دیگه»');
		const s2 = more(s1, catalog);
		assert.ok(canStartRound2(s2, catalog), 'still offered after the next one');
		const r2 = startRound2(s2, catalog);
		assert.equal(r2.phase, 'question');
		assert.equal(r2.round, 2);
		let done = r2;
		while (done.phase === 'question') done = answer(done, catalog, [catalog.groupById.get(done.current!)!.options[0].id]);
		assert.equal(done.phase, 'results');
		assert.equal(canStartRound2(more(done, catalog), catalog), false, 'one round 2 only');
	});

	test('«قبلی» is just the previous state: same seed, same questions, same result', () => {
		const catalog = buildCatalog(exampleGroups, drinks);
		const a = chooseKind(initialState(42), catalog, 'DRINK');
		const b = answer(a, catalog, [o(temp, 'گرم')]);
		const again = answer(a, catalog, [o(temp, 'گرم')]);
		assert.deepEqual(b, again, 'deterministic');
		assert.equal(a.current, temp.id, 'the earlier state is untouched');
		assert.equal(progress(a), 0);
		assert.ok(progress(b) > 0 && progress(b) <= 1);
	});

	test('kind-specific question text and the kinds offered on the first screen', () => {
		const t = { ...temp, questionByKind: { DESSERT: 'دسر گرم یا سرد؟' } };
		assert.equal(questionText(t, 'DESSERT'), 'دسر گرم یا سرد؟');
		assert.equal(questionText(t, 'DRINK'), temp.question);
		assert.equal(questionText(t, 'ANY'), temp.question);
		assert.deepEqual(availableKinds(buildCatalog(groups, drinks)), ['DRINK']);
	});

	test('invariants on many random menus and customers', () => {
		const kinds: Kind[] = ['DRINK', 'FOOD', 'DESSERT'];
		let seed = 12345;
		const rand = () => ((seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32);
		for (let round = 0; round < 300; round++) {
			const gs = [temp, caffeine, taste, weight, diet, flavor];
			const items = Array.from({ length: 1 + Math.floor(rand() * 40) }, (_, i) => {
				const kind = kinds[Math.floor(rand() * 3)];
				const opts = gs.flatMap((g) => (rand() < 0.75 ? g.options.filter(() => rand() < 0.45).map((x) => x.id) : []));
				return product(`r${i}`, kind, Math.floor(rand() * 4), opts);
			});
			const catalog = buildCatalog(gs, items);
			const kindChoice = rand() < 0.3 ? 'ANY' : kinds[Math.floor(rand() * 3)];
			const constraints = rand() < 0.3 ? [o(diet, 'گیاهخوار')] : [];
			let s = chooseKind(initialState(Math.floor(rand() * 1e9)), catalog, kindChoice, constraints);
			const asked = new Set<number>();
			for (let step = 0; step < 30 && (s.phase === 'question' || s.phase === 'skipPrompt'); step++) {
				if (s.phase === 'skipPrompt') {
					s = rand() < 0.5 ? keepAsking(s, catalog) : showNow(s, catalog);
					continue;
				}
				const g = catalog.groupById.get(s.current!)!;
				assert.equal(g.strictness, 'SOFT', 'restrictions are never asked');
				assert.ok(!asked.has(g.id), 'no group twice');
				asked.add(g.id);
				if (kindChoice !== 'ANY') assert.ok(g.kinds.includes(kindChoice), 'never a question that makes no sense for the kind');
				s = rand() < 0.25 ? skip(s, catalog) : answer(s, catalog, [g.options[Math.floor(rand() * g.options.length)].id]);
			}
			assert.ok(['results', 'empty'].includes(s.phase), `ended in ${s.phase}`);
			if (s.phase === 'results') {
				const ids = s.result!.suggestions.map((x) => x.productId);
				assert.ok(ids.length >= 1 && ids.length <= CONFIG.TOP_N, 'one to three suggestions');
				assert.equal(new Set(ids).size, ids.length);
				const pool = new Set(
					items
						.filter((p) => (kindChoice === 'ANY' || p.kind === kindChoice) && constraints.every((c) => p.optionIds.includes(c)))
						.map((p) => p.id),
				);
				assert.ok(ids.every((id) => pool.has(id)), 'only from the pool (kind + restrictions)');
				assert.ok(s.screens <= CONFIG.MAX_SCREENS);
				assert.equal(canStartRound2(s, catalog), false, 'never with the first result');
				const afterMore = more(s, catalog);
				if (canStartRound2(afterMore, catalog)) {
					let r2 = startRound2(afterMore, catalog);
					assert.equal(r2.phase, 'question', 'an offered round 2 starts with a question');
					for (let step = 0; step < 30 && (r2.phase === 'question' || r2.phase === 'skipPrompt'); step++) {
						r2 = r2.phase === 'skipPrompt' ? showNow(r2, catalog) : answer(r2, catalog, [catalog.groupById.get(r2.current!)!.options[0].id]);
					}
					if (r2.phase === 'moreOffer') r2 = more(r2, catalog);
					assert.equal(r2.phase, 'results');
					const ids2 = r2.result!.suggestions.map((x) => x.productId);
					assert.ok(ids2.length <= CONFIG.TOP_N && ids2.every((id) => !afterMore.shown.includes(id) && pool.has(id)));
				}
			}
		}
	});

	test('round 2 is not offered when nothing is left close enough to ask about', () => {
		// three drinks shown, the other three far below: round 2 would have an empty pool
		const items = [
			product('a', 'DRINK', 1, [o(temp, 'سرد'), o(taste, 'شیرین')]),
			product('b', 'DRINK', 2, [o(temp, 'سرد'), o(taste, 'شیرین')]),
			product('c', 'DRINK', 3, [o(temp, 'سرد'), o(taste, 'شیرین')]),
			product('x', 'DRINK', 4, [o(temp, 'گرم'), o(taste, 'تلخ')]),
			product('y', 'DRINK', 4, [o(temp, 'گرم'), o(taste, 'تلخ')]),
			product('z', 'DRINK', 4, [o(temp, 'گرم'), o(taste, 'تلخ')]),
		];
		const catalog = buildCatalog([temp, taste], items);
		let s = chooseKind(initialState(3), catalog, 'DRINK');
		while (s.phase === 'question') s = answer(s, catalog, [catalog.groupById.get(s.current!)!.options.find((x) => ['سرد', 'شیرین'].includes(x.label))!.id]);
		assert.deepEqual(names(catalog, s).sort(), ['a', 'b', 'c']);
		assert.equal(canStartRound2(s, catalog), false);
		assert.equal(startRound2(s, catalog), s, 'nothing happens');
		assert.deepEqual(names(catalog, more(s, catalog)).sort(), ['x', 'y', 'z'], '«یه چیز دیگه» still shows the rest');
		assert.equal(canStartRound2(more(s, catalog), catalog), false, 'everything seen: nothing left to ask about');
	});

	test('nextQuestion is null when nothing separates the contenders', () => {
		const same = [product('a', 'DRINK', 1, [o(temp, 'گرم')]), product('b', 'DRINK', 1, [o(temp, 'گرم')]), product('c', 'DRINK', 1, [o(temp, 'گرم')]), product('d', 'DRINK', 1, [o(temp, 'گرم')])];
		const catalog = buildCatalog([temp], same);
		assert.equal(nextQuestion({ ...initialState(1), kind: 'DRINK', phase: 'question' }, catalog), null);
		const s = chooseKind(initialState(1), catalog, 'DRINK');
		assert.equal(s.phase, 'results', 'four identical drinks: straight to a result');
	});
});
