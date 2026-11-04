// Product photos: every upload is re-encoded as WebP (src/lib/uploads.ts). No database needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { IMAGE_MAX_SIDE, ImageError, isFinalWebp, isSafeImageName, isTempUpload, newImageName, sniffImage, toWebp } from '../src/lib/uploads.js';

const solid = (width: number, height: number, channels: 3 | 4 = 3) =>
	sharp({ create: { width, height, channels, background: channels === 4 ? { r: 200, g: 40, b: 40, alpha: 0.4 } : '#c84' } });

describe('product photos become WebP', () => {
	test('a phone photo: turned upright, at most 1200 px, GPS and camera data dropped', async () => {
		// 4000×3000 stored sideways (EXIF orientation 6 = "rotate 90° to show"), with a GPS position and a camera name
		const photo = await solid(4000, 3000)
			.jpeg()
			.withMetadata({ orientation: 6, exif: { IFD0: { Make: 'PhoneMaker', Model: 'X1' }, IFD3: { GPSLatitudeRef: 'N', GPSLatitude: '35/1 41/1 0/1' } } })
			.toBuffer();
		assert.ok((await sharp(photo).metadata()).exif, 'the test photo really has EXIF');
		const webp = await toWebp(photo);
		const meta = await sharp(webp).metadata();
		assert.equal(meta.format, 'webp');
		assert.deepEqual([meta.width, meta.height], [900, 1200], 'upright (portrait) and fitted inside 1200');
		assert.equal(meta.exif, undefined, 'no EXIF (GPS, camera) left');
		assert.equal(meta.orientation, undefined);
		assert.ok(webp.length < photo.length);
	});

	test('a small picture is not enlarged; transparency is kept', async () => {
		const png = await solid(300, 200, 4).png().toBuffer();
		const meta = await sharp(await toWebp(png)).metadata();
		assert.deepEqual([meta.format, meta.width, meta.height, meta.hasAlpha], ['webp', 300, 200, true]);
	});

	test('an animated GIF stays animated, each frame fitted', async () => {
		const frames = 3;
		const [w, h] = [1600, 1000];
		const raw = Buffer.alloc(w * h * frames * 4);
		for (let i = 0; i < raw.length; i += 4) raw.set([Math.floor(i / (w * h * 4)) * 90, 60, 160, 255], i);
		const gif = await sharp(raw, { raw: { width: w, height: h * frames, channels: 4, pageHeight: h } } as sharp.SharpOptions)
			.gif()
			.toBuffer();
		const meta = await sharp(await toWebp(gif), { animated: true }).metadata();
		assert.equal(meta.format, 'webp');
		assert.equal(meta.pages, frames);
		assert.deepEqual([meta.width, meta.pageHeight], [IMAGE_MAX_SIDE, 750]);
	});

	test('not a picture, a broken one or a decompression bomb → a clear message', async () => {
		const reject = async (input: Buffer, message: RegExp) => {
			await assert.rejects(toWebp(input), (error: unknown) => error instanceof ImageError && error.status === 400 && message.test(error.message));
		};
		await reject(Buffer.from('<?php echo 1; ?>'), /معتبر نیست/);
		// an SVG never reaches the decoder, even one that would decode
		await reject(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"/>'), /معتبر نیست/);
		const jpeg = await solid(800, 600).jpeg().toBuffer();
		await reject(jpeg.subarray(0, Math.floor(jpeg.length / 2)), /خراب/);
		// 10000×7000 white compresses to a tiny PNG but would unpack to 280 MB
		const bomb = await solid(10000, 7000).png({ compressionLevel: 9 }).toBuffer();
		assert.ok(bomb.length < 1024 * 1024);
		await reject(bomb, /ابعاد/);
	});

	test('content sniffing (magic numbers)', async () => {
		assert.equal(sniffImage(await solid(4, 4).jpeg().toBuffer()), 'jpg');
		assert.equal(sniffImage(await solid(4, 4).png().toBuffer()), 'png');
		assert.equal(sniffImage(await solid(4, 4).gif().toBuffer()), 'gif');
		assert.equal(sniffImage(await solid(4, 4).webp().toBuffer()), 'webp');
		assert.equal(sniffImage(Buffer.from('GIF8')), null);
		assert.equal(sniffImage(Buffer.alloc(0)), null);
	});

	test('a WebP that already is final is kept as it is', async () => {
		assert.equal(await isFinalWebp(await toWebp(await solid(2000, 2000).jpeg().toBuffer())), true);
		assert.equal(await isFinalWebp(await solid(2000, 2000).webp().toBuffer()), false, 'too large');
		assert.equal(await isFinalWebp(await solid(100, 100).webp().withMetadata({ exif: { IFD0: { Make: 'x' } } }).toBuffer()), false, 'has metadata');
		assert.equal(await isFinalWebp(await solid(100, 100).jpeg().toBuffer()), false, 'not WebP');
	});

	test('new names are unique WebP names the panel accepts', () => {
		const names = new Set(Array.from({ length: 200 }, () => newImageName({ temp: false })));
		assert.equal(names.size, 200);
		for (const name of names) assert.ok(isSafeImageName(name) && name.endsWith('.webp') && !isTempUpload(name), name);
		const temp = newImageName({ temp: true });
		assert.ok(isTempUpload(temp) && temp.endsWith('.webp'));
		// photos stored before the conversion keep working
		assert.ok(isSafeImageName('1792240176665-317318133.jpg'));
		assert.ok(!isSafeImageName('../1792240176665-317318133.webp'));
	});
});
