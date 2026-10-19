import express from 'express';
import multer from 'multer';
import fs from 'fs/promises';
import type { CategoryKind, Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { createHttpError, prismaCode } from '../../lib/http-error.js';
import { currentAdmin } from '../../lib/request.js';
import { requireRole } from '../../middleware/auth.js';
import { ROLE_GROUPS } from '../../lib/roles.js';
import {
	invalidateRecommenderCache,
	isCategoryKind,
	readOptionIds,
	readProductTags,
	replaceCategoryTags,
	replaceProductTags,
	type ProductTagsInput,
} from '../../services/recommender.service.js';
import {
	PLACEHOLDER_IMAGE,
	PRODUCTS_DIR,
	cleanupStaleTempUploads,
	fileMatchesExtension,
	imageExists,
	isSafeImageName,
	isTempUpload,
	promoteTempImage,
	removeImage,
} from '../../lib/uploads.js';

// Menu types, categories, add-ons, products, reviews and image upload for the admin panel.
// Mounted inside adminRouter, so requireAdmin has already run.
export const adminMenuRouter = express.Router();
adminMenuRouter.use(
	['/products', '/categories', '/menu-types', '/addons', '/reviews', '/upload'],
	requireRole(...ROLE_GROUPS.staff),
);
// Any successful change to the menu also changes what «انتخاب برای من» suggests: drop its cache at once.
adminMenuRouter.use((req, res, next) => {
	if (req.method !== 'GET') {
		res.on('finish', () => {
			if (res.statusCode < 400) invalidateRecommenderCache();
		});
	}
	next();
});
// The menu's top-level structure (its tabs) is a manager decision; staff can read it for their forms.
const requireManager = requireRole(...ROLE_GROUPS.manager);

const NAME_MAX = 80;
const MENU_TYPE_NAME_MAX = 40;
const DESCRIPTION_MAX = 500;
const PRICE_MAX = 1_000_000_000;
const ADDONS_PER_PRODUCT_MAX = 30;

type InputResult<T> = { ok: true; data: T } | { ok: false; error: string; status?: number };

function parseId(value: unknown): number | null {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}

function readPrice(value: unknown): number | null {
	const n = Number(value);
	if (value === '' || value === null || value === undefined || !Number.isInteger(n) || n < 0 || n > PRICE_MAX) return null;
	return n;
}

// ─── Upload ───────────────────────────────────────────────────────────────────

// Map, not a plain object: a mimetype such as "constructor" must not match an Object.prototype key
const EXT_BY_MIME = new Map([
	['image/jpeg', '.jpg'],
	['image/png', '.png'],
	['image/webp', '.webp'],
	['image/gif', '.gif'],
]);

const upload = multer({
	storage: multer.diskStorage({
		destination: async (_req, _file, cb) => {
			try {
				await fs.mkdir(PRODUCTS_DIR, { recursive: true });
				cb(null, PRODUCTS_DIR);
			} catch (error) {
				cb(error as Error, PRODUCTS_DIR);
			}
		},
		filename: (_req, file, cb) => {
			cb(null, `temp-${Date.now()}-${Math.round(Math.random() * 1e9)}${EXT_BY_MIME.get(file.mimetype) ?? '.jpg'}`);
		},
	}),
	fileFilter: (_req, file, cb) => {
		if (EXT_BY_MIME.has(file.mimetype)) return cb(null, true);
		cb(createHttpError(400, 'فقط فایل‌های تصویری مجاز است (jpg, png, webp, gif)'));
	},
	limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

adminMenuRouter.post('/upload', (req, res, next) => {
	upload.single('image')(req, res, async (error: unknown) => {
		if (error) {
			if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
				return res.status(413).json({ message: 'حجم فایل بیشتر از ۵ مگابایت است.' });
			}
			if (error instanceof multer.MulterError) return res.status(400).json({ message: 'آپلود فایل نامعتبر بود.' });
			return next(error);
		}
		try {
			if (!req.file) return res.status(400).json({ message: 'فایلی ارسال نشد' });
			// نوع فایل از روی محتوای واقعی‌اش چک می‌شود، نه فقط چیزی که مرورگر ادعا می‌کند
			if (!(await fileMatchesExtension(req.file.path))) {
				await fs.unlink(req.file.path).catch(() => {});
				return res.status(400).json({ message: 'محتوای فایل یک تصویر معتبر نیست.' });
			}
			cleanupStaleTempUploads();
			res.json({ filename: req.file.filename });
		} catch (err) {
			if (req.file?.path) await fs.unlink(req.file.path).catch(() => {});
			next(err);
		}
	});
});

// ─── Menu types (the tabs on the menu page: café, breakfast, restaurant, …) ──

const MENU_TYPE_ORDER = [{ sortOrder: 'asc' }, { id: 'asc' }] satisfies Prisma.MenuTypeOrderByWithRelationInput[];

interface MenuTypeFields {
	name: string;
	isActive?: boolean;
}

function readMenuTypeInput(body: unknown, partial: false): InputResult<MenuTypeFields>;
function readMenuTypeInput(body: unknown, partial: true): InputResult<Partial<MenuTypeFields>>;
function readMenuTypeInput(body: unknown, partial: boolean): InputResult<Partial<MenuTypeFields>> {
	const data: Partial<MenuTypeFields> = {};
	const { name, isActive } = (body ?? {}) as Record<string, unknown>;
	if (name !== undefined || !partial) {
		if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'نام دسته‌ی اصلی الزامی است' };
		if (name.trim().length > MENU_TYPE_NAME_MAX) return { ok: false, error: `نام دسته‌ی اصلی حداکثر ${MENU_TYPE_NAME_MAX} کاراکتر است` };
		data.name = name.trim();
	}
	if (isActive !== undefined) {
		if (typeof isActive !== 'boolean') return { ok: false, error: 'وضعیت نمایش نامعتبر است' };
		data.isActive = isActive;
	}
	return { ok: true, data };
}

adminMenuRouter.get('/menu-types', async (_req, res, next) => {
	try {
		const menuTypes = await prisma.menuType.findMany({
			orderBy: MENU_TYPE_ORDER,
			include: { _count: { select: { categories: true } } },
		});
		res.json({ menuTypes });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.post('/menu-types', requireManager, async (req, res, next) => {
	try {
		const input = readMenuTypeInput(req.body, false);
		if (!input.ok) return res.status(400).json({ message: input.error });
		// دسته‌ی تازه آخر ردیف تب‌ها می‌نشیند
		const last = await prisma.menuType.aggregate({ _max: { sortOrder: true } });
		const menuType = await prisma.menuType.create({ data: { ...input.data, sortOrder: (last._max.sortOrder ?? -1) + 1 } });
		res.status(201).json({ menuType });
	} catch (error) {
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'دسته‌ی اصلی با این نام از قبل وجود دارد' });
		next(error);
	}
});

// ترتیب تب‌ها: لیست کامل شناسه‌ها به ترتیب دلخواه
adminMenuRouter.put('/menu-types/order', requireManager, async (req, res, next) => {
	try {
		const raw: unknown = req.body?.ids;
		const ids = Array.isArray(raw) ? raw.map(parseId) : [];
		const existing = await prisma.menuType.findMany({ select: { id: true } });
		const valid =
			ids.length === existing.length &&
			ids.every((id): id is number => id !== null) &&
			new Set(ids).size === ids.length &&
			existing.every((type: { id: number }) => ids.includes(type.id));
		if (!valid) return res.status(400).json({ message: 'ترتیب باید شامل همه‌ی دسته‌های اصلی، هر کدام یک بار، باشد' });
		await prisma.$transaction(ids.map((id, index) => prisma.menuType.update({ where: { id: id as number }, data: { sortOrder: index } })));
		res.json({ menuTypes: await prisma.menuType.findMany({ orderBy: MENU_TYPE_ORDER }) });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.patch('/menu-types/:id', requireManager, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const input = readMenuTypeInput(req.body, true);
		if (!input.ok) return res.status(400).json({ message: input.error });
		const menuType = await prisma.menuType.update({ where: { id }, data: input.data });
		res.json({ menuType });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'دسته‌ی اصلی پیدا نشد' });
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'دسته‌ی اصلی با این نام از قبل وجود دارد' });
		next(error);
	}
});

