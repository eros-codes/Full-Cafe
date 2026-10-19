import type { CategoryKind, Prisma, TagStrictness } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
import { getSettings, type Settings } from './settings.service.js';

// «انتخاب برای من»: the data the customer's browser needs (questions + products with their tags), the tag
// inheritance rule, and the admin's tag coverage. The recommendation itself runs in the browser
// (client/site/menu/recommender/engine.ts); the server only serves and stores the data.

export const CATEGORY_KINDS: readonly CategoryKind[] = ['DRINK', 'FOOD', 'DESSERT'];
export const RECOMMENDER_SETTING = 'recommenderEnabled';

/**
 * Options that also mean other options of the same group, by option key: a vegan dish is vegetarian too.
 * Applied whenever product or category tags are saved, so «گیاهخوار» also finds vegan dishes.
 */
export const OPTION_IMPLIES: Readonly<Record<string, readonly string[]>> = { vegan: ['vegetarian'] };

export function isRecommenderEnabled(settings: Settings): boolean {
	return settings[RECOMMENDER_SETTING] === '1';
}

export function isCategoryKind(value: unknown): value is CategoryKind {
	return typeof value === 'string' && (CATEGORY_KINDS as readonly string[]).includes(value);
}

// ─── Tag inheritance ──────────────────────────────────────────────────────────

export interface ProductTagSource {
	categoryId: number;
	/** Groups the product sets itself. */
	ownGroupIds: readonly number[];
	/** The product's own options (only those of its own groups count). */
	ownOptionIds: readonly number[];
}

/**
 * The options that really apply to a product. Per tag group: if the product sets the group itself, its own
 * options (possibly none); otherwise the options of its category for that group.
 * Example: category «قهوه» has «با کافئین»; a decaf coffee sets the caffeine group itself to «بدون کافئین»
 * and still inherits everything else from the category.
 */
export function effectiveOptionIds(
	product: ProductTagSource,
	categoryOptionIds: readonly number[],
	groupOf: ReadonlyMap<number, number>,
): number[] {
	const own = new Set(product.ownGroupIds);
	const result = new Set<number>();
	for (const optionId of product.ownOptionIds) {
		const groupId = groupOf.get(optionId);
		if (groupId !== undefined && own.has(groupId)) result.add(optionId);
	}
	for (const optionId of categoryOptionIds) {
		const groupId = groupOf.get(optionId);
		if (groupId !== undefined && !own.has(groupId)) result.add(optionId);
	}
	return [...result].sort((a, b) => a - b);
}

/**
 * Groups the product sets itself to «هیچ‌کدام»: its own group, with none of the group's options. For the
 * recommender that is a miss for every answer of the group (water has no flavor), not "unknown".
 */
export function noneGroupIds(product: ProductTagSource, groupOf: ReadonlyMap<number, number>): number[] {
	const withOption = new Set(product.ownOptionIds.map((id) => groupOf.get(id)));
	return [...new Set(product.ownGroupIds)].filter((groupId) => !withOption.has(groupId)).sort((a, b) => a - b);
}

// ─── Saving tags (validation + implications) ─────────────────────────────────

type InputResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

const parseId = (value: unknown): number | null => {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
};

const TAG_OPTIONS_MAX = 200;

/** Adds the options implied by OPTION_IMPLIES (same group only). */
export async function withImplications(db: Db, optionIds: readonly number[]): Promise<number[]> {
	const result = new Set(optionIds);
	if (!optionIds.length) return [];
	const chosen = await db.tagOption.findMany({ where: { id: { in: [...optionIds] }, key: { in: Object.keys(OPTION_IMPLIES) } } });
	for (const option of chosen) {
		const impliedKeys = option.key ? OPTION_IMPLIES[option.key] : undefined;
		if (!impliedKeys?.length) continue;
		const implied = await db.tagOption.findMany({
			where: { groupId: option.groupId, key: { in: [...impliedKeys] } },
			select: { id: true },
		});
		implied.forEach((o) => result.add(o.id));
	}
	return [...result].sort((a, b) => a - b);
}

