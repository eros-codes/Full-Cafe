import fs from 'fs/promises';
import path from 'path';
import sharp from 'sharp';
import { HttpError } from './http-error.js';
import { UPLOADS_DIR } from './paths.js';

// Product images live outside the web root's source folders, so a deploy never
// overwrites them and they are never committed. Served at /uploads/products/.
export const PRODUCTS_DIR = path.join(UPLOADS_DIR, 'products');
export const PRODUCTS_URL = '/uploads/products/';
export const PLACEHOLDER_IMAGE = 'placeholder.png';

/** Largest file the admin form accepts. Only the converted WebP is kept, so a phone photo of several MB is fine. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/**
 * Longest side of a stored product photo. The product dialog is at most 580 px wide on a computer and 430 px on a
 * phone, so 1200 px stays sharp on high-density screens; the cards show the same file at about 100–200 px.
 */
export const IMAGE_MAX_SIDE = 1200;
const WEBP_QUALITY = 80;
/**
 * A picture with more pixels is refused before it is decoded. A 48-megapixel phone photo fits; a small file that
 * unpacks into a huge picture (a "decompression bomb") would otherwise take the server's memory.
 */
const MAX_INPUT_PIXELS = 60_000_000;

// Every image is converted once; there is nothing worth keeping in sharp's memory cache.
sharp.cache(false);

// Only names the server itself generated are accepted (no paths, no dots tricks).
// jpg / png / gif are images stored before uploads were converted to WebP (see `npm run images:webp`).
const SAFE_NAME = /^(temp-)?\d{10,16}-\d{1,10}\.(jpg|png|webp|gif)$/;

export function isSafeImageName(name: unknown): name is string {
	return typeof name === 'string' && (name === PLACEHOLDER_IMAGE || SAFE_NAME.test(name));
}

export function isTempUpload(name: unknown): name is string {
	return typeof name === 'string' && name.startsWith('temp-') && SAFE_NAME.test(name);
}

/** A fresh, unique file name for a WebP product image (temp-… until a product uses it). */
export function newImageName({ temp }: { temp: boolean }): string {
	return `${temp ? 'temp-' : ''}${Date.now()}-${Math.floor(Math.random() * 1e9)}.webp`;
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
	try {
		await fs.rename(path.join(PRODUCTS_DIR, name), path.join(PRODUCTS_DIR, finalName));
	} catch (error) {
		// the same upload saved twice at once (two clicks, two tabs): the first one took it
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(400, 'فایل تصویر پیدا نشد؛ دوباره آپلود کن.');
		throw error;
	}
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
				// a file saved or deleted meanwhile (stat fails) is simply left alone
				const stats = await fs.stat(path.join(PRODUCTS_DIR, file)).catch(() => null);
				if (stats && stats.mtimeMs < cutoff) await fs.unlink(path.join(PRODUCTS_DIR, file)).catch(() => {});
			}),
		);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; // no upload yet
		console.error('پاک‌سازی آپلودهای موقت ناموفق بود:', error instanceof Error ? error.message : error);
	}
}

export type ImageKind = 'jpg' | 'png' | 'gif' | 'webp';

/**
 * The real type of an image from its first bytes (magic numbers), or null. The browser-supplied mimetype is not
 * trusted on its own, and only these four types ever reach the image decoder (not SVG, TIFF, HEIF…).
 */
export function sniffImage(bytes: Uint8Array): ImageKind | null {
	const head = Buffer.from(bytes.buffer, bytes.byteOffset, Math.min(bytes.length, 16));
	if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
	if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
	const gif = head.subarray(0, 6).toString('ascii');
	if (gif === 'GIF87a' || gif === 'GIF89a') return 'gif';
	if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
	return null;
}

/** A file that is not a usable picture; answered with 400 and this (Persian) message. */
export class ImageError extends HttpError {
	constructor(message: string) {
		super(400, message);
	}
}

const DECODABLE = new Set(['jpeg', 'png', 'gif', 'webp']);

/**
 * Re-encodes a jpg / png / gif / webp as WebP: turned upright by its EXIF orientation, at most IMAGE_MAX_SIDE on its
 * longest side (never enlarged), transparency and animation kept, and all metadata dropped (a phone photo's GPS
 * position, camera and date never reach the site). Re-encoding also means no byte of the uploaded file is ever
 * served as it was sent.
 */
export async function toWebp(input: Buffer): Promise<Buffer> {
	if (!sniffImage(input)) throw new ImageError('محتوای فایل یک تصویر معتبر نیست.');
	try {
		const image = sharp(input, { animated: true, limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error' });
		const { format } = await image.metadata();
		if (!format || !DECODABLE.has(format)) throw new ImageError('محتوای فایل یک تصویر معتبر نیست.');
		return await image
			.rotate()
			.resize({ width: IMAGE_MAX_SIDE, height: IMAGE_MAX_SIDE, fit: 'inside', withoutEnlargement: true })
			.webp({ quality: WEBP_QUALITY })
			.toBuffer();
	} catch (error) {
		if (error instanceof ImageError) throw error;
		if (error instanceof Error && /pixel limit/i.test(error.message)) {
			throw new ImageError('ابعاد این تصویر خیلی بزرگ است؛ عکسی با ابعاد کوچک‌تر انتخاب کن.');
		}
		throw new ImageError('فایل تصویر خراب است یا خوانده نشد؛ عکس دیگری انتخاب کن.');
	}
}

/**
 * Whether a stored image already is what an upload becomes today: a WebP within IMAGE_MAX_SIDE, without metadata.
 * Such a file is kept as it is instead of being encoded again (every new encoding loses a little quality).
 */
export async function isFinalWebp(input: Buffer): Promise<boolean> {
	if (sniffImage(input) !== 'webp') return false;
	try {
		const meta = await sharp(input, { animated: true, limitInputPixels: MAX_INPUT_PIXELS }).metadata();
		const width = meta.width ?? Infinity;
		const height = meta.pageHeight ?? meta.height ?? Infinity;
		return width <= IMAGE_MAX_SIDE && height <= IMAGE_MAX_SIDE && !meta.exif && !meta.xmp && !meta.icc;
	} catch {
		return false;
	}
}

/** Writes a WebP into uploads/products under a new name (never over an existing file) and returns the name. */
export async function writeProductImage(webp: Buffer, { temp }: { temp: boolean }): Promise<string> {
	await fs.mkdir(PRODUCTS_DIR, { recursive: true });
	const name = newImageName({ temp });
	await fs.writeFile(path.join(PRODUCTS_DIR, name), webp, { flag: 'wx' });
	return name;
}

/** An upload from the admin form: converted to WebP and saved as temp-….webp until a product uses it. */
export async function saveUploadedImage(input: Buffer): Promise<string> {
	return writeProductImage(await toWebp(input), { temp: true });
}