// دسته‌ی اصلی فقط وقتی خالی است حذف می‌شود؛ دسته‌بندی‌هایش را اول جابه‌جا یا حذف کن
adminMenuRouter.delete('/menu-types/:id', requireManager, async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const menuType = await prisma.menuType.findUnique({ where: { id }, include: { _count: { select: { categories: true } } } });
		if (!menuType) return res.status(404).json({ message: 'دسته‌ی اصلی پیدا نشد' });
		const count = menuType._count.categories;
		if (count > 0) {
			return res.status(409).json({
				message: `این دسته‌ی اصلی ${count} دسته‌بندی دارد؛ اول آن‌ها را به دسته‌ی دیگری منتقل یا حذف کن.`,
				categoryCount: count,
			});
		}
		await prisma.menuType.delete({ where: { id } });
		res.json({ message: 'دسته‌ی اصلی حذف شد.' });
	} catch (error) {
		// دسته‌بندی هم‌زمان اضافه شد (کلید خارجی Restrict)
		if (prismaCode(error) === 'P2003') return res.status(409).json({ message: 'این دسته‌ی اصلی همین الان دسته‌بندی پیدا کرد؛ دوباره تلاش کن.' });
		next(error);
	}
});

// ─── Categories ───────────────────────────────────────────────────────────────