/** A list of existing option ids (no duplicates). */
export async function readOptionIds(value: unknown): Promise<InputResult<number[]>> {
	if (!Array.isArray(value)) return { ok: false, error: 'لیست برچسب‌ها نامعتبر است' };
	if (value.length > TAG_OPTIONS_MAX) return { ok: false, error: 'تعداد برچسب‌ها بیش از حد مجاز است' };
	const ids = value.map(parseId);
	if (!ids.every((id): id is number => id !== null)) return { ok: false, error: 'شناسه‌ی برچسب نامعتبر است' };
	const unique = [...new Set(ids)];
	if (unique.length && (await prisma.tagOption.count({ where: { id: { in: unique } } })) !== unique.length) {
		return { ok: false, error: 'یکی از برچسب‌ها پیدا نشد', status: 404 };
	}
	return { ok: true, data: unique };
}

export interface ProductTagsInput {
	groupId: number;
	optionIds: number[];
}

/**
 * The groups a product sets itself: `[{ groupId, optionIds }]`. A group with an empty list means
 * "this product has none of these" (it overrides the category). Groups not listed are inherited.
 */
export async function readProductTags(value: unknown): Promise<InputResult<ProductTagsInput[]>> {
	if (!Array.isArray(value)) return { ok: false, error: 'برچسب‌های محصول نامعتبر است' };
	const groups: ProductTagsInput[] = [];
	const seen = new Set<number>();
	for (const entry of value) {
		const groupId = parseId((entry as { groupId?: unknown } | null)?.groupId);
		if (!groupId) return { ok: false, error: 'گروه برچسب نامعتبر است' };
		if (seen.has(groupId)) return { ok: false, error: 'یک گروه برچسب دو بار آمده است' };
		seen.add(groupId);
		const ids = await readOptionIds((entry as { optionIds?: unknown }).optionIds);
		if (!ids.ok) return ids;
		groups.push({ groupId, optionIds: ids.data });
	}
	if (!groups.length) return { ok: true, data: [] };
	const found = await prisma.tagGroup.findMany({ where: { id: { in: groups.map((g) => g.groupId) } }, select: { id: true } });
	if (found.length !== groups.length) return { ok: false, error: 'گروه برچسب پیدا نشد', status: 404 };
	const allOptions = groups.flatMap((g) => g.optionIds);
	if (allOptions.length) {
		const options = await prisma.tagOption.findMany({ where: { id: { in: allOptions } }, select: { id: true, groupId: true } });
		const groupOf = new Map(options.map((o) => [o.id, o.groupId]));
		for (const group of groups) {
			if (group.optionIds.some((id) => groupOf.get(id) !== group.groupId)) {
				return { ok: false, error: 'برچسب انتخاب‌شده مال این گروه نیست' };
			}
		}
	}
	return { ok: true, data: groups };
}

/** Replaces everything the product sets itself (its own groups and their options). */
export async function replaceProductTags(db: Db, productId: number, groups: readonly ProductTagsInput[]): Promise<void> {
	await db.productTagOption.deleteMany({ where: { productId } });
	await db.productTagGroup.deleteMany({ where: { productId } });
	if (!groups.length) return;
	await db.productTagGroup.createMany({ data: groups.map((g) => ({ productId, groupId: g.groupId })) });
	const optionIds = await withImplications(
		db,
		groups.flatMap((g) => g.optionIds),
	);
	if (optionIds.length) await db.productTagOption.createMany({ data: optionIds.map((optionId) => ({ productId, optionId })) });
}

export async function replaceCategoryTags(db: Db, categoryId: number, optionIds: readonly number[]): Promise<void> {
	await db.categoryTagOption.deleteMany({ where: { categoryId } });
	const all = await withImplications(db, optionIds);
	if (all.length) await db.categoryTagOption.createMany({ data: all.map((optionId) => ({ categoryId, optionId })) });
}

/**
 * Bulk edit from the product list: add and/or remove options on many products. A group the product
 * still inherits is first copied from its category (so nothing it had is lost), then changed.
 */
