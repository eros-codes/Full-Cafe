// «انتخاب برای من» — the recommendation engine. Pure functions only (no DOM, no network), so the whole
// behaviour is covered by unit tests (test/recommender-engine.test.ts) and the simulation script.
//
// How it works (the spec, plus three corrections agreed with the project owner):
//  1. Pool: the products of the chosen kind (or every kind) that have every restriction the customer chose.
//     Only restrictions remove products; taste answers only change the score.
//  2. Score: average of the answered taste groups, weighted by importance. Per group a product is a match (1),
//     a miss (0), unknown — not tagged (0.5), or not applicable — the group is not for its kind (left out).   ← fix
//     A group the admin set to «هیچ‌کدام» for the product (e.g. water has no flavor) is a miss, not unknown.
//  3. Contenders: the products whose score is still within SCORE_WINDOW of the best one, i.e. the ones that
//     could still appear in the result. The next question and the "≤ 3 left" stop are computed on them,
//     not on the whole pool (taste answers never shrink the pool, so the spec's stop rule never fired).      ← fix
//  4. A product is only suggested with at least one real match (an untagged product scores 0.5 forever
//     and would otherwise be suggested with an empty reason).                                                ← fix
// And three refinements, measured with the simulation on the real menu before going in:
//  5. Scales («ordered» groups: شیرین ← کم‌شیرین ← تلخ): the neighbour of the answer counts NEIGHBOR_CREDIT.
//  6. A product that fits many answers of a group («لاته طعم‌دار»: seven flavours) counts a little less than
//     one made for that answer (SPECIFICITY_PENALTY), so «کارامل ماکیاتو» comes before it for «کاراملی».
//  7. Right after «فرقی نداره» the most important useful question comes next (not the one that splits the
//     menu best), and the "show me now?" prompt only comes after MAX_SKIPS_IN_ROW of them.

export type Kind = 'DRINK' | 'FOOD' | 'DESSERT';
export type KindChoice = Kind | 'ANY';

export interface EngineGroup {
	id: number;
	name: string;
	question: string;
	questionByKind: Partial<Record<Kind, string>> | null;
	multi: boolean;
	/** The options are a scale, in this order: the neighbour of an answer counts NEIGHBOR_CREDIT. */
	ordered?: boolean;
	strictness: 'SOFT' | 'HARD';
	importance: number;
	kinds: Kind[];
	options: { id: number; label: string }[];
}

export interface EngineProduct {
	id: number;
	categoryId: number;
	kind: Kind;
	optionIds: number[];
	/** Groups set to «هیچ‌کدام» (none of the options): a miss for every answer of that group, not unknown. */
	noneGroupIds?: number[];
}

/** Tunable constants (spec 7-1). */
export const CONFIG = {
	/** Real answers that end round 1. */
	TARGET_ANSWERS: 4,
	/** Screens (answers + "doesn't matter") in one round. */
	MAX_SCREENS: 8,
	/** After this many "doesn't matter" in a row: offer to show the result. */
	MAX_SKIPS_IN_ROW: 3,
	/**
	 * Scales: what the neighbour of the answer counts (an exact match counts 1, untagged 0.5). Tuned on the real
	 * menu: 0.5 let «کم‌شیرین» beat «شیرین» too often for a customer who said «شیرین»; 0.35 keeps the answer first.
	 */
	NEIGHBOR_CREDIT: 0.35,
	/** A match counts 1 − this × (1 − 1/k) for a product with k options of the group (1 for k = 1). */
	SPECIFICITY_PENALTY: 0.2,
	/** A question that separates the contenders less than this is never asked. */
	MIN_INFO: 0.05,
	/** Share of the contenders a group must have tagged to be asked. */
	MIN_COVERAGE: 0.3,
	/** Most suggestions at once. */
	TOP_N: 3,
	/** The 2nd and 3rd suggestion (and every contender) must be within this of the best score. */
	SCORE_WINDOW: 0.25,
	/** Real answers in round 2. */
	ROUND2_ANSWERS: 3,
	/** Round 2 looks at the products not shown yet within this of the last suggestions shown. */
	ROUND2_WINDOW: 0.15,
} as const;

const EPS = 1e-9;
/** Score before any taste answer: every product is equal. */
const NEUTRAL = 0.5;

export type Phase = 'kind' | 'question' | 'skipPrompt' | 'results' | 'moreOffer' | 'empty';

