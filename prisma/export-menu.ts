// Exports the whole menu of this database into a folder, so it can be turned into seed data:
//
//   npm run db:export-menu            → menu-export/menu.json + menu-export/images/
//
// Exported: menu types, categories (with their kind and tags), add-ons, products (price, description, image,
// add-ons, sold out, own tags) and the «انتخاب برای من» questions. Nothing else: no admins, customers,
// reservations, reviews or settings. The JSON is written as UTF-8 by the script itself (a PowerShell `>`
// redirect would write UTF-16). The folder is in .gitignore.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PROJECT_ROOT } from '../src/lib/paths.js';
import { PRODUCTS_DIR } from '../src/lib/uploads.js';

const prisma = new PrismaClient();
const OUT_DIR = path.join(PROJECT_ROOT, 'menu-export');
const IMAGES_DIR = path.join(OUT_DIR, 'images');
const PLACEHOLDER = 'placeholder.png';

async function main() {
	const [menuTypes, categories, addOns, products, tagGroups] = await Promise.all([
		prisma.menuType.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] }),
		prisma.category.findMany({ orderBy: { id: 'asc' }, include: { tags: { select: { optionId: true } } } }),
		prisma.addOn.findMany({ orderBy: { id: 'asc' } }),
		prisma.product.findMany({
			orderBy: { id: 'asc' },
			include: {
				addOns: { orderBy: { sortOrder: 'asc' }, select: { addOnId: true } },
				tagGroups: { select: { groupId: true } },
				tags: { select: { optionId: true } },
			},
		}),
		prisma.tagGroup.findMany({
			orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
			include: { options: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] } },
		}),
	]);

	fs.rmSync(OUT_DIR, { recursive: true, force: true });
	fs.mkdirSync(IMAGES_DIR, { recursive: true });

	// the product images that exist on disk are copied next to the JSON
	const missingImages: string[] = [];
	let copied = 0;
	for (const product of products) {
		if (!product.image || product.image === PLACEHOLDER) continue;
		const source = path.join(PRODUCTS_DIR, path.basename(product.image));
		if (fs.existsSync(source)) {
			fs.copyFileSync(source, path.join(IMAGES_DIR, path.basename(product.image)));
			copied++;
		} else missingImages.push(product.image);
	}

	// ids are kept only as references inside this file (the seed gives everything new ids)
	const data = {
		exportedAt: new Date().toISOString(),
		menuTypes: menuTypes.map((t) => ({ ref: t.id, name: t.name, sortOrder: t.sortOrder, isActive: t.isActive })),
		categories: categories.map((c) => ({
			ref: c.id,
			name: c.name,
			menuTypeRef: c.menuTypeId,
			kind: c.kind,
			tagOptionRefs: c.tags.map((t) => t.optionId),
		})),
		addOns: addOns.map((a) => ({ ref: a.id, name: a.name, price: a.price, isActive: a.isActive })),
		products: products.map((p) => ({
			ref: p.id,
			name: p.name,
			price: p.price,
			description: p.description,
			image: p.image,
			categoryRef: p.categoryId,
			isAvailable: p.isAvailable,
			addOnRefs: p.addOns.map((a) => a.addOnId),
			ownTagGroupRefs: p.tagGroups.map((g) => g.groupId),
			ownTagOptionRefs: p.tags.map((t) => t.optionId),
		})),
		tagGroups: tagGroups.map((g) => ({
			ref: g.id,
			key: g.key,
			name: g.name,
			question: g.question,
			questionByKind: g.questionByKind,
			multi: g.multi,
			ordered: g.ordered,
			strictness: g.strictness,
			importance: g.importance,
			kinds: g.kinds,
			isActive: g.isActive,
			sortOrder: g.sortOrder,
			options: g.options.map((o) => ({ ref: o.id, label: o.label, key: o.key, sortOrder: o.sortOrder })),
		})),
	};
	fs.writeFileSync(path.join(OUT_DIR, 'menu.json'), JSON.stringify(data, null, '\t') + '\n', 'utf8');

	console.log(`menu-export/menu.json: ${menuTypes.length} menu types, ${categories.length} categories, ${products.length} products, ${addOns.length} add-ons, ${tagGroups.length} tag groups`);
	console.log(`menu-export/images: ${copied} images`);
	if (missingImages.length) console.log(`not found in uploads/products (left out): ${missingImages.join(', ')}`);
	console.log('Zip the menu-export folder and send it.');
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