export async function bulkEditProductTags(
	db: Db,
	productIds: readonly number[],
	addOptionIds: readonly number[],
	removeOptionIds: readonly number[],
) {
	const touched = [...new Set([...addOptionIds, ...removeOptionIds])];
	const options = await db.tagOption.findMany({ where: { id: { in: touched } }, select: { id: true, groupId: true } });
	const groupOf = new Map(options.map((o) => [o.id, o.groupId]));
	const touchedGroups = [...new Set(options.map((o) => o.groupId))];
	const products = await db.product.findMany({
		where: { id: { in: [...productIds] } },
		select: {
			id: true,
			categoryId: true,
			tagGroups: { select: { groupId: true } },
			tags: { select: { optionId: true, option: { select: { groupId: true } } } },
			category: { select: { tags: { select: { optionId: true, option: { select: { groupId: true } } } } } },
		},
	});
	for (const product of products) {
		const own = new Map<number, Set<number>>();
		for (const { groupId } of product.tagGroups) own.set(groupId, new Set());
		for (const tag of product.tags) own.get(tag.option.groupId)?.add(tag.optionId);
		for (const groupId of touchedGroups) {
			if (own.has(groupId)) continue;
			const inherited = product.category.tags.filter((t) => t.option.groupId === groupId).map((t) => t.optionId);
			own.set(groupId, new Set(inherited));
		}
		for (const optionId of addOptionIds) own.get(groupOf.get(optionId) as number)?.add(optionId);
		for (const optionId of removeOptionIds) own.get(groupOf.get(optionId) as number)?.delete(optionId);
		await replaceProductTags(
			db,
			product.id,
			[...own.entries()].map(([groupId, ids]) => ({ groupId, optionIds: [...ids] })),
		);
	}
	return products.length;
}

// ─── Public data (cached) ─────────────────────────────────────────────────────

export interface RecommenderGroup {
	id: number;
	key: string | null;
	name: string;
	question: string;
	questionByKind: Partial<Record<CategoryKind, string>> | null;
	multi: boolean;
	/** The options are a scale: a neighbour of the answer counts half. */
	ordered: boolean;
	strictness: TagStrictness;
	importance: number;
	kinds: CategoryKind[];
	options: { id: number; label: string }[];
}

export interface RecommenderProduct {
	id: number;
	name: string;
	price: number;
	description: string;
	image: string;
	categoryId: number;
	categoryName: string;
	kind: CategoryKind;
	isAvailable: true;
	addOns: { id: number; name: string; price: number }[];
	optionIds: number[];
	/** Active groups set to «هیچ‌کدام» for this product. */
	noneGroupIds: number[];
}

export type RecommenderData = { enabled: false } | { enabled: true; groups: RecommenderGroup[]; products: RecommenderProduct[] };

const CACHE_TTL_MS = 60 * 1000;
let cache: { data: RecommenderData; at: number } | null = null;
let pending: Promise<RecommenderData> | null = null;
let generation = 0;

/** Called after every admin change to the menu, the tags or the settings. */
export function invalidateRecommenderCache(): void {
	cache = null;
	generation++;
}

function readQuestionByKind(value: Prisma.JsonValue | null): Partial<Record<CategoryKind, string>> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const result: Partial<Record<CategoryKind, string>> = {};
	for (const kind of CATEGORY_KINDS) {
		const text = (value as Record<string, unknown>)[kind];
		if (typeof text === 'string' && text.trim()) result[kind] = text.trim();
	}
	return Object.keys(result).length ? result : null;
}

async function loadRecommenderData(): Promise<RecommenderData> {
	if (!isRecommenderEnabled(await getSettings())) return { enabled: false };
	return { enabled: true, ...(await loadRecommenderCatalog()) };
}

/** Questions and products as the customer gets them, whether the switch is on or not (also used by the simulation script). */
export async function loadRecommenderCatalog(): Promise<{ groups: RecommenderGroup[]; products: RecommenderProduct[] }> {
	const groups = await prisma.tagGroup.findMany({
		where: { isActive: true },
		orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
		include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, label: true } } },
	});
	const groupOf = new Map<number, number>();
	groups.forEach((g) => g.options.forEach((o) => groupOf.set(o.id, g.id)));
	const activeGroupIds = new Set(groups.map((g) => g.id));
	const products = await prisma.product.findMany({
		// موجود، در دسته‌ای که نوع دارد و تب منویش مخفی نیست
		where: { isAvailable: true, category: { kind: { not: null }, menuType: { isActive: true } } },
		orderBy: { id: 'asc' },
		select: {
			id: true,
			name: true,
			price: true,
			description: true,
			image: true,
			categoryId: true,
			category: { select: { name: true, kind: true, tags: { select: { optionId: true } } } },
			tagGroups: { select: { groupId: true } },
			tags: { select: { optionId: true } },
			addOns: {
				where: { addOn: { isActive: true } },
				orderBy: { sortOrder: 'asc' },
				select: { addOn: { select: { id: true, name: true, price: true } } },
			},
		},
	});
	return {
		groups: groups.map((g) => ({
			id: g.id,
			key: g.key,
			name: g.name,
			question: g.question,
			questionByKind: readQuestionByKind(g.questionByKind),
			multi: g.multi,
			ordered: g.ordered,
			strictness: g.strictness,
			importance: g.importance,
			kinds: g.kinds,
			options: g.options,
		})),
		products: products.map((p) => {
			const source = {
				categoryId: p.categoryId,
				ownGroupIds: p.tagGroups.map((t) => t.groupId),
				ownOptionIds: p.tags.map((t) => t.optionId),
			};
			return {
				id: p.id,
				name: p.name,
				price: p.price,
				description: p.description,
				image: p.image,
				categoryId: p.categoryId,
				categoryName: p.category.name,
				kind: p.category.kind as CategoryKind,
				isAvailable: true,
				addOns: p.addOns.map((link) => link.addOn),
				optionIds: effectiveOptionIds(
					source,
					p.category.tags.map((t) => t.optionId),
					groupOf,
				),
				noneGroupIds: noneGroupIds(source, groupOf).filter((id) => activeGroupIds.has(id)),
			};
		}),
	};
}