interface CategoryFields {
	name: string;
	menuTypeId: number;
	/** Drink / food / dessert for «انتخاب برای من»; null = left out of it. */
	kind?: CategoryKind | null;
	/** Tags every product of the category inherits; undefined on PATCH = leave as is. */
	tagOptionIds?: number[];
}

async function readCategoryInput(body: unknown, partial: false): Promise<InputResult<CategoryFields>>;
async function readCategoryInput(body: unknown, partial: true): Promise<InputResult<Partial<CategoryFields>>>;
async function readCategoryInput(body: unknown, partial: boolean): Promise<InputResult<Partial<CategoryFields>>> {
	const data: Partial<CategoryFields> = {};
	const { name, menuTypeId, kind, tagOptionIds } = (body ?? {}) as Record<string, unknown>;
	if (name !== undefined || !partial) {
		if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'نام دسته‌بندی الزامی است' };
		if (name.trim().length > NAME_MAX) return { ok: false, error: `نام دسته‌بندی حداکثر ${NAME_MAX} کاراکتر است` };
		data.name = name.trim();
	}
	if (menuTypeId !== undefined || !partial) {
		const id = parseId(menuTypeId);
		if (!id) return { ok: false, error: 'دسته‌ی اصلی نامعتبر است' };
		if (!(await prisma.menuType.findUnique({ where: { id } }))) return { ok: false, error: 'دسته‌ی اصلی پیدا نشد', status: 404 };
		data.menuTypeId = id;
	}
	if (kind !== undefined) {
		if (kind !== null && kind !== '' && !isCategoryKind(kind)) return { ok: false, error: 'نوع دسته نامعتبر است' };
		data.kind = isCategoryKind(kind) ? kind : null;
	}
	if (tagOptionIds !== undefined) {
		const ids = await readOptionIds(tagOptionIds);
		if (!ids.ok) return ids;
		data.tagOptionIds = ids.data;
	}
	return { ok: true, data };
}

const categoryInclude = {
	_count: { select: { products: true } },
	menuType: { select: { id: true, name: true } },
	tags: { select: { optionId: true } },
} satisfies Prisma.CategoryInclude;

/** Admin shape: the category plus the ids of the tags its products inherit. */
function toAdminCategory({ tags, ...category }: Prisma.CategoryGetPayload<{ include: typeof categoryInclude }>) {
	return { ...category, tagOptionIds: tags.map((t) => t.optionId).sort((a, b) => a - b) };
}

