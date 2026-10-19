// The menu part of the seed: reads prisma/seed-data/menu.json (the same format `npm run db:export-menu`
// writes) and its images, and creates on an empty database:
//   - the «انتخاب برای من» questions (only when there is no tag group yet)
//   - the menu: types, add-ons, categories with their kind and tags, products with their images, add-ons and
//     tags (only when there is no category and no product yet: a running café's menu is never touched)
// To seed another café's menu: run `npm run db:export-menu` on its database and put the exported folder's
// contents (menu.json + images/) in prisma/seed-data/.
import fs from 'node:fs';
import path from 'node:path';
import { Prisma, type CategoryKind, type PrismaClient, type TagStrictness } from '@prisma/client';
import { PROJECT_ROOT } from '../src/lib/paths.js';
import { PRODUCTS_DIR } from '../src/lib/uploads.js';

const SEED_DIR = path.join(PROJECT_ROOT, 'prisma', 'seed-data');
const PLACEHOLDER = 'placeholder.png';

interface MenuExport {
	menuTypes: { ref: number; name: string; sortOrder: number; isActive: boolean }[];
	categories: { ref: number; name: string; menuTypeRef: number; kind: CategoryKind | null; tagOptionRefs: number[] }[];
	addOns: { ref: number; name: string; price: number; isActive: boolean }[];
	products: {
		ref: number;
		name: string;
		price: number;
		description: string;
		image: string;
		categoryRef: number;
		isAvailable: boolean;
		addOnRefs: number[];
		ownTagGroupRefs: number[];
		ownTagOptionRefs: number[];
	}[];
	tagGroups: {
		ref: number;
		key: string | null;
		name: string;
		question: string;
		questionByKind: Prisma.JsonValue | null;
		multi: boolean;
		/** Missing in exports made before scales existed. */
		ordered?: boolean;
		strictness: TagStrictness;
		importance: number;
		kinds: CategoryKind[];
		isActive: boolean;
		sortOrder: number;
		options: { ref: number; label: string; key: string | null; sortOrder: number }[];
	}[];
}

function readExport(): MenuExport | null {
	const file = path.join(SEED_DIR, 'menu.json');
	if (!fs.existsSync(file)) return null;
	return JSON.parse(fs.readFileSync(file, 'utf8')) as MenuExport;
}

async function seedTagGroups(prisma: PrismaClient, data: MenuExport): Promise<void> {
	if ((await prisma.tagGroup.count()) > 0) return;
	for (const group of data.tagGroups) {
		await prisma.tagGroup.create({
			data: {
				key: group.key,
				name: group.name,
				question: group.question,
				questionByKind: group.questionByKind === null ? Prisma.DbNull : (group.questionByKind as Prisma.InputJsonValue),
				multi: group.multi,
				ordered: group.ordered ?? false,
				strictness: group.strictness,
				importance: group.importance,
				kinds: group.kinds,
				isActive: group.isActive,
				sortOrder: group.sortOrder,
				options: { create: group.options.map((o) => ({ label: o.label, key: o.key, sortOrder: o.sortOrder })) },
			},
		});
	}
	console.log(`«انتخاب برای من»: ${data.tagGroups.length} گروه سوال ساخته شد.`);
}

/** Tag group / option refs of the file → ids in this database (matched by key, else by name / label). */
async function tagMaps(prisma: PrismaClient, data: MenuExport) {
	const dbGroups = await prisma.tagGroup.findMany({ include: { options: true } });
	const groupIds = new Map<number, number>();
	const optionIds = new Map<number, number>();
	for (const group of data.tagGroups) {
		const db = dbGroups.find((g) => (group.key ? g.key === group.key : g.name === group.name));
		if (!db) continue;
		groupIds.set(group.ref, db.id);
		for (const option of group.options) {
			const dbOption = db.options.find((o) => (option.key ? o.key === option.key : o.label === option.label));
			if (dbOption) optionIds.set(option.ref, dbOption.id);
		}
	}
	return { groupIds, optionIds };
}