export type ResultNote =
	/** suggestions match the answers */
	| 'none'
	/** nothing really matches: these are only the closest («این‌ها نزدیک‌ترین‌ها به سلیقه‌ات هستند») */
	| 'closest'
	/** no taste answer at all: a varied pick from the menu */
	| 'noTaste';

export interface Suggestion {
	productId: number;
	score: number;
	/** Labels of the options that matched the answers, most important first (at most 3). */
	reasons: string[];
}

export interface Result {
	round: 1 | 2;
	suggestions: Suggestion[];
	note: ResultNote;
	/** "Show me something else" found nothing new: every suitable option has been seen. */
	exhausted: boolean;
}

export interface RecState {
	phase: Phase;
	/** null until the first screen (the kind question) is answered. */
	kind: KindChoice | null;
	/** Chosen restriction options (HARD groups). */
	constraints: number[];
	/** Taste answers of both rounds: group id → chosen option ids. */
	answers: Record<number, number[]>;
	/** Groups answered with "doesn't matter" (never asked again). */
	skipped: number[];
	round: 1 | 2;
	/** Counters of the current round. */
	answered: number;
	screens: number;
	skipsInRow: number;
	/** The group being asked (phase 'question'). */
	current: number | null;
	/** Every product already suggested (never suggested twice). */
	shown: number[];
	/** How many times «یه چیز دیگه نشونم بده» was used (round 2 is only offered after the first). */
	mores: number;
	/** Round 2 candidates, fixed when round 2 starts. */
	pool2: number[] | null;
	result: Result | null;
	/** Ties are broken by this seed, so going back and forth never reshuffles. */
	seed: number;
}

export interface Catalog<P extends EngineProduct = EngineProduct> {
	groups: EngineGroup[];
	products: P[];
	byId: Map<number, P>;
	groupById: Map<number, EngineGroup>;
	/** Option id → label. */
	labels: Map<number, string>;
	/** Product id → its options as a set. */
	optionSets: Map<number, Set<number>>;
	/** Product id → the groups it has none of the options of (see EngineProduct.noneGroupIds). */
	noneSets: Map<number, Set<number>>;
	/** Display order of the groups (tie-break between equally useful questions). */
	order: Map<number, number>;
}

export function buildCatalog<P extends EngineProduct>(groups: EngineGroup[], products: P[]): Catalog<P> {
	const usable = groups.filter((g) => g.options.length > 0);
	const labels = new Map<number, string>();
	usable.forEach((g) => g.options.forEach((o) => labels.set(o.id, o.label)));
	return {
		groups: usable,
		products,
		byId: new Map(products.map((p) => [p.id, p])),
		groupById: new Map(usable.map((g) => [g.id, g])),
		labels,
		optionSets: new Map(products.map((p) => [p.id, new Set(p.optionIds)])),
		noneSets: new Map(products.map((p) => [p.id, new Set(p.noneGroupIds ?? [])])),
		order: new Map(usable.map((g, i) => [g.id, i])),
	};
}

export function initialState(seed: number): RecState {
	return {
		phase: 'kind',
		kind: null,
		constraints: [],
		answers: {},
		skipped: [],
		round: 1,
		answered: 0,
		screens: 0,
		skipsInRow: 0,
		current: null,
		shown: [],
		mores: 0,
		pool2: null,
		result: null,
		seed: seed >>> 0,
	};
}

// ─── helpers ─────────────────────────────────────────────────────────────────

const relevant = (group: EngineGroup, product: EngineProduct) => group.kinds.includes(product.kind);

/** Deterministic tie-break per (seed, product). */
function tieRank(seed: number, id: number): number {
	let h = (seed ^ Math.imul(id, 0x9e3779b1)) >>> 0;
	h = Math.imul(h ^ (h >>> 16), 0x85ebca6b) >>> 0;
	h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
	return (h ^ (h >>> 16)) >>> 0;
}

/** The kinds present in the menu (the kind screen only offers these). */
export function availableKinds(catalog: Catalog): Kind[] {
	const present = new Set(catalog.products.map((p) => p.kind));
	return (['DRINK', 'FOOD', 'DESSERT'] as Kind[]).filter((k) => present.has(k));
}

