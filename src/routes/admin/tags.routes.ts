import express from 'express';
import { Prisma, type CategoryKind, type TagStrictness } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { prismaCode } from '../../lib/http-error.js';
import { requireRole } from '../../middleware/auth.js';
import { ROLE_GROUPS } from '../../lib/roles.js';
import {
	CATEGORY_KINDS,
	bulkEditProductTags,
	getTagCoverage,
	invalidateRecommenderCache,
	isCategoryKind,
	readOptionIds,
	readProductTags,
	replaceCategoryTags,
	replaceProductTags,
} from '../../services/recommender.service.js';

// «انتخاب برای من» in the admin panel: tag groups (the questions) and their options, a product's and a
// category's tags, bulk tagging and coverage. Mounted inside adminRouter (requireAdmin has already run).
//   - the groups (question texts, importance, …) shape what every customer sees: manager only
//   - tagging products and categories is everyday menu work: staff too
export const adminTagsRouter = express.Router();
const requireStaff = requireRole(...ROLE_GROUPS.staff);
const requireManager = requireRole(...ROLE_GROUPS.manager);

// هر تغییر موفق، داده‌ی کش‌شده‌ی «انتخاب برای من» را باطل می‌کند تا مشتری فوراً نسخه‌ی تازه را ببیند
adminTagsRouter.use((req, res, next) => {
	if (req.method !== 'GET') {
		res.on('finish', () => {
			if (res.statusCode < 400) invalidateRecommenderCache();
		});
	}
	next();
});

const NAME_MAX = 40;
const QUESTION_MAX = 120;
const OPTION_LABEL_MAX = 40;
const OPTIONS_PER_GROUP_MAX = 12;
const KEY_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;

type InputResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

function parseId(value: unknown): number | null {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}

// ─── Tag groups ───────────────────────────────────────────────────────────────

interface GroupFields {
	name: string;
	key: string | null;
	question: string;
	questionByKind: Prisma.InputJsonValue | typeof Prisma.DbNull;
	multi: boolean;
	ordered: boolean;
	strictness: TagStrictness;
	importance: number;
	kinds: CategoryKind[];
	isActive: boolean;
}

function readText(value: unknown, label: string, max: number): InputResult<string> {
	if (typeof value !== 'string' || !value.trim()) return { ok: false, error: `${label} الزامی است` };
	if (value.trim().length > max) return { ok: false, error: `${label} حداکثر ${max} کاراکتر است` };
	return { ok: true, data: value.trim() };
}

async function readGroupInput(body: unknown, partial: boolean): Promise<InputResult<Partial<GroupFields>>> {
	const { DbNull } = Prisma;
	const data: Partial<GroupFields> = {};
	const b = (body ?? {}) as Record<string, unknown>;
	if (b.name !== undefined || !partial) {
		const r = readText(b.name, 'نام گروه', NAME_MAX);
		if (!r.ok) return r;
		data.name = r.data;
	}
	if (b.question !== undefined || !partial) {
		const r = readText(b.question, 'متن سوال', QUESTION_MAX);
		if (!r.ok) return r;
		data.question = r.data;
	}
	if (b.key !== undefined) {
		if (b.key === null || b.key === '') data.key = null;
		else if (typeof b.key !== 'string' || !KEY_PATTERN.test(b.key.trim())) {
			return { ok: false, error: 'شناسه باید با حرف انگلیسی کوچک شروع شود و فقط حروف انگلیسی کوچک، عدد، - یا _ داشته باشد' };
		} else data.key = b.key.trim();
	}
	if (b.questionByKind !== undefined) {
		if (b.questionByKind === null) data.questionByKind = DbNull;
		else if (typeof b.questionByKind !== 'object' || Array.isArray(b.questionByKind)) return { ok: false, error: 'متن سوال برای هر نوع نامعتبر است' };
		else {
			const texts: Record<string, string> = {};
			for (const [kind, text] of Object.entries(b.questionByKind as Record<string, unknown>)) {
				if (!isCategoryKind(kind)) return { ok: false, error: 'نوع نامعتبر در متن سوال‌ها' };
				if (text === null || text === '') continue;
				if (typeof text !== 'string') return { ok: false, error: 'متن سوال نامعتبر است' };
				if (text.trim().length > QUESTION_MAX) return { ok: false, error: `متن سوال حداکثر ${QUESTION_MAX} کاراکتر است` };
				if (text.trim()) texts[kind] = text.trim();
			}
			data.questionByKind = Object.keys(texts).length ? texts : DbNull;
		}
	}
	for (const flag of ['multi', 'ordered', 'isActive'] as const) {
		if (b[flag] !== undefined) {
			if (typeof b[flag] !== 'boolean') return { ok: false, error: 'مقدار انتخاب نامعتبر است' };
			data[flag] = b[flag] as boolean;
		}
	}
	if (b.strictness !== undefined) {
		if (b.strictness !== 'SOFT' && b.strictness !== 'HARD') return { ok: false, error: 'نوع گروه (سلیقه / محدودیت) نامعتبر است' };
		data.strictness = b.strictness;
	}
	if (b.importance !== undefined) {
		const n = Number(b.importance);
		if (!Number.isInteger(n) || n < 1 || n > 5) return { ok: false, error: 'اهمیت باید عددی بین ۱ تا ۵ باشد' };
		data.importance = n;
	}
	if (b.kinds !== undefined || !partial) {
		if (!Array.isArray(b.kinds) || !b.kinds.length || !b.kinds.every(isCategoryKind)) {
			return { ok: false, error: 'حداقل یک نوع (نوشیدنی، غذا یا دسر) برای گروه انتخاب کن' };
		}
		data.kinds = CATEGORY_KINDS.filter((k) => (b.kinds as string[]).includes(k));
	}
	return { ok: true, data };
}

