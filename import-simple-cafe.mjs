import 'dotenv/config';
import fs from 'fs/promises';
import path from 'path';
import { randomInt } from 'crypto';
import { parseArgs } from 'util';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const { values: args } = parseArgs({
	options: {
		'old-db': { type: 'string' },
		images: { type: 'string' },
		'dry-run': { type: 'boolean', default: false },
	},
});

const OLD_DB = args['old-db'];
const IMAGES_DIR = args.images ? path.resolve(args.images) : null;
const DRY_RUN = args['dry-run'];
const PRODUCTS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'uploads', 'products');
const PLACEHOLDER_IMAGE = 'placeholder.png';
const MENU_TYPE_NAMES = { cafe: 'کافه', restaurant: 'رستوران', breakfast: 'صبحانه' };
const EXT_ALIASES = { jpg: 'jpg', jpeg: 'jpg', png: 'png', webp: 'webp', gif: 'gif' };

if (!OLD_DB) {
	console.error(
		'--old-db لازم است. مثال:\n  node import-simple-cafe.mjs --old-db "postgresql://roof_user:PASS@localhost:5432/roof" --images "..." --dry-run',
	);
	process.exit(1);
}
if (!process.env.DATABASE_URL) {
	console.error('DATABASE_URL در .env پیدا نشد؛ اسکریپت را از ریشه‌ی پروژه‌ی Roof اجرا کن.');
	process.exit(1);
}
if (
	new URL(OLD_DB).pathname === new URL(process.env.DATABASE_URL).pathname &&
	new URL(OLD_DB).host === new URL(process.env.DATABASE_URL).host
) {
	console.error('دیتابیس قدیمی و جدید یکی هستند؛ آدرس --old-db را چک کن.');
	process.exit(1);
}

const oldDb = new PrismaClient({ datasources: { db: { url: OLD_DB } } });
const db = new PrismaClient();
const warnings = [];
const copiedFiles = [];
const renamed = [];

function newImageName(ext) {
	return `${Date.now()}-${randomInt(1, 1_000_000_000)}.${ext}`;
}