/** Restriction groups (shown behind the optional link on the first screen). */
export function hardGroups(catalog: Catalog): EngineGroup[] {
	return catalog.groups.filter((g) => g.strictness === 'HARD');
}

/** The question text for the chosen kind (a kind-specific text if the admin wrote one). */
export function questionText(group: EngineGroup, kind: KindChoice | null): string {
	return (kind && kind !== 'ANY' && group.questionByKind?.[kind]) || group.question;
}

/** Round 1 pool: kind + restrictions (a restriction only applies where its group makes sense). */
export function basePool<P extends EngineProduct>(state: RecState, catalog: Catalog<P>): P[] {
	if (state.kind === null) return [];
	const constraintGroups = new Map<number, EngineGroup>();
	for (const optionId of state.constraints) {
		const group = catalog.groups.find((g) => g.options.some((o) => o.id === optionId));
		if (group) constraintGroups.set(optionId, group);
	}
	return catalog.products.filter((p) => {
		if (state.kind !== 'ANY' && p.kind !== state.kind) return false;
		const options = catalog.optionSets.get(p.id)!;
		return state.constraints.every((optionId) => {
			const group = constraintGroups.get(optionId);
			if (!group || !relevant(group, p)) return true;
			// ادعای مثبت: محصول باید خود این گزینه را داشته باشد؛ «نامشخص» حذف می‌شود
			return options.has(optionId);
		});
	});
}

/** The products this round chooses from. */
function roundPool<P extends EngineProduct>(state: RecState, catalog: Catalog<P>): P[] {
	if (state.round === 2 && state.pool2) return state.pool2.map((id) => catalog.byId.get(id)!).filter(Boolean);
	return basePool(state, catalog);
}

export interface Scored<P extends EngineProduct = EngineProduct> {
	product: P;
	score: number;
	/** Answered groups this product matches. */
	matches: number;
}

/** On a scale of three or more options: one of the product's options is right next to an answer. */
function isNeighbour(group: EngineGroup, has: EngineGroup['options'], chosen: number[]): boolean {
	if (!group.ordered || group.options.length < 3) return false;
	const index = new Map(group.options.map((o, i) => [o.id, i]));
	return has.some((o) => chosen.some((c) => index.has(c) && Math.abs(index.get(o.id)! - index.get(c)!) === 1));
}

/** Score of one product against every taste answer so far (both rounds). */
export function scoreProduct<P extends EngineProduct>(product: P, state: RecState, catalog: Catalog<P>): Scored<P> {
	const options = catalog.optionSets.get(product.id)!;
	let num = 0;
	let den = 0;
	let matches = 0;
	for (const [groupIdText, chosen] of Object.entries(state.answers)) {
		const group = catalog.groupById.get(Number(groupIdText));
		if (!group || !chosen.length || !relevant(group, product)) continue; // not applicable: left out
		const weight = group.importance / 5;
		const has = group.options.filter((o) => options.has(o.id));
		let m: number;
		if (!has.length) m = catalog.noneSets.get(product.id)!.has(group.id) ? 0 : 0.5; // «هیچ‌کدام» = miss, untagged = unknown
		else if (has.some((o) => chosen.includes(o.id))) {
			// made for this answer: 1; fits several answers of the group: a little less
			m = 1 - CONFIG.SPECIFICITY_PENALTY * (1 - 1 / has.length);
			matches++;
		} else if (isNeighbour(group, has, chosen)) m = CONFIG.NEIGHBOR_CREDIT;
		else m = 0;
		num += weight * m;
		den += weight;
	}
	return { product, score: den ? num / den : NEUTRAL, matches };
}

/** Products that could still be suggested: within SCORE_WINDOW of the best score. */
export function contenders<P extends EngineProduct>(scored: Scored<P>[]): Scored<P>[] {
	if (!scored.length) return [];
	const top = Math.max(...scored.map((s) => s.score));
	return scored.filter((s) => s.score >= top - CONFIG.SCORE_WINDOW - EPS);
}

/**
 * How well a group would separate the contenders (spec 7-3, computed on the contenders it applies to,
 * times their share of all contenders). 0 = useless.
 */