adminMenuRouter.get('/categories', async (_req, res, next) => {
	try {
		const categories = await prisma.category.findMany({ orderBy: { id: 'asc' }, include: categoryInclude });
		res.json({ categories: categories.map(toAdminCategory) });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.post('/categories', async (req, res, next) => {
	try {
		const input = await readCategoryInput(req.body, false);
		if (!input.ok) return res.status(input.status ?? 400).json({ message: input.error });
		const adminId = currentAdmin(req).id;
		const { tagOptionIds, ...fields } = input.data;
		const category = await prisma.$transaction(async (tx) => {
			const created = await tx.category.create({ data: { ...fields, createdById: adminId, updatedById: adminId } });
			if (tagOptionIds) await replaceCategoryTags(tx, created.id, tagOptionIds);
			return tx.category.findUniqueOrThrow({ where: { id: created.id }, include: categoryInclude });
		});
		res.status(201).json({ category: toAdminCategory(category) });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.patch('/categories/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const input = await readCategoryInput(req.body, true);
		if (!input.ok) return res.status(input.status ?? 400).json({ message: input.error });
		const { tagOptionIds, ...fields } = input.data;
		const category = await prisma.$transaction(async (tx) => {
			await tx.category.update({ where: { id }, data: { ...fields, updatedById: currentAdmin(req).id } });
			if (tagOptionIds) await replaceCategoryTags(tx, id, tagOptionIds);
			return tx.category.findUniqueOrThrow({ where: { id }, include: categoryInclude });
		});
		res.json({ category: toAdminCategory(category) });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'دسته‌بندی پیدا نشد' });
		next(error);
	}
});

// قبلاً حذف دسته‌بندی بی‌صدا همه‌ی محصولاتش را هم پاک می‌کرد. حالا اگر محصول داشته
// باشد، فقط با ?withProducts=1 (بعد از تایید صریح در پنل) حذف می‌شود.
adminMenuRouter.delete('/categories/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const category = await prisma.category.findUnique({ where: { id }, include: { products: { select: { id: true, image: true } } } });
		if (!category) return res.status(404).json({ message: 'دسته‌بندی پیدا نشد' });
		const count = category.products.length;
		if (count > 0 && req.query.withProducts !== '1') {
			return res.status(409).json({ message: `این دسته ${count} محصول دارد.`, productCount: count });
		}
		await prisma.$transaction([prisma.product.deleteMany({ where: { categoryId: id } }), prisma.category.delete({ where: { id } })]);
		await Promise.all(category.products.map((p: { image: string | null }) => removeImage(p.image)));
		res.json({ message: 'دسته‌بندی حذف شد.', deletedProducts: count });
	} catch (error) {
		next(error);
	}
});

// ─── Add-ons (shared library: created once, attached to many products) ──────

interface AddOnFields {
	name: string;
	price: number;
	isActive?: boolean;
}

function readAddOnInput(body: unknown, partial: false): InputResult<AddOnFields>;
function readAddOnInput(body: unknown, partial: true): InputResult<Partial<AddOnFields>>;
function readAddOnInput(body: unknown, partial: boolean): InputResult<Partial<AddOnFields>> {
	const data: Partial<AddOnFields> = {};
	const { name, price, isActive } = (body ?? {}) as Record<string, unknown>;
	if (name !== undefined || !partial) {
		if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'نام افزودنی الزامی است' };
		if (name.trim().length > NAME_MAX) return { ok: false, error: `نام افزودنی حداکثر ${NAME_MAX} کاراکتر است` };
		data.name = name.trim();
	}
	if (price !== undefined || !partial) {
		const n = readPrice(price);
		// صفر مجاز است (مثلاً «بدون پیاز»)
		if (n === null) return { ok: false, error: 'قیمت افزودنی باید عدد صحیح صفر یا مثبت باشد' };
		data.price = n;
	}
	if (isActive !== undefined) {
		if (typeof isActive !== 'boolean') return { ok: false, error: 'وضعیت نمایش نامعتبر است' };
		data.isActive = isActive;
	}
	return { ok: true, data };
}