function readOptionLabels(value: unknown): InputResult<string[]> {
	if (value === undefined) return { ok: true, data: [] };
	if (!Array.isArray(value)) return { ok: false, error: 'لیست گزینه‌ها نامعتبر است' };
	if (value.length > OPTIONS_PER_GROUP_MAX) return { ok: false, error: `حداکثر ${OPTIONS_PER_GROUP_MAX} گزینه برای هر گروه` };
	const labels: string[] = [];
	for (const label of value) {
		const r = readText(label, 'متن گزینه', OPTION_LABEL_MAX);
		if (!r.ok) return r;
		if (labels.includes(r.data)) return { ok: false, error: `گزینه‌ی «${r.data}» دو بار آمده است` };
		labels.push(r.data);
	}
	return { ok: true, data: labels };
}

const groupInclude = {
	options: {
		orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
		include: { _count: { select: { products: true, categories: true } } },
	},
} satisfies Prisma.TagGroupInclude;

type GroupWithOptions = Prisma.TagGroupGetPayload<{ include: typeof groupInclude }>;

function toAdminGroup(group: GroupWithOptions) {
	const { options, ...fields } = group;
	return {
		...fields,
		options: options.map(({ _count, ...option }) => ({ ...option, productCount: _count.products, categoryCount: _count.categories })),
	};
}

const GROUP_ORDER = [{ sortOrder: 'asc' }, { id: 'asc' }] satisfies Prisma.TagGroupOrderByWithRelationInput[];

adminTagsRouter.get('/tag-groups', requireStaff, async (_req, res, next) => {
	try {
		const groups = await prisma.tagGroup.findMany({ orderBy: GROUP_ORDER, include: groupInclude });
		res.json({ groups: groups.map(toAdminGroup) });
	} catch (error) {
		next(error);
	}
});

adminTagsRouter.post('/tag-groups', requireManager, async (req, res, next) => {
	try {
		const input = await readGroupInput(req.body, false);
		if (!input.ok) return res.status(input.status ?? 400).json({ message: input.error });
		const labels = readOptionLabels(req.body?.options);
		if (!labels.ok) return res.status(400).json({ message: labels.error });
		const last = await prisma.tagGroup.aggregate({ _max: { sortOrder: true } });
		const group = await prisma.tagGroup.create({
			data: {
				...(input.data as GroupFields),
				sortOrder: (last._max.sortOrder ?? -1) + 1,
				options: { create: labels.data.map((label, sortOrder) => ({ label, sortOrder })) },
			},
			include: groupInclude,
		});
		res.status(201).json({ group: toAdminGroup(group) });
	} catch (error) {
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'گروهی با این شناسه از قبل وجود دارد' });
		next(error);
	}
});

// ترتیب سوال‌ها در پنل (و ترتیب پیش‌فرض بین سوال‌های هم‌ارزش): لیست کامل شناسه‌ها
adminTagsRouter.put('/tag-groups/order', requireManager, async (req, res, next) => {
	try {
		const raw: unknown = req.body?.ids;
		const ids = Array.isArray(raw) ? raw.map(parseId) : [];
		const existing = await prisma.tagGroup.findMany({ select: { id: true } });
		const valid =
			ids.length === existing.length &&
			ids.every((id): id is number => id !== null) &&
			new Set(ids).size === ids.length &&
			existing.every((g) => ids.includes(g.id));
		if (!valid) return res.status(400).json({ message: 'ترتیب باید شامل همه‌ی گروه‌ها، هر کدام یک بار، باشد' });
		await prisma.$transaction(ids.map((id, index) => prisma.tagGroup.update({ where: { id: id as number }, data: { sortOrder: index } })));
		const groups = await prisma.tagGroup.findMany({ orderBy: GROUP_ORDER, include: groupInclude });
		res.json({ groups: groups.map(toAdminGroup) });
	} catch (error) {
		next(error);
	}
});