// نوع واقعی تصویر از روی محتوای فایل تشخیص داده می‌شود، نه از پسوند اسمش.
// (در دیتابیس قدیمی اسم خیلی از عکس‌ها .png است ولی خود فایل‌ها ممکن است jpg باشند.)
async function sniffImageType(filePath) {
	const handle = await fs.open(filePath, 'r');
	try {
		const b = Buffer.alloc(16);
		await handle.read(b, 0, 16, 0);
		if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg';
		if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
		if (['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('ascii'))) return 'gif';
		if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
		return null;
	} finally {
		await handle.close();
	}
}

let folderIndex = null;
/** فایل عکس را در پوشه پیدا می‌کند: اول همان اسم، بعد بدون حساسیت به حروف، بعد همان اسم با هر پسوند تصویری دیگر. */
async function findImageFile(oldName) {
	if (!folderIndex) {
		const files = await fs.readdir(IMAGES_DIR);
		folderIndex = { exact: new Set(files), lower: new Map(), stem: new Map() };
		for (const file of files) {
			folderIndex.lower.set(file.toLowerCase(), file);
			const ext = path.extname(file).slice(1).toLowerCase();
			if (EXT_ALIASES[ext]) folderIndex.stem.set(path.basename(file, path.extname(file)).toLowerCase(), file);
		}
	}
	const base = path.basename(oldName);
	if (folderIndex.exact.has(base)) return base;
	if (folderIndex.lower.has(base.toLowerCase())) return folderIndex.lower.get(base.toLowerCase());
	return folderIndex.stem.get(path.basename(base, path.extname(base)).toLowerCase()) || null;
}

/** Copies one old product image into uploads/products under a new safe name. Returns the new name or the placeholder. */
async function importImage(oldName, productName) {
	if (!oldName || oldName === PLACEHOLDER_IMAGE) return PLACEHOLDER_IMAGE;
	if (!IMAGES_DIR) {
		warnings.push(`«${productName}»: پوشه‌ی عکس‌ها داده نشده (--images)؛ بدون عکس وارد شد.`);
		return PLACEHOLDER_IMAGE;
	}
	const found = await findImageFile(oldName);
	if (!found) {
		warnings.push(`«${productName}»: فایل «${oldName}» (با هیچ پسوندی) در پوشه‌ی عکس‌ها نبود؛ بدون عکس وارد شد.`);
		return PLACEHOLDER_IMAGE;
	}
	const source = path.join(IMAGES_DIR, found);
	const type = await sniffImageType(source);
	if (!type) {
		warnings.push(`«${productName}»: «${found}» تصویر jpg/png/webp/gif نیست؛ بدون عکس وارد شد.`);
		return PLACEHOLDER_IMAGE;
	}
	if (found !== path.basename(oldName)) renamed.push(`${oldName} → ${found}`);
	const name = newImageName(type);
	if (!DRY_RUN) {
		await fs.mkdir(PRODUCTS_DIR, { recursive: true });
		const target = path.join(PRODUCTS_DIR, name);
		await fs.copyFile(source, target);
		copiedFiles.push(target);
	}
	return name;
}

async function hasLocalImage(name) {
	if (!name || name === PLACEHOLDER_IMAGE || path.basename(name) !== name) return false;
	try {
		await fs.access(path.join(PRODUCTS_DIR, name));
		return true;
	} catch (error) {
		if (error.code === 'ENOENT') return false;
		throw error;
	}
}

async function main() {
	const tables = await oldDb.$queryRawUnsafe(
		`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('categories','products','reviews')`,
	);
	if (tables.length < 3) throw new Error('جدول‌های categories/products/reviews در دیتابیس قدیمی پیدا نشدند؛ آدرس --old-db را چک کن.');

	if (IMAGES_DIR) {
		const stat = await fs.stat(IMAGES_DIR).catch(() => null);
		// بدون این چک، با مسیر اشتباه همه‌ی محصولات بی‌عکس وارد می‌شدند
		if (!stat?.isDirectory()) throw new Error(`پوشه‌ی عکس‌ها پیدا نشد: ${IMAGES_DIR}`);
	}

	const oldCategories = await oldDb.$queryRawUnsafe(`SELECT id, name, type, "createdAt" FROM categories ORDER BY id`);
	const oldProducts = await oldDb.$queryRawUnsafe(
		`SELECT id, name, price, description, image, "categoryId", "createdAt" FROM products ORDER BY id`,
	);
	const oldReviews = await oldDb.$queryRawUnsafe(`SELECT name, text, reply, visible, "createdAt" FROM reviews ORDER BY id`);
	const oldTypes = new Set(oldCategories.map((category) => category.type));
	const menuTypes = await db.menuType.findMany({
		where: { name: { in: [...oldTypes].map((type) => MENU_TYPE_NAMES[type]).filter(Boolean) } },
		select: { id: true, name: true },
	});
	const menuTypeIds = new Map(menuTypes.map((menuType) => [menuType.name, menuType.id]));
	const missingMenuTypes = [...oldTypes]
		.filter((type) => MENU_TYPE_NAMES[type] && !menuTypeIds.has(MENU_TYPE_NAMES[type]))
		.map((type) => MENU_TYPE_NAMES[type]);
	if (missingMenuTypes.length) {
		throw new Error(`نوع منوی مقصد پیدا نشد: ${missingMenuTypes.join('، ')}. ابتدا این منوها را در پنل ادمین ایجاد کنید.`);
	}
	console.log(`دیتابیس قدیمی: ${oldCategories.length} دسته، ${oldProducts.length} محصول، ${oldReviews.length} نظر`);
	if (DRY_RUN) console.log('حالت آزمایشی (--dry-run): چیزی نوشته نمی‌شود.\n');

	// ─── plan (images are copied here, before the database transaction) ───────────
	const plan = { categories: [], products: [], existingProductImages: [], reviews: [] };
	const report = { categories: 0, categoriesExisting: 0, products: 0, productsSkipped: 0, reviews: 0, reviewsSkipped: 0, images: 0, imagesRestored: 0 };

	for (const c of oldCategories) {
		const name = String(c.name || '').trim();
		const menuTypeName = MENU_TYPE_NAMES[c.type];
		const menuTypeId = menuTypeIds.get(menuTypeName);
		if (!name || !menuTypeId) {
			warnings.push(`دسته‌ی «${c.name}» (نوع «${c.type}») نامعتبر است؛ خودش و محصولاتش وارد نشدند.`);
			continue;
		}
		const existing = await db.category.findFirst({ where: { name, menuTypeId } });
		plan.categories.push({ oldId: c.id, name, menuTypeId, createdAt: c.createdAt, existingId: existing?.id ?? null });
		if (existing) report.categoriesExisting += 1;
	}
	const planned = new Map(plan.categories.map((c) => [c.oldId, c]));

	for (const p of oldProducts) {
		const category = planned.get(p.categoryId);
		const name = String(p.name || '').trim();
		const price = Number(p.price);
		if (!category || !name || !Number.isInteger(price) || price < 0) {
			if (category) warnings.push(`محصول «${p.name}» (قیمت ${p.price}) نامعتبر است؛ وارد نشد.`);
			report.productsSkipped += 1;
			continue;
		}
		if (category.existingId) {
			const existingProduct = await db.product.findFirst({
				where: { name, categoryId: category.existingId },
				select: { id: true, image: true },
			});
			if (existingProduct) {
				report.productsSkipped += 1; // already imported earlier
				if (p.image && p.image !== PLACEHOLDER_IMAGE && !(await hasLocalImage(existingProduct.image))) {
					const image = await importImage(p.image, name);
					if (image !== PLACEHOLDER_IMAGE) {
						plan.existingProductImages.push({ id: existingProduct.id, image });
						report.imagesRestored += 1;
					}
				}
				continue;
			}
		}
		const image = await importImage(p.image, name);
		if (image !== PLACEHOLDER_IMAGE) report.images += 1;
		plan.products.push({
			name,
			price,
			description: String(p.description || '').trim(),
			image,
			categoryOldId: p.categoryId,
			createdAt: p.createdAt,
		});
	}

	for (const r of oldReviews) {
		const text = String(r.text || '').trim();
		if (!text) {
			report.reviewsSkipped += 1;
			continue;
		}
		if (await db.review.findFirst({ where: { text, createdAt: r.createdAt } })) {
			report.reviewsSkipped += 1;
			continue;
		}
		plan.reviews.push({
			name: r.name && String(r.name).trim() ? String(r.name).trim() : null,
			text,
			reply: r.reply && String(r.reply).trim() ? String(r.reply).trim() : null,
			visible: Boolean(r.visible),
			createdAt: r.createdAt,
		});
	}

	report.categories = plan.categories.filter((c) => !c.existingId).length;
	report.products = plan.products.length;
	report.reviews = plan.reviews.length;

	// ─── write everything in one transaction: all or nothing ──────────────────────
	if (!DRY_RUN) {
		await db.$transaction(async (tx) => {
			const idMap = new Map();
			for (const c of plan.categories) {
				const id = c.existingId ?? (await tx.category.create({ data: { name: c.name, menuTypeId: c.menuTypeId, createdAt: c.createdAt } })).id;
				idMap.set(c.oldId, id);
			}
			for (const p of plan.products) {
				await tx.product.create({
					data: {
						name: p.name,
						price: p.price,
						description: p.description,
						image: p.image,
						categoryId: idMap.get(p.categoryOldId),
						createdAt: p.createdAt,
					},
				});
			}
			for (const p of plan.existingProductImages) {
				await tx.product.update({ where: { id: p.id }, data: { image: p.image } });
			}
			for (const r of plan.reviews) await tx.review.create({ data: r });
		});
	}

	console.log(DRY_RUN ? '\nنتیجه‌ی آزمایشی (اگر بدون --dry-run اجرا شود):' : '\nانجام شد:');
	console.log(`  دسته‌بندی: ${report.categories} جدید، ${report.categoriesExisting} از قبل موجود`);
	console.log(`  محصول:     ${report.products} وارد شد (${report.images} با عکس)، ${report.productsSkipped} از قبل موجود`);
	console.log(`  عکس:       ${report.imagesRestored} به محصول موجود وصل شد`);
	console.log(`  نظر:       ${report.reviews} وارد شد، ${report.reviewsSkipped} رد شد`);
	if (renamed.length) console.log(`\n${renamed.length} عکس با اسم/پسوند متفاوت از دیتابیس پیدا شد (مثلاً ${renamed[0]}).`);
	if (warnings.length) console.log(`\nهشدارها:\n  - ${warnings.join('\n  - ')}`);
}

main()
	.catch(async (error) => {
		// اگر نوشتن در دیتابیس شکست خورد، عکس‌های کپی‌شده هم برداشته می‌شوند تا چیزی نیمه‌کاره نماند
		await Promise.all(copiedFiles.map((file) => fs.unlink(file).catch(() => {})));
		console.error('\nخطا؛ هیچ چیزی وارد نشد:', error.message);
		process.exitCode = 1;
	})
	.finally(async () => {
		await oldDb.$disconnect();
		await db.$disconnect();
	});
