import fs from 'fs/promises';
import path from 'path';
import { UPLOADS_DIR } from './paths.js';

// Product images live outside the web root's source folders, so a deploy never
// overwrites them and they are never committed. Served at /uploads/products/.
export const PRODUCTS_DIR = path.join(UPLOADS_DIR, 'products');
export const PRODUCTS_URL = '/uploads/products/';
export const PLACEHOLDER_IMAGE = 'placeholder.png';

// Only names the server itself generated are accepted (no paths, no dots tricks).
const SAFE_NAME = /^(temp-)?\d{10,16}-\d{1,10}\.(jpg|png|webp|gif)$/;

export function isSafeImageName(name: unknown): name is string {
	return typeof name === 'string' && (name === PLACEHOLDER_IMAGE || SAFE_NAME.test(name));
}

export function isTempUpload(name: unknown): name is string {
	return typeof name === 'string' && name.startsWith('temp-') && SAFE_NAME.test(name);
}

export async function removeImage(name: string | null | undefined): Promise<void> {
	if (!name || name === PLACEHOLDER_IMAGE || !SAFE_NAME.test(name)) return;
	await fs.unlink(path.join(PRODUCTS_DIR, name)).catch(() => {});
}

/**
 * A freshly uploaded file is named temp-…; once a product really uses it, it is
 * renamed to its permanent name so the stale-temp cleanup never deletes it.
 */
export async function promoteTempImage(name: string): Promise<string> {
	if (!isTempUpload(name)) return name;
	const finalName = name.slice('temp-'.length);
	await fs.rename(path.join(PRODUCTS_DIR, name), path.join(PRODUCTS_DIR, finalName));
	return finalName;
}

export async function imageExists(name: string): Promise<boolean> {
	if (name === PLACEHOLDER_IMAGE) return true;
	try {
		await fs.access(path.join(PRODUCTS_DIR, name));
		return true;
	} catch {
		return false;
	}
}

/** Deletes temp uploads older than a day that no product ended up using. */
export async function cleanupStaleTempUploads(): Promise<void> {
	try {
		const files = await fs.readdir(PRODUCTS_DIR);
		const cutoff = Date.now() - 24 * 60 * 60 * 1000;
		await Promise.all(
			files.filter(isTempUpload).map(async (file) => {
				const stats = await fs.stat(path.join(PRODUCTS_DIR, file));
				if (stats.mtimeMs < cutoff) await fs.unlink(path.join(PRODUCTS_DIR, file)).catch(() => {});
			}),
		);
	} catch (error) {
		console.error('پاک‌سازی آپلودهای موقت ناموفق بود:', error instanceof Error ? error.message : error);
	}
}

// Magic numbers: the browser-supplied mimetype is not trusted on its own.
const SIGNATURES: Record<string, (b: Buffer) => boolean> = {
	jpg: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
	png: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
	gif: (b) => b.subarray(0, 6).toString('ascii') === 'GIF87a' || b.subarray(0, 6).toString('ascii') === 'GIF89a',
	webp: (b) => b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP',
};

export async function fileMatchesExtension(filePath: string): Promise<boolean> {
	const ext = path.extname(filePath).slice(1);
	const check = SIGNATURES[ext];
	if (!check) return false;
	const handle = await fs.open(filePath, 'r');
	try {
		const buffer = Buffer.alloc(16);
		await handle.read(buffer, 0, 16, 0);
		return check(buffer);
	} finally {
		await handle.close();
	}
}