adminMenuRouter.get('/addons', async (_req, res, next) => {
	try {
		const addOns = await prisma.addOn.findMany({ orderBy: { id: 'asc' }, include: { _count: { select: { products: true } } } });
		res.json({ addOns });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.post('/addons', async (req, res, next) => {
	try {
		const input = readAddOnInput(req.body, false);
		if (!input.ok) return res.status(400).json({ message: input.error });
		res.status(201).json({ addOn: await prisma.addOn.create({ data: input.data }) });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.patch('/addons/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const input = readAddOnInput(req.body, true);
		if (!input.ok) return res.status(400).json({ message: input.error });
		res.json({ addOn: await prisma.addOn.update({ where: { id }, data: input.data }) });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'افزودنی پیدا نشد' });
		next(error);
	}
});

// افزودنیِ وصل به محصولات فقط با ?force=1 (بعد از تایید صریح در پنل) حذف می‌شود
adminMenuRouter.delete('/addons/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const addOn = await prisma.addOn.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
		if (!addOn) return res.status(404).json({ message: 'افزودنی پیدا نشد' });
		const count = addOn._count.products;
		if (count > 0 && req.query.force !== '1') {
			return res.status(409).json({ message: `این افزودنی به ${count} محصول وصل است.`, productCount: count });
		}
		await prisma.addOn.delete({ where: { id } });
		res.json({ message: 'افزودنی حذف شد.' });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'افزودنی پیدا نشد' });
		next(error);
	}
});

// ─── Products ─────────────────────────────────────────────────────────────────

interface ProductFields {
	name: string;
	price: number;
	description?: string;
	image?: string;
	categoryId: number;
	/** Attached add-ons in display order; undefined on PATCH means "leave as is". */
	addOnIds?: number[];
	/** Out of stock today (still listed, cannot be ordered or recommended). */
	isAvailable?: boolean;
	/** Tag groups the product sets itself; undefined on PATCH = leave as is. Groups not listed are inherited from the category. */
	tags?: ProductTagsInput[];
}

async function readAddOnIds(value: unknown): Promise<InputResult<number[]>> {
	if (!Array.isArray(value)) return { ok: false, error: 'لیست افزودنی‌ها نامعتبر است' };
	if (value.length > ADDONS_PER_PRODUCT_MAX) return { ok: false, error: `حداکثر ${ADDONS_PER_PRODUCT_MAX} افزودنی برای هر محصول` };
	const ids = value.map(parseId);
	if (!ids.every((id): id is number => id !== null)) return { ok: false, error: 'شناسه‌ی افزودنی نامعتبر است' };
	if (new Set(ids).size !== ids.length) return { ok: false, error: 'یک افزودنی دو بار انتخاب شده است' };
	if (ids.length && (await prisma.addOn.count({ where: { id: { in: ids } } })) !== ids.length) {
		return { ok: false, error: 'یکی از افزودنی‌ها پیدا نشد', status: 404 };
	}
	return { ok: true, data: ids };
}