adminTagsRouter.patch('/tag-groups/:id', requireManager, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const input = await readGroupInput(req.body, true);
		if (!input.ok) return res.status(input.status ?? 400).json({ message: input.error });
		const group = await prisma.tagGroup.update({ where: { id }, data: input.data, include: groupInclude });
		res.json({ group: toAdminGroup(group) });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'گروه پیدا نشد' });
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'گروهی با این شناسه از قبل وجود دارد' });
		next(error);
	}
});

/** How many products and categories use a group (or one option): deleting it changes all of them. */
async function usage(where: { optionIds: number[]; groupId?: number }) {
	const [products, categories, overrides] = await Promise.all([
		prisma.productTagOption.findMany({ where: { optionId: { in: where.optionIds } }, distinct: ['productId'], select: { productId: true } }),
		prisma.categoryTagOption.findMany({ where: { optionId: { in: where.optionIds } }, distinct: ['categoryId'], select: { categoryId: true } }),
		where.groupId ? prisma.productTagGroup.findMany({ where: { groupId: where.groupId }, select: { productId: true } }) : Promise.resolve([]),
	]);
	const productIds = new Set([...products, ...overrides].map((row) => row.productId));
	return { productCount: productIds.size, categoryCount: categories.length };
}

adminTagsRouter.delete('/tag-groups/:id', requireManager, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const group = await prisma.tagGroup.findUnique({ where: { id }, include: { options: { select: { id: true } } } });
		if (!group) return res.status(404).json({ message: 'گروه پیدا نشد' });
		const used = await usage({ optionIds: group.options.map((o) => o.id), groupId: id });
		if ((used.productCount || used.categoryCount) && req.query.force !== '1') {
			return res.status(409).json({ message: 'این گروه روی محصولات یا دسته‌ها استفاده شده است.', ...used });
		}
		await prisma.tagGroup.delete({ where: { id } });
		res.json({ message: 'گروه حذف شد.' });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'گروه پیدا نشد' });
		next(error);
	}
});

// ─── Options of a group ───────────────────────────────────────────────────────

adminTagsRouter.post('/tag-groups/:id/options', requireManager, async (req, res, next) => {
	try {
		const groupId = parseId(req.params.id);
		if (!groupId) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const label = readText(req.body?.label, 'متن گزینه', OPTION_LABEL_MAX);
		if (!label.ok) return res.status(400).json({ message: label.error });
		const group = await prisma.tagGroup.findUnique({ where: { id: groupId }, include: { options: true } });
		if (!group) return res.status(404).json({ message: 'گروه پیدا نشد' });
		if (group.options.length >= OPTIONS_PER_GROUP_MAX) return res.status(400).json({ message: `حداکثر ${OPTIONS_PER_GROUP_MAX} گزینه برای هر گروه` });
		if (group.options.some((o) => o.label === label.data)) return res.status(409).json({ message: `گزینه‌ی «${label.data}» از قبل وجود دارد` });
		const sortOrder = Math.max(-1, ...group.options.map((o) => o.sortOrder)) + 1;
		await prisma.tagOption.create({ data: { groupId, label: label.data, sortOrder } });
		const updated = await prisma.tagGroup.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
		res.status(201).json({ group: toAdminGroup(updated) });
	} catch (error) {
		next(error);
	}
});

adminTagsRouter.put('/tag-groups/:id/options/order', requireManager, async (req, res, next) => {
	try {
		const groupId = parseId(req.params.id);
		if (!groupId) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const raw: unknown = req.body?.ids;
		const ids = Array.isArray(raw) ? raw.map(parseId) : [];
		const existing = await prisma.tagOption.findMany({ where: { groupId }, select: { id: true } });
		const valid =
			ids.length === existing.length &&
			ids.every((id): id is number => id !== null) &&
			new Set(ids).size === ids.length &&
			existing.every((o) => ids.includes(o.id));
		if (!valid) return res.status(400).json({ message: 'ترتیب باید شامل همه‌ی گزینه‌های این گروه، هر کدام یک بار، باشد' });
		await prisma.$transaction(ids.map((id, index) => prisma.tagOption.update({ where: { id: id as number }, data: { sortOrder: index } })));
		const group = await prisma.tagGroup.findUniqueOrThrow({ where: { id: groupId }, include: groupInclude });
		res.json({ group: toAdminGroup(group) });
	} catch (error) {
		next(error);
	}
});