/** Copies a product image into uploads/products (if it is not there yet); placeholder when the file is missing. */
function placeImage(image: string): string {
	if (!image || image === PLACEHOLDER) return PLACEHOLDER;
	const name = path.basename(image);
	const source = path.join(SEED_DIR, 'images', name);
	const target = path.join(PRODUCTS_DIR, name);
	if (fs.existsSync(target)) return name;
	if (!fs.existsSync(source)) return PLACEHOLDER;
	fs.mkdirSync(PRODUCTS_DIR, { recursive: true });
	fs.copyFileSync(source, target);
	return name;
}

async function seedMenu(prisma: PrismaClient, data: MenuExport): Promise<void> {
	if ((await prisma.category.count()) > 0 || (await prisma.product.count()) > 0) {
		console.log('منو از قبل وجود دارد؛ منوی seed اضافه نشد.');
		return;
	}
	const { groupIds, optionIds } = await tagMaps(prisma, data);
	const mapIds = (refs: number[], map: Map<number, number>) => refs.map((ref) => map.get(ref)).filter((id): id is number => id !== undefined);
	const images = new Map(data.products.map((p) => [p.ref, placeImage(p.image)]));

	await prisma.$transaction(
		async (tx) => {
			const typeIds = new Map<number, number>();
			for (const type of data.menuTypes) {
				const row = await tx.menuType.upsert({
					where: { name: type.name },
					update: { sortOrder: type.sortOrder, isActive: type.isActive },
					create: { name: type.name, sortOrder: type.sortOrder, isActive: type.isActive },
				});
				typeIds.set(type.ref, row.id);
			}
			const addOnIds = new Map<number, number>();
			for (const addOn of data.addOns) {
				const existing = await tx.addOn.findFirst({ where: { name: addOn.name } });
				const row = existing ?? (await tx.addOn.create({ data: { name: addOn.name, price: addOn.price, isActive: addOn.isActive } }));
				addOnIds.set(addOn.ref, row.id);
			}
			const categoryIds = new Map<number, number>();
			for (const category of data.categories) {
				const row = await tx.category.create({
					data: { name: category.name, menuTypeId: typeIds.get(category.menuTypeRef)!, kind: category.kind },
				});
				categoryIds.set(category.ref, row.id);
				const tags = mapIds(category.tagOptionRefs, optionIds);
				if (tags.length) await tx.categoryTagOption.createMany({ data: tags.map((optionId) => ({ categoryId: row.id, optionId })) });
			}
			for (const product of data.products) {
				const row = await tx.product.create({
					data: {
						name: product.name,
						price: product.price,
						description: product.description,
						image: images.get(product.ref) ?? PLACEHOLDER,
						categoryId: categoryIds.get(product.categoryRef)!,
						isAvailable: product.isAvailable,
						addOns: { create: mapIds(product.addOnRefs, addOnIds).map((addOnId, sortOrder) => ({ addOnId, sortOrder })) },
					},
				});
				const ownGroups = mapIds(product.ownTagGroupRefs, groupIds);
				if (ownGroups.length) await tx.productTagGroup.createMany({ data: ownGroups.map((groupId) => ({ productId: row.id, groupId })) });
				const ownOptions = mapIds(product.ownTagOptionRefs, optionIds);
				if (ownOptions.length) await tx.productTagOption.createMany({ data: ownOptions.map((optionId) => ({ productId: row.id, optionId })) });
			}
		},
		{ timeout: 120_000 },
	);
	const withImage = [...images.values()].filter((image) => image !== PLACEHOLDER).length;
	console.log(`منو: ${data.categories.length} دسته‌بندی، ${data.products.length} محصول (${withImage} با عکس)، ${data.addOns.length} افزودنی.`);
}

export async function seedMenuAndQuestions(prisma: PrismaClient): Promise<void> {
	const data = readExport();
	if (!data) {
		console.log('prisma/seed-data/menu.json نیست؛ منو و سوال‌های «انتخاب برای من» ساخته نشد.');
		return;
	}
	await seedTagGroups(prisma, data);
	await seedMenu(prisma, data);
}