export function groupInfo(group: EngineGroup, contenderList: Scored[], catalog: Catalog): number {
	if (!contenderList.length) return 0;
	const applies = contenderList.filter((s) => relevant(group, s.product));
	if (!applies.length) return 0;
	const optionIds = group.options.map((o) => o.id);
	const has = (s: Scored, optionId: number) => catalog.optionSets.get(s.product.id)!.has(optionId);
	// known: tagged in this group, or set to «هیچ‌کدام» (left out by every answer)
	const known = applies.filter((s) => optionIds.some((o) => has(s, o)) || catalog.noneSets.get(s.product.id)!.has(group.id));
	const unknown = applies.length - known.length;
	if (!known.length || known.length < CONFIG.MIN_COVERAGE * applies.length) return 0;
	const counts = optionIds.map((o) => known.filter((s) => has(s, o)).length);
	const total = counts.reduce((a, b) => a + b, 0);
	if (!total) return 0; // no contender has any option of the group: no answer could match
	// Expected share left after the answer (fewer is better): answer o is as likely as its products are many,
	// and leaves its products plus the untagged ones. Weights are normalised, since a product may carry two
	// options of one group (a coffee served hot and cold). Multi-choice groups use the same measure: most
	// people pick one answer there too, and one scale for both keeps «اهمیت» deciding between them (with a
	// separate, larger measure «کدوم طعم؟» was asked before «گرم یا سرد؟» despite its lower importance).
	const expected = counts.reduce((sum, c) => sum + (c / total) * (c + unknown), 0);
	const info = 1 - expected / applies.length;
	return Math.max(0, info) * (applies.length / contenderList.length);
}

const roundTarget = (state: RecState) => (state.round === 1 ? CONFIG.TARGET_ANSWERS : CONFIG.ROUND2_ANSWERS);

/**
 * The next question: the most useful taste group not asked yet, or null when none is useful any more.
 * Right after «فرقی نداره» it is the most important of the useful ones instead: the customer passed on what
 * splits the menu best, so ask what customers care about most (e.g. caffeine before a minor detail).
 */
export function nextQuestion(state: RecState, catalog: Catalog): EngineGroup | null {
	const pool = roundPool(state, catalog);
	const contenderList = contenders(pool.map((p) => scoreProduct(p, state, catalog)));
	const afterSkip = state.skipsInRow > 0;
	let best: { group: EngineGroup; value: number } | null = null;
	for (const group of catalog.groups) {
		if (group.strictness !== 'SOFT') continue; // restrictions are never asked by the algorithm
		if (group.id in state.answers || state.skipped.includes(group.id)) continue;
		const info = groupInfo(group, contenderList, catalog);
		if (info < CONFIG.MIN_INFO) continue;
		const value = info * (group.importance / 5);
		const better =
			!best ||
			(afterSkip
				? group.importance > best.group.importance || (group.importance === best.group.importance && value > best.value + EPS)
				: value > best.value + EPS);
		if (better) best = { group, value };
	}
	return best?.group ?? null;
}

function roundOver(state: RecState, catalog: Catalog): boolean {
	if (state.answered >= roundTarget(state) || state.screens >= CONFIG.MAX_SCREENS) return true;
	const pool = roundPool(state, catalog);
	if (contenders(pool.map((p) => scoreProduct(p, state, catalog))).length <= CONFIG.TOP_N) return true;
	return nextQuestion(state, catalog) === null;
}

/** Picks 1–3 suggestions from scored candidates (spec 7-5 + "at least one real match"). */
function pickSuggestions<P extends EngineProduct>(scored: Scored<P>[], state: RecState): { picked: Scored<P>[]; note: ResultNote } {
	const anyAnswer = Object.values(state.answers).some((chosen) => chosen.length > 0);
	const order = (a: Scored<P>, b: Scored<P>) => b.score - a.score || tieRank(state.seed, a.product.id) - tieRank(state.seed, b.product.id);
	let pool = contenders(scored);
	let note: ResultNote = anyAnswer ? 'none' : 'noTaste';
	if (anyAnswer) {
		const matching = pool.filter((s) => s.matches > 0);
		if (matching.length) pool = matching;
		else {
			// nothing matches any answer: still help, but say so
			const anyMatch = scored.filter((s) => s.matches > 0);
			pool = anyMatch.length ? contenders(anyMatch) : pool;
			note = 'closest';
		}
	}
	const sorted = [...pool].sort(order);
	if (!sorted.length) return { picked: [], note };
	const top = sorted[0].score;
	if (anyAnswer && top < 0.5) note = 'closest';
	const within = sorted.filter((s) => s.score >= top - CONFIG.SCORE_WINDOW - EPS);
	const picked: Scored<P>[] = [within[0]];
	const categories = new Set([within[0].product.categoryId]);
	// variety: one per category …
	for (const s of within.slice(1)) {
		if (picked.length >= CONFIG.TOP_N) break;
		if (!categories.has(s.product.categoryId)) {
			picked.push(s);
			categories.add(s.product.categoryId);
		}
	}
	// … unless that leaves fewer than three while other good candidates exist
	for (const s of within.slice(1)) {
		if (picked.length >= CONFIG.TOP_N) break;
		if (!picked.includes(s)) picked.push(s);
	}
	picked.sort(order);
	return { picked, note };
}