/** Validates product input. `partial` = PATCH (fields optional). */
async function readProductInput(body: unknown, partial: false): Promise<InputResult<ProductFields>>;
async function readProductInput(body: unknown, partial: true, currentImage: string): Promise<InputResult<Partial<ProductFields>>>;
async function readProductInput(body: unknown, partial: boolean, currentImage: string | null = null): Promise<InputResult<Partial<ProductFields>>> {
	const data: Partial<ProductFields> = {};
	const { name, price, description, image, categoryId, addOnIds, isAvailable, tags } = (body ?? {}) as Record<string, unknown>;

	if (name !== undefined || !partial) {
		if (typeof name !== 'string' || !name.trim()) return { ok: false, error: 'نام محصول الزامی است' };
		if (name.trim().length > NAME_MAX) return { ok: false, error: `نام محصول حداکثر ${NAME_MAX} کاراکتر است` };
		data.name = name.trim();
	}
	if (price !== undefined || !partial) {
		const n = readPrice(price);
		if (n === null) return { ok: false, error: 'قیمت باید عدد صحیح و مثبت باشد' };
		data.price = n;
	}
	if (description !== undefined && description !== null) {
		if (typeof description !== 'string') return { ok: false, error: 'توضیحات نامعتبر است' };
		if (description.length > DESCRIPTION_MAX) return { ok: false, error: `توضیحات حداکثر ${DESCRIPTION_MAX} کاراکتر است` };
		data.description = description.trim();
	}
	if (image !== undefined && image !== null && image !== '') {
		// فقط نام فایل‌هایی که خود سرور ساخته پذیرفته می‌شود؛ مسیر دلخواه ممنوع
		if (!isSafeImageName(image)) return { ok: false, error: 'نام فایل تصویر نامعتبر است' };
		// فقط تصویر تازه آپلودشده، تصویر فعلی همین محصول یا «بدون تصویر». قبلاً می‌شد تصویر محصول
		// دیگری را داد؛ با حذف یکی از دو محصول، فایل مشترک پاک می‌شد و دیگری بی‌تصویر می‌ماند.
		if (image !== PLACEHOLDER_IMAGE && image !== currentImage && !isTempUpload(image)) {
			return { ok: false, error: 'تصویر باید از طریق آپلود همین فرم انتخاب شود.' };
		}
		if (!(await imageExists(image))) return { ok: false, error: 'فایل تصویر پیدا نشد؛ دوباره آپلود کن.' };
		data.image = image;
	}
	if (categoryId !== undefined || !partial) {
		const id = parseId(categoryId);
		if (!id) return { ok: false, error: 'شناسه دسته‌بندی نامعتبر است' };
		if (!(await prisma.category.findUnique({ where: { id } }))) return { ok: false, error: 'دسته‌بندی پیدا نشد', status: 404 };
		data.categoryId = id;
	}
	if (addOnIds !== undefined) {
		const ids = await readAddOnIds(addOnIds);
		if (!ids.ok) return ids;
		data.addOnIds = ids.data;
	}
	if (isAvailable !== undefined) {
		if (typeof isAvailable !== 'boolean') return { ok: false, error: 'وضعیت موجود بودن نامعتبر است' };
		data.isAvailable = isAvailable;
	}
	if (tags !== undefined) {
		const parsed = await readProductTags(tags);
		if (!parsed.ok) return parsed;
		data.tags = parsed.data;
	}
	return { ok: true, data };
}

const productInclude = {
	addOns: { orderBy: { sortOrder: 'asc' }, select: { addOnId: true } },
	tagGroups: { select: { groupId: true } },
	tags: { select: { optionId: true } },
} satisfies Prisma.ProductInclude;

type ProductWithAddOnIds = Prisma.ProductGetPayload<{ include: typeof productInclude }>;

/**
 * Admin shape: the product, the ids of its add-ons in display order, and its own tags (the groups it sets
 * itself and their options; every other group comes from the category).
 */
function toAdminProduct({ addOns, tagGroups, tags, ...product }: ProductWithAddOnIds) {
	return {
		...product,
		addOnIds: addOns.map((link) => link.addOnId),
		tagGroupIds: tagGroups.map((t) => t.groupId).sort((a, b) => a - b),
		tagOptionIds: tags.map((t) => t.optionId).sort((a, b) => a - b),
	};
}

function addOnLinks(ids: number[]) {
	return ids.map((addOnId, sortOrder) => ({ addOnId, sortOrder }));
}

