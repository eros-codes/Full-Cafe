// Simulation of «انتخاب برای من» on the real menu (spec section 11): run it after tagging the menu,
// then tune the constants in client/site/menu/recommender/engine.ts (CONFIG) if needed.
//
//   npm run simulate:recommender            (1000 customers)
//   npm run simulate:recommender -- 5000
//
// Each simulated customer picks a kind and cares about 2 to 4 things (e.g. «سرد» and «شیرین»). They answer
// the questions they care about with their option and «فرقی نداره» to the rest. Reported:
//   - screens: questions shown in round 1 (answers + «فرقی نداره»)
//   - top match: the first suggestion has everything the customer wanted
//   - any match: at least one of the 1–3 suggestions has everything
//   - possible: such a product exists at all in the customer's pool (the ceiling for the two above)
import 'dotenv/config';
import { prisma } from '../src/lib/prisma.js';
import { loadRecommenderCatalog } from '../src/services/recommender.service.js';
import {
	answer,
	availableKinds,
	basePool,
	buildCatalog,
	chooseKind,
	initialState,
	keepAsking,
	showNow,
	skip,
	type Catalog,
	type EngineGroup,
	type Kind,
	type RecState,
} from '../client/site/menu/recommender/engine.js';

const customers = Math.max(1, Number(process.argv[2]) || 1000);
let seed = 20261019;
const rand = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const pick = <T>(list: readonly T[]): T => list[Math.floor(rand() * list.length)];

function wantsFor(catalog: Catalog, kind: Kind): Map<number, number> {
	const groups = catalog.groups.filter((g) => g.strictness === 'SOFT' && g.kinds.includes(kind));
	const count = Math.min(groups.length, 2 + Math.floor(rand() * 3));
	const chosen = [...groups].sort(() => rand() - 0.5).slice(0, count);
	return new Map(chosen.map((g: EngineGroup) => [g.id, pick(g.options).id]));
}

const hasAll = (catalog: Catalog, productId: number, wants: Map<number, number>) =>
	[...wants.values()].every((optionId) => catalog.optionSets.get(productId)!.has(optionId));

async function main() {
	const data = await loadRecommenderCatalog();
	const catalog = buildCatalog(data.groups, data.products);
	const kinds = availableKinds(catalog);
	if (!kinds.length || !catalog.groups.some((g) => g.strictness === 'SOFT')) {
		console.log('Nothing to simulate: no tagged products with a kind, or no taste groups.');
		return;
	}
	let screens = 0;
	let topMatch = 0;
	let anyMatch = 0;
	let possible = 0;
	let finished = 0;
	for (let i = 0; i < customers; i++) {
		const kind = pick(kinds);
		const wants = wantsFor(catalog, kind);
		let s: RecState = chooseKind(initialState(Math.floor(rand() * 2 ** 31)), catalog, kind);
		for (let step = 0; step < 40 && (s.phase === 'question' || s.phase === 'skipPrompt'); step++) {
			if (s.phase === 'skipPrompt') {
				s = keepAsking(s, catalog);
				if (s.phase === 'skipPrompt') s = showNow(s, catalog);
				continue;
			}
			const want = wants.get(s.current!);
			s = want ? answer(s, catalog, [want]) : skip(s, catalog);
		}
		if (s.phase !== 'results' || !s.result) continue;
		finished++;
		screens += s.screens;
		const ids = s.result.suggestions.map((x) => x.productId);
		if (ids.length && hasAll(catalog, ids[0], wants)) topMatch++;
		if (ids.some((id) => hasAll(catalog, id, wants))) anyMatch++;
		if (basePool({ ...s, round: 1, pool2: null }, catalog).some((p) => hasAll(catalog, p.id, wants))) possible++;
	}
	const pct = (n: number) => `${((100 * n) / Math.max(1, finished)).toFixed(1)}%`;
	console.log(`products: ${catalog.products.length}, taste groups: ${catalog.groups.filter((g) => g.strictness === 'SOFT').length}, customers: ${customers}`);
	console.log(`average screens in round 1: ${(screens / Math.max(1, finished)).toFixed(2)}`);
	console.log(`top match: ${pct(topMatch)}   any match: ${pct(anyMatch)}   possible: ${pct(possible)}`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