/** Option labels of a product that match the answers: most important group first, at most three. */
export function reasonLabels(product: EngineProduct, state: RecState, catalog: Catalog): string[] {
	const options = catalog.optionSets.get(product.id)!;
	const groups = Object.keys(state.answers)
		.map((id) => catalog.groupById.get(Number(id)))
		.filter((g): g is EngineGroup => !!g && relevant(g, product))
		.sort((a, b) => b.importance - a.importance || catalog.order.get(a.id)! - catalog.order.get(b.id)!);
	const labels: string[] = [];
	for (const group of groups) {
		const chosen = state.answers[group.id];
		for (const option of group.options) {
			if (chosen.includes(option.id) && options.has(option.id) && !labels.includes(option.label)) labels.push(option.label);
		}
	}
	return labels.slice(0, 3);
}

function toResult<P extends EngineProduct>(picked: Scored<P>[], note: ResultNote, state: RecState, catalog: Catalog<P>, exhausted = false): Result {
	return {
		round: state.round,
		suggestions: picked.map((s) => ({ productId: s.product.id, score: s.score, reasons: reasonLabels(s.product, state, catalog) })),
		note,
		exhausted,
	};
}

/** Moves to the next screen after any change: a question, the skip prompt, or the result. */
function advance(state: RecState, catalog: Catalog): RecState {
	if (state.kind === null) return { ...state, phase: 'kind', current: null };
	const pool = roundPool(state, catalog);
	if (state.round === 1 && !pool.length) return { ...state, phase: 'empty', current: null, result: null };
	if (state.round === 2 && !pool.length) return { ...state, phase: 'moreOffer', current: null, result: null };
	if (roundOver(state, catalog)) return showResults(state, catalog);
	if (state.skipsInRow >= CONFIG.MAX_SKIPS_IN_ROW) return { ...state, phase: 'skipPrompt', current: null };
	return { ...state, phase: 'question', current: nextQuestion(state, catalog)!.id, result: null };
}

function showResults(state: RecState, catalog: Catalog): RecState {
	const pool = roundPool(state, catalog).filter((p) => !state.shown.includes(p.id));
	const { picked, note } = pickSuggestions(
		pool.map((p) => scoreProduct(p, state, catalog)),
		state,
	);
	const result = toResult(picked, note, state, catalog);
	return { ...state, phase: 'results', current: null, result, shown: [...state.shown, ...result.suggestions.map((s) => s.productId)] };
}

// ─── actions (each returns a new state; the dialog keeps the old ones for «قبلی») ─────────────────

/** First screen: the kind (or "doesn't matter") and the optional restrictions. Not counted as a screen. */
export function chooseKind(state: RecState, catalog: Catalog, kind: KindChoice, constraints: number[] = []): RecState {
	const hardOptions = new Set(hardGroups(catalog).flatMap((g) => g.options.map((o) => o.id)));
	return advance({ ...state, kind, constraints: [...new Set(constraints)].filter((id) => hardOptions.has(id)) }, catalog);
}

/** A real answer to the current question (one option, or several for a multi-choice group). */
export function answer(state: RecState, catalog: Catalog, optionIds: number[]): RecState {
	const group = state.current !== null ? catalog.groupById.get(state.current) : undefined;
	if (!group || state.phase !== 'question') return state;
	const valid = [...new Set(optionIds)].filter((id) => group.options.some((o) => o.id === id));
	if (!valid.length) return skip(state, catalog);
	const chosen = group.multi ? valid : valid.slice(0, 1);
	return advance(
		{
			...state,
			answers: { ...state.answers, [group.id]: chosen },
			answered: state.answered + 1,
			screens: state.screens + 1,
			skipsInRow: 0,
		},
		catalog,
	);
}