adminMenuRouter.get('/products', async (_req, res, next) => {
	try {
		const products = await prisma.product.findMany({ orderBy: { id: 'asc' }, include: productInclude });
		res.json({ products: products.map(toAdminProduct) });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.post('/products', async (req, res, next) => {
	try {
		const input = await readProductInput(req.body, false);
		if (!input.ok) return res.status(input.status ?? 400).json({ message: input.error });
		const { addOnIds = [], tags, ...fields } = input.data;
		if (fields.image) fields.image = await promoteTempImage(fields.image);
		const adminId = currentAdmin(req).id;
		const product = await prisma.$transaction(async (tx) => {
			const created = await tx.product.create({
				data: { ...fields, createdById: adminId, updatedById: adminId, addOns: { create: addOnLinks(addOnIds) } },
			});
			if (tags?.length) await replaceProductTags(tx, created.id, tags);
			return tx.product.findUniqueOrThrow({ where: { id: created.id }, include: productInclude });
		});
		res.status(201).json({ product: toAdminProduct(product) });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.patch('/products/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const existing = await prisma.product.findUnique({ where: { id } });
		if (!existing) return res.status(404).json({ message: 'محصول یافت نشد' });

		const input = await readProductInput(req.body, true, existing.image);
		if (!input.ok) return res.status(input.status ?? 400).json({ message: input.error });
		const { addOnIds, tags, ...fields } = input.data;
		const imageChanged = fields.image !== undefined && fields.image !== existing.image;
		if (fields.image !== undefined && imageChanged) fields.image = await promoteTempImage(fields.image);
		else delete fields.image;

		const product = await prisma.$transaction(async (tx) => {
			await tx.product.update({
				where: { id },
				data: {
					...fields,
					updatedById: currentAdmin(req).id,
					// لیست افزودنی‌ها یکجا جایگزین می‌شود (ترتیب همان ترتیب ارسالی است)
					...(addOnIds ? { addOns: { deleteMany: {}, create: addOnLinks(addOnIds) } } : {}),
				},
			});
			if (tags) await replaceProductTags(tx, id, tags);
			return tx.product.findUniqueOrThrow({ where: { id }, include: productInclude });
		});
		// فایل قبلی فقط بعد از ذخیره‌ی موفق پاک می‌شود
		if (imageChanged) await removeImage(existing.image);
		res.json({ product: toAdminProduct(product) });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.delete('/products/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const existing = await prisma.product.findUnique({ where: { id } });
		if (!existing) return res.status(404).json({ message: 'محصول یافت نشد' });
		await prisma.product.delete({ where: { id } });
		await removeImage(existing.image);
		res.json({ message: 'محصول حذف شد.' });
	} catch (error) {
		next(error);
	}
});

// ─── Reviews ──────────────────────────────────────────────────────────────────

adminMenuRouter.get('/reviews', async (_req, res, next) => {
	try {
		res.json({ reviews: await prisma.review.findMany({ orderBy: { createdAt: 'desc' } }) });
	} catch (error) {
		next(error);
	}
});

adminMenuRouter.patch('/reviews/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		const { visible, reply } = req.body || {};
		if (visible !== undefined && typeof visible !== 'boolean') return res.status(400).json({ message: 'مقدار visible باید boolean باشد' });
		if (reply !== undefined && reply !== null && typeof reply !== 'string') {
			return res.status(400).json({ message: 'متن پاسخ نامعتبر است' });
		}
		if (typeof reply === 'string' && reply.length > 500) return res.status(400).json({ message: 'پاسخ حداکثر ۵۰۰ کاراکتر است' });
		const data: Prisma.ReviewUncheckedUpdateInput = { updatedById: currentAdmin(req).id };
		if (visible !== undefined) data.visible = visible;
		// پاسخ خالی یعنی حذف پاسخ
		if (reply !== undefined) data.reply = typeof reply === 'string' && reply.trim() ? reply.trim() : null;
		const review = await prisma.review.update({ where: { id }, data });
		res.json({ review });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'نظر یافت نشد' });
		next(error);
	}
});

adminMenuRouter.delete('/reviews/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه نامعتبر است' });
		await prisma.review.delete({ where: { id } });
		res.json({ message: 'نظر حذف شد.' });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'نظر یافت نشد' });
		next(error);
	}
});
