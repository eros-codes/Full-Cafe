// Converts the product photos stored before uploads became WebP (jpg, png, gif, or a WebP larger than 1200 px or
// with metadata) into exactly what a new upload becomes, points each product at its new file and deletes the old one.
//
//   npm run images:webp                 → converts
//   npm run images:webp -- --dry-run    → only reports what would change
//
// Safe to run again (converted photos are skipped) and while the site runs. A menu page already open in a browser
// keeps the old addresses until it is reloaded, so it is best run before opening or after closing time.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { PLACEHOLDER_IMAGE, PRODUCTS_DIR, isFinalWebp, removeImage, toWebp, writeProductImage } from '../src/lib/uploads.js';

const dryRun = process.argv.includes('--dry-run');
const kb = (bytes: number) => `${Math.round(bytes / 1024).toLocaleString('en-US')} KB`;

async function main() {
	const products = await prisma.product.findMany({
		where: { image: { not: PLACEHOLDER_IMAGE } },
		select: { id: true, name: true, image: true },
		orderBy: { id: 'asc' },
	});
	let converted = 0;
	let alreadyWebp = 0;
	let changedMeanwhile = 0;
	let bytesBefore = 0;
	let bytesAfter = 0;
	const missing: string[] = [];
	const failed: string[] = [];

	for (const product of products) {
		// the stored value is only a file name; basename keeps any odd value inside the folder
		const file = path.basename(product.image);
		let input: Buffer;
		try {
			input = await fs.readFile(path.join(PRODUCTS_DIR, file));
		} catch {
			missing.push(`«${product.name}» (${product.image})`);
			continue;
		}
		if (await isFinalWebp(input)) {
			alreadyWebp++;
			continue;
		}
		let webp: Buffer;
		try {
			webp = await toWebp(input);
		} catch (error) {
			failed.push(`«${product.name}» (${product.image}): ${error instanceof Error ? error.message : error}`);
			continue;
		}
		bytesBefore += input.length;
		bytesAfter += webp.length;
		if (dryRun) {
			converted++;
			continue;
		}
		const name = await writeProductImage(webp, { temp: false });
		// only if the product still has the old photo (it may have been changed in the panel meanwhile)
		const { count } = await prisma.product.updateMany({ where: { id: product.id, image: product.image }, data: { image: name } });
		if (count === 0) {
			await removeImage(name);
			changedMeanwhile++;
			continue;
		}
		// the old file goes once no product uses it any more
		if ((await prisma.product.count({ where: { image: product.image } })) === 0) {
			await removeImage(file);
			// a name the server would not have made (e.g. from an old import) is not removed by removeImage
			await fs.unlink(path.join(PRODUCTS_DIR, file)).catch(() => {});
		}
		converted++;
	}

	const verb = dryRun ? 'would be converted' : 'converted';
	console.log(`${products.length} products with a photo: ${converted} ${verb}, ${alreadyWebp} already WebP.`);
	if (converted) console.log(`size of those photos: ${kb(bytesBefore)} → ${kb(bytesAfter)}`);
	if (changedMeanwhile) console.log(`${changedMeanwhile} left as they are: their photo was changed in the panel meanwhile.`);
	if (missing.length) console.log(`file not found in uploads/products (left as they are):\n  ${missing.join('\n  ')}`);
	if (failed.length) {
		console.log(`could not be read (left as they are; upload a new photo in the panel):\n  ${failed.join('\n  ')}`);
		process.exitCode = 1;
	}
	if (dryRun && converted) console.log('Nothing was changed (--dry-run). Run `npm run images:webp` to convert.');
}

main()
	.catch((error) => {
		console.error(error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