/** «فرقی نداره»: the group is put aside, the next question is chosen at once (spec 7-4). */
export function skip(state: RecState, catalog: Catalog): RecState {
	if (state.current === null || state.phase !== 'question') return state;
	return advance(
		{ ...state, skipped: [...state.skipped, state.current], screens: state.screens + 1, skipsInRow: state.skipsInRow + 1 },
		catalog,
	);
}

/** «یه سوال دیگه» after two "doesn't matter" in a row. */
export function keepAsking(state: RecState, catalog: Catalog): RecState {
	return advance({ ...state, skipsInRow: 0 }, catalog);
}

/** «نشونم بده»: the result now. */
export function showNow(state: RecState, catalog: Catalog): RecState {
	if (state.kind === null) return state;
	if (!roundPool(state, catalog).length) return advance(state, catalog);
	return showResults(state, catalog);
}

/**
 * Round 2 (spec 7-6): products not shown yet, close to the last suggestion; at most three more answers.
 * null when there is nothing to ask: no such product, or so few that the result would come at once.
 */
function round2(state: RecState, catalog: Catalog): RecState | null {
	if (state.phase !== 'results' || state.round !== 1 || !state.result) return null;
	const scores = new Map(basePool(state, catalog).map((p) => [p.id, scoreProduct(p, state, catalog).score]));
	const shownScores = state.result.suggestions.map((s) => s.score);
	const floor = (shownScores.length ? Math.min(...shownScores) : NEUTRAL) - CONFIG.ROUND2_WINDOW;
	const pool2 = [...scores.entries()].filter(([id, score]) => !state.shown.includes(id) && score >= floor - EPS).map(([id]) => id);
	if (!pool2.length) return null;
	const next = advance({ ...state, round: 2, pool2, answered: 0, screens: 0, skipsInRow: 0, current: null, result: null }, catalog);
	return next.phase === 'question' ? next : null;
}

/**
 * Whether «حداکثر ۳ سوال دیگه» is offered under the result (the owner's rule): not with the first result, but
 * from the first «یه چیز دیگه نشونم بده» on, and it stays while more is asked for. Only in round 1, and only
 * when round 2 would really ask something (a promised question that never comes is worse than no offer).
 */
export function canStartRound2(state: RecState, catalog: Catalog): boolean {
	return state.mores > 0 && round2(state, catalog) !== null;
}

export function startRound2(state: RecState, catalog: Catalog): RecState {
	return canStartRound2(state, catalog) ? round2(state, catalog)! : state;
}

/** «یه چیز دیگه نشونم بده»: the next three of the whole pool by score, never repeating. */
export function more(state: RecState, catalog: Catalog): RecState {
	if (state.kind === null) return state;
	const rest = basePool(state, catalog)
		.filter((p) => !state.shown.includes(p.id))
		.map((p) => scoreProduct(p, state, catalog))
		.sort((a, b) => b.score - a.score || tieRank(state.seed, a.product.id) - tieRank(state.seed, b.product.id))
		.slice(0, CONFIG.TOP_N);
	const result = toResult(rest, 'none', state, catalog, rest.length === 0);
	return {
		...state,
		phase: 'results',
		current: null,
		result,
		shown: [...state.shown, ...rest.map((s) => s.product.id)],
		mores: state.mores + 1,
	};
}

/**
 * The answers offered for the current question: the options at least one product of this round has. An
 * option nobody has (e.g. «لیمویی» among hot drinks) would only lead to "nothing matches".
 */
export function answerOptions(state: RecState, catalog: Catalog): EngineGroup['options'] {
	const group = state.current !== null ? catalog.groupById.get(state.current) : undefined;
	if (!group || state.phase !== 'question') return [];
	const pool = roundPool(state, catalog).filter((p) => relevant(group, p));
	return group.options.filter((o) => pool.some((p) => catalog.optionSets.get(p.id)!.has(o.id)));
}

/** Progress of the current round, 0..1 (shown as a bar without numbers). */
export function progress(state: RecState): number {
	if (state.phase === 'kind') return 0;
	if (state.phase === 'results' || state.phase === 'moreOffer' || state.phase === 'empty') return 1;
	return Math.min(1, Math.max(state.answered / roundTarget(state), state.screens / CONFIG.MAX_SCREENS));
}