adminTagsRouter.patch('/tag-options/:id', requireManager, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const label = readText(req.body?.label, 'متن گزینه', OPTION_LABEL_MAX);
		if (!label.ok) return res.status(400).json({ message: label.error });
		const option = await prisma.tagOption.findUnique({ where: { id } });
		if (!option) return res.status(404).json({ message: 'گزینه پیدا نشد' });
		const twin = await prisma.tagOption.findFirst({ where: { groupId: option.groupId, label: label.data, id: { not: id } } });
		if (twin) return res.status(409).json({ message: `گزینه‌ی «${label.data}» از قبل وجود دارد` });
		await prisma.tagOption.update({ where: { id }, data: { label: label.data } });
		const group = await prisma.tagGroup.findUniqueOrThrow({ where: { id: option.groupId }, include: groupInclude });
		res.json({ group: toAdminGroup(group) });
	} catch (error) {
		next(error);
	}
});

adminTagsRouter.delete('/tag-options/:id', requireManager, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const option = await prisma.tagOption.findUnique({ where: { id } });
		if (!option) return res.status(404).json({ message: 'گزینه پیدا نشد' });
		const used = await usage({ optionIds: [id] });
		if ((used.productCount || used.categoryCount) && req.query.force !== '1') {
			return res.status(409).json({ message: 'این گزینه روی محصولات یا دسته‌ها استفاده شده است.', ...used });
		}
		await prisma.tagOption.delete({ where: { id } });
		const group = await prisma.tagGroup.findUniqueOrThrow({ where: { id: option.groupId }, include: groupInclude });
		res.json({ group: toAdminGroup(group) });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'گزینه پیدا نشد' });
		next(error);
	}
});

// ─── Tags of products and categories ─────────────────────────────────────────

adminTagsRouter.put('/products/:id/tags', requireStaff, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		if (!(await prisma.product.findUnique({ where: { id } }))) return res.status(404).json({ message: 'محصول یافت نشد' });
		const tags = await readProductTags(req.body?.tags);
		if (!tags.ok) return res.status(tags.status ?? 400).json({ message: tags.error });
		await prisma.$transaction((tx) => replaceProductTags(tx, id, tags.data));
		res.json({ message: 'برچسب‌های محصول ذخیره شد.' });
	} catch (error) {
		next(error);
	}
});

adminTagsRouter.post('/products/tags/bulk', requireStaff, async (req, res, next) => {
	try {
		const raw: unknown = req.body?.productIds;
		const productIds = Array.isArray(raw) ? raw.map(parseId) : [];
		if (!productIds.length || !productIds.every((id): id is number => id !== null)) return res.status(400).json({ message: 'محصولی انتخاب نشده است' });
		if (productIds.length > 500) return res.status(400).json({ message: 'تعداد محصولات انتخاب‌شده بیش از حد است' });
		const add = await readOptionIds(req.body?.addOptionIds ?? []);
		if (!add.ok) return res.status(add.status ?? 400).json({ message: add.error });
		const remove = await readOptionIds(req.body?.removeOptionIds ?? []);
		if (!remove.ok) return res.status(remove.status ?? 400).json({ message: remove.error });
		if (!add.data.length && !remove.data.length) return res.status(400).json({ message: 'برچسبی برای افزودن یا برداشتن انتخاب نشده است' });
		if (add.data.some((id) => remove.data.includes(id))) return res.status(400).json({ message: 'یک برچسب نمی‌تواند هم اضافه و هم برداشته شود' });
		const ids = [...new Set(productIds)];
		if ((await prisma.product.count({ where: { id: { in: ids } } })) !== ids.length) return res.status(404).json({ message: 'یکی از محصولات پیدا نشد' });
		const count = await prisma.$transaction((tx) => bulkEditProductTags(tx, ids, add.data, remove.data), { timeout: 30_000 });
		res.json({ message: `برچسب ${count} محصول به‌روز شد.`, count });
	} catch (error) {
		next(error);
	}
});

adminTagsRouter.put('/categories/:id/tags', requireStaff, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		if (!(await prisma.category.findUnique({ where: { id } }))) return res.status(404).json({ message: 'دسته‌بندی پیدا نشد' });
		const optionIds = await readOptionIds(req.body?.optionIds);
		if (!optionIds.ok) return res.status(optionIds.status ?? 400).json({ message: optionIds.error });
		await prisma.$transaction((tx) => replaceCategoryTags(tx, id, optionIds.data));
		res.json({ message: 'برچسب‌های دسته ذخیره شد.' });
	} catch (error) {
		next(error);
	}
});

adminTagsRouter.put('/categories/:id/kind', requireStaff, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const kind: unknown = req.body?.kind;
		if (kind !== null && !isCategoryKind(kind)) return res.status(400).json({ message: 'نوع دسته نامعتبر است' });
		await prisma.category.update({ where: { id }, data: { kind } });
		res.json({ message: 'نوع دسته ذخیره شد.' });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'دسته‌بندی پیدا نشد' });
		next(error);
	}
});

adminTagsRouter.get('/tags/coverage', requireStaff, async (_req, res, next) => {
	try {
		res.json(await getTagCoverage());
	} catch (error) {
		next(error);
	}
});