/** The recommender data, cached for a minute (and dropped at once after any admin change). */
export async function getRecommenderData(): Promise<RecommenderData> {
	if (cache && Date.now() - cache.at < CACHE_TTL_MS) return cache.data;
	if (pending) return pending;
	const startedAt = generation;
	pending = loadRecommenderData()
		.then((data) => {
			// an admin change during the load makes this result stale: serve it once, do not keep it
			if (startedAt === generation) cache = { data, at: Date.now() };
			return data;
		})
		.finally(() => {
			pending = null;
		});
	return pending;
}

/** Whether the menu shows the button: switched on, and there is something to ask and to suggest. */
export async function getRecommenderStatus(): Promise<{ enabled: boolean }> {
	const data = await getRecommenderData();
	return { enabled: data.enabled && data.groups.some((g) => g.strictness === 'SOFT' && g.options.length > 0) && data.products.length > 0 };
}

// ─── Coverage (admin) ─────────────────────────────────────────────────────────

export interface TagCoverage {
	/** Per active taste group: products it applies to, and how many of them are done (tagged, or set to «هیچ‌کدام»). */
	groups: { id: number; name: string; relevant: number; tagged: number }[];
	/** Products (with a kind) with at least one active taste group that applies to them and is not done. */
	incomplete: { productId: number; missingGroupIds: number[] }[];
	/** Products whose category has no kind: they are never recommended. */
	withoutKind: number;
}

export async function getTagCoverage(): Promise<TagCoverage> {
	const groups = await prisma.tagGroup.findMany({
		where: { isActive: true, strictness: 'SOFT' },
		orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
		include: { options: { select: { id: true } } },
	});
	const allOptions = await prisma.tagOption.findMany({ select: { id: true, groupId: true } });
	const groupOf = new Map(allOptions.map((o) => [o.id, o.groupId]));
	const products = await prisma.product.findMany({
		select: {
			id: true,
			categoryId: true,
			category: { select: { kind: true, tags: { select: { optionId: true } } } },
			tagGroups: { select: { groupId: true } },
			tags: { select: { optionId: true } },
		},
		orderBy: { id: 'asc' },
	});
	const stats = new Map(groups.map((g) => [g.id, { relevant: 0, tagged: 0 }]));
	const incomplete: TagCoverage['incomplete'] = [];
	let withoutKind = 0;
	for (const product of products) {
		const kind = product.category.kind;
		if (!kind) {
			withoutKind++;
			continue;
		}
		const effective = effectiveOptionIds(
			{
				categoryId: product.categoryId,
				ownGroupIds: product.tagGroups.map((t) => t.groupId),
				ownOptionIds: product.tags.map((t) => t.optionId),
			},
			product.category.tags.map((t) => t.optionId),
			groupOf,
		);
		// a group set to «هیچ‌کدام» is done too: the admin decided it, nothing is missing
		const taggedGroups = new Set([...effective.map((id) => groupOf.get(id)), ...product.tagGroups.map((t) => t.groupId)]);
		const missing: number[] = [];
		for (const group of groups) {
			if (!group.kinds.includes(kind) || !group.options.length) continue;
			const s = stats.get(group.id)!;
			s.relevant++;
			if (taggedGroups.has(group.id)) s.tagged++;
			else missing.push(group.id);
		}
		if (missing.length) incomplete.push({ productId: product.id, missingGroupIds: missing });
	}
	return {
		groups: groups.map((g) => ({ id: g.id, name: g.name, ...stats.get(g.id)! })),
		incomplete,
		withoutKind,
	};
}
