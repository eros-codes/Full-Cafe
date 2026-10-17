// End-to-end API tests against a real PostgreSQL database.
//
//   TEST_DATABASE_URL="postgresql://user:pass@localhost:5432/roof_test" npm test
//
// The database is WIPED before the run, so it must be a separate database whose
// name contains "test". Without TEST_DATABASE_URL these tests are skipped.
// Same clock as production (src/timezone.ts): dates and working hours are Tehran local time.
process.env.TZ = 'Asia/Tehran';

import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import type { CafeTable, PrismaClient } from '@prisma/client';

const TEST_DB = process.env.TEST_DATABASE_URL;
const skip = !TEST_DB
	? 'TEST_DATABASE_URL is not set'
	: !/test/i.test(new URL(TEST_DB).pathname)
		? 'TEST_DATABASE_URL must point to a *test* database'
		: false;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS = path.join(__dirname, '..', 'uploads', 'products');

let server: Server | undefined;
let base = '';
let prisma: PrismaClient;
const smsLog: string[] = [];

interface ApiResponse {
	status: number;
	/** Parsed JSON body; shapes vary per endpoint, so tests read it loosely. */
	json: any;
	text: string;
	headers: Headers;
}

type Client = ReturnType<typeof client>;

// ─── tiny HTTP client with its own cookie jar ─────────────────────────────────
function client() {
	const jar = new Map<string, string>();
	async function call(method: string, url: string, body?: unknown, { form }: { form?: FormData } = {}): Promise<ApiResponse> {
		const headers: Record<string, string> = {};
		if (jar.size) headers.cookie = [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
		let payload: RequestInit['body'];
		if (form) payload = form;
		else if (body !== undefined) {
			headers['content-type'] = 'application/json';
			payload = typeof body === 'string' ? body : JSON.stringify(body);
		}
		const res = await fetch(base + url, { method, headers, body: payload, redirect: 'manual' });
		for (const cookie of res.headers.getSetCookie?.() || []) {
			const [pair] = cookie.split(';');
			const [name, ...rest] = pair.split('=');
			const value = rest.join('=');
			if (value) jar.set(name, value);
			else jar.delete(name);
		}
		const text = await res.text();
		let json = null;
		try {
			json = text ? JSON.parse(text) : null;
		} catch {
			/* not JSON */
		}
		return { status: res.status, json, text, headers: res.headers };
	}
	return {
		get: (url: string) => call('GET', url),
		post: (url: string, body?: unknown, opts?: { form?: FormData }) => call('POST', url, body, opts),
		put: (url: string, body?: unknown) => call('PUT', url, body),
		patch: (url: string, body?: unknown) => call('PATCH', url, body),
		del: (url: string) => call('DELETE', url),
		jar,
	};
}

async function login(username: string, password: string): Promise<Client> {
	const c = client();
	const res = await c.post('/api/admin/login', { username, password });
	assert.equal(res.status, 200, `login ${username}: ${res.text}`);
	return c;
}

function tehranDate(offsetDays: number): string {
	const d = new Date(Date.now() + offsetDays * 86400000);
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function jpegFile() {
	// smallest valid JPEG header is enough for the magic-number check
	const bytes = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 1)]);
	return new Blob([bytes], { type: 'image/jpeg' });
}

function lastOtp(phone: string): string | undefined {
	const line = [...smsLog].reverse().find((l) => l.includes('[OTP]') && l.includes(phone));
	return line?.match(/:\s*(\d{6})\s*$/)?.[1];
}

describe('Roof API (integration)', { skip }, () => {
	let dev: Client;
	const tables: Record<'a' | 'b' | 'c', CafeTable> = {} as Record<'a' | 'b' | 'c', CafeTable>;
	let cafeTypeId: number;

	before(async () => {
		process.env.NODE_ENV = 'test';
		process.env.DATABASE_URL = TEST_DB;
		process.env.SMS_MODE = 'console';
		process.env.ZARINPAL_MERCHANT_ID = 'test-merchant';
		process.env.PAYMENT_MODE = 'sandbox';
		// Fake Zarinpal: only requests to the gateway are intercepted, everything else goes through.
		const realFetch = globalThis.fetch;
		globalThis.fetch = async (url: string | URL | Request, options?: RequestInit) => {
			const target = String(url);
			if (!target.includes('zarinpal.com')) return realFetch(url, options);
			const body = JSON.parse(String(options?.body));
			if (target.endsWith('/request.json')) {
				return new Response(JSON.stringify({ data: { code: 100, authority: `A${Date.now()}${Math.floor(Math.random() * 1000)}` } }));
			}
			// verify: authorities starting with "BAD" fail, everything else succeeds
			const ok = !String(body.authority).startsWith('BAD');
			return new Response(JSON.stringify({ data: ok ? { code: 100, ref_id: 987654 } : { code: -51 }, errors: ok ? [] : { code: -51 } }));
		};
		const originalLog = console.log;
		console.log = (...args) => {
			const line = args.join(' ');
			if (line.includes('[MOCK SMS]')) smsLog.push(line);
			else if (process.env.TEST_VERBOSE) originalLog(...args);
		};
		console.error = () => {};
		console.warn = () => {};

		({ prisma } = await import('../src/lib/prisma.js'));
		const { app } = await import('../src/app.js');
		const bcrypt = (await import('bcryptjs')).default;

		const rows = await prisma.$queryRaw<{ tablename: string }[]>`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
		await prisma.$executeRawUnsafe(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);

		for (const [key, value] of Object.entries({ pricePerGuest: 100000, decorationPrice: 50000, holdMinutes: 10, minLeadMinutes: 120 })) {
			await prisma.setting.create({ data: { key, value: String(value) } });
		}
		for (let day = 0; day <= 6; day++) await prisma.workingHour.create({ data: { dayOfWeek: day, opensAt: '09:00', closesAt: '21:00' } });
		const tableBase = { zone: 'WINDOW', shape: 'SQUARE', x: 100, y: 100, minGuests: 1 } as const;
		tables.a = await prisma.cafeTable.create({ data: { ...tableBase, code: 'W1', displayNumber: '1', capacity: 2, maxGuests: 2 } });
		tables.b = await prisma.cafeTable.create({ data: { ...tableBase, code: 'W2', displayNumber: '2', capacity: 4, maxGuests: 4, x: 200 } });
		tables.c = await prisma.cafeTable.create({ data: { ...tableBase, code: 'W3', displayNumber: '3', capacity: 4, maxGuests: 4, x: 300 } });
		await prisma.tableConnection.create({
			data: { tableAId: [tables.b.id, tables.c.id].sort()[0], tableBId: [tables.b.id, tables.c.id].sort()[1] },
		});
		await prisma.adminUser.create({
			data: { username: 'dev', name: 'Dev', role: 'DEVELOPER', passwordHash: await bcrypt.hash('DevPass123', 10) },
		});
		// TRUNCATE also removed the menu types the migration creates
		cafeTypeId = (await prisma.menuType.create({ data: { name: 'کافه', sortOrder: 0 } })).id;

		const listening = await new Promise<Server>((resolve) => {
			const s = app.listen(0, '127.0.0.1', () => resolve(s));
		});
		server = listening;
		base = `http://127.0.0.1:${(listening.address() as AddressInfo).port}`;
		dev = await login('dev', 'DevPass123');
	});

	after(async () => {
		await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
		await prisma?.$disconnect();
	});

	// ─── pages & server ──────────────────────────────────────────────────────────
	describe('pages', () => {
		test('every page has one clean URL; a trailing slash is the same page', async () => {
			const c = client();
			for (const path of ['/', '/menu', '/feedback', '/reserve', '/reserve/payment', '/reserve/invoice', '/reserve/profile', '/reserve/track', '/admin', '/admin/login']) {
				const res = await c.get(path);
				assert.equal(res.status, 200, path);
				assert.match(res.headers.get('content-type') ?? '', /text\/html/, path);
				assert.equal(res.headers.get('cache-control'), 'no-cache', `${path}: HTML is never cached`);
				assert.match(res.text, /<div id="root"/, path);
			}
			assert.equal((await c.get('/reserve/')).status, 200);
			assert.equal((await c.get('/admin/')).status, 200);
		});

		test('old addresses redirect once (301) to the new URL and keep the query', async () => {
			const c = client();
			const cases: [string, string][] = [
				['/src/pages/about/about.html', '/'],
				['/about', '/'],
				['/src/pages/menu/menu.html?x=1', '/menu?x=1'],
				['/reserve/index.html', '/reserve'],
				['/reserve/payment.html?id=abc&status=ok', '/reserve/payment?id=abc&status=ok'],
				['/admin/login.html', '/admin/login'],
				['/admin.html', '/admin'],
				['/track.html', '/reserve/track'],
			];
			for (const [from, to] of cases) {
				const res = await c.get(from);
				assert.equal(res.status, 301, from);
				assert.equal(res.headers.get('location'), to, from);
				assert.equal((await c.get(to)).status, 200, `${to} is a real page, not another redirect`);
			}
			// an unknown page goes home instead of showing a blank 404
			assert.equal((await c.get('/no-such-page')).headers.get('location'), '/');
		});

		test('admin pages are not indexed and CSP allows the Google map iframe only', async () => {
			const res = await client().get('/admin/login');
			assert.equal(res.headers.get('x-robots-tag'), 'noindex, nofollow');
			const csp = res.headers.get('content-security-policy');
			assert.match(csp ?? '', /frame-src https:\/\/www\.google\.com/);
			assert.match(csp ?? '', /script-src 'self'/);
		});

		test('missing assets are a 404, not the home page', async () => {
			assert.equal((await client().get('/nope.png')).status, 404);
			assert.equal((await client().get('/api/nope')).status, 404);
		});

		test('broken JSON body is a 400', async () => {
			const res = await client().post('/api/reviews', '{bad json');
			assert.equal(res.status, 400);
		});
	});

	// ─── admin auth & roles ──────────────────────────────────────────────────────
	describe('admin accounts and roles', () => {
		let main: Client;
		let staff: Client;
		let mainId: string;

		test('login uses the username (case-insensitive) and rejects bad passwords', async () => {
			assert.equal((await client().post('/api/admin/login', { username: 'DEV', password: 'DevPass123' })).status, 200);
			assert.equal((await client().post('/api/admin/login', { username: 'dev', password: 'wrong-pass' })).status, 401);
			assert.equal((await client().post('/api/admin/login', { username: 'ghost', password: 'whatever1' })).status, 401);
			assert.equal((await client().post('/api/admin/login', { email: 'dev', password: 'x' })).status, 400);
		});

		test('developer creates café manager and staff accounts', async () => {
			const m = await dev.post('/api/admin/admins', { username: 'Manager', name: 'مدیر', role: 'MAIN', password: 'MainPass123' });
			assert.equal(m.status, 201, m.text);
			assert.equal(m.json.admin.username, 'manager');
			assert.equal(m.json.admin.passwordHash, undefined);
			mainId = m.json.admin.id;
			assert.equal(
				(await dev.post('/api/admin/admins', { username: 'staff', name: 'پرسنل', role: 'SECONDARY', password: 'StaffPass123' })).status,
				201,
			);
			assert.equal(
				(await dev.post('/api/admin/admins', { username: 'staff', name: 'x', role: 'SECONDARY', password: 'StaffPass123' })).status,
				409,
			);
			assert.equal(
				(await dev.post('/api/admin/admins', { username: 'a b', name: 'x', role: 'SECONDARY', password: 'StaffPass123' })).status,
				400,
			);
			main = await login('manager', 'MainPass123');
			staff = await login('staff', 'StaffPass123');
		});

		test('café manager cannot create or touch developer accounts', async () => {
			assert.equal(
				(await main.post('/api/admin/admins', { username: 'dev2', name: 'x', role: 'DEVELOPER', password: 'DevPass1234' })).status,
				403,
			);
			const devId = (await dev.get('/api/admin/me')).json.admin.id;
			assert.equal((await main.patch(`/api/admin/admins/${devId}`, { password: 'Hacked12345' })).status, 403);
			assert.equal((await main.del(`/api/admin/admins/${devId}`)).status, 403);
			assert.equal((await main.patch(`/api/admin/admins/${mainId}`, { role: 'DEVELOPER' })).status, 400); // own role
		});

		test('staff cannot reach manager-only areas', async () => {
			for (const url of ['/api/admin/admins', '/api/admin/dashboard', '/api/admin/settings', '/api/admin/reports/revenue']) {
				assert.equal((await staff.get(url)).status, url === '/api/admin/settings' ? 200 : 403, url);
			}
			assert.equal((await staff.patch('/api/admin/settings', { pricePerGuest: 1 })).status, 403);
		});

		test('deactivating an admin ends their open session immediately', async () => {
			const temp = await dev.post('/api/admin/admins', { username: 'temp', name: 'موقت', role: 'SECONDARY', password: 'TempPass123' });
			const tempClient = await login('temp', 'TempPass123');
			assert.equal((await tempClient.get('/api/admin/me')).status, 200);
			assert.equal((await dev.patch(`/api/admin/admins/${temp.json.admin.id}`, { isActive: false })).status, 200);
			assert.equal((await tempClient.get('/api/admin/me')).status, 401);
		});

		test('changing your own password keeps you logged in, old sessions die', async () => {
			const other = await login('manager', 'MainPass123');
			assert.equal((await main.patch(`/api/admin/admins/${mainId}`, { password: 'MainPass456' })).status, 200);
			assert.equal((await main.get('/api/admin/me')).status, 200);
			assert.equal((await other.get('/api/admin/me')).status, 401);
		});

		test('the floor map is editable only by the developer', async () => {
			const id = tables.a.id;
			assert.equal((await staff.patch(`/api/admin/tables/${id}`, { isActive: false })).status, 403);
			assert.equal((await main.patch(`/api/admin/tables/${id}`, { x: 500 })).status, 403);
			assert.equal((await main.patch(`/api/admin/tables/${id}`, { isActive: false, x: 500 })).status, 403);
			assert.equal(
				(await main.post('/api/admin/tables', { zone: 'WINDOW', shape: 'ROUND', x: 1, y: 1, capacity: 2, maxGuests: 2 })).status,
				403,
			);
			assert.equal((await main.post('/api/admin/table-connections', { tableAId: tables.a.id, tableBId: tables.b.id })).status, 403);
			const toggled = await main.patch(`/api/admin/tables/${id}`, { isActive: false });
			assert.equal(toggled.status, 200);
			assert.equal(toggled.json.table.isActive, false);
			assert.equal((await main.patch(`/api/admin/tables/${id}`, { isActive: true })).status, 200);
		});

		test('developer table input is validated (no more 500 on unknown fields)', async () => {
			const created = await dev.post('/api/admin/tables', {
				zone: 'ROOF',
				shape: 'ROUND',
				x: '120',
				y: '80',
				capacity: '4',
				minGuests: '2',
				maxGuests: '4',
				image: 'ignored.png',
			});
			assert.equal(created.status, 201, created.text);
			assert.equal(created.json.table.capacity, 4);
			assert.match(created.json.table.code, /^R\d{3}$/);
			assert.equal((await dev.patch(`/api/admin/tables/${created.json.table.id}`, { minGuests: 9 })).status, 400);
			assert.equal((await dev.patch(`/api/admin/tables/${created.json.table.id}`, { zone: 'MARS' })).status, 400);
			assert.equal((await dev.patch(`/api/admin/tables/${created.json.table.id}`, { capacity: 'abc' })).status, 400);
			assert.equal((await dev.del(`/api/admin/tables/${created.json.table.id}`)).status, 200);
		});

		test('staff can manage the menu, but not its top-level types', async () => {
			const res = await staff.post('/api/admin/categories', { name: 'نوشیدنی سرد', menuTypeId: cafeTypeId });
			assert.equal(res.status, 201, res.text);
			assert.equal((await staff.del(`/api/admin/categories/${res.json.category.id}`)).status, 200);
			assert.equal((await staff.get('/api/admin/menu-types')).status, 200, 'staff can read types for the category form');
			assert.equal((await staff.post('/api/admin/menu-types', { name: 'قلیان' })).status, 403);
			assert.equal((await staff.patch(`/api/admin/menu-types/${cafeTypeId}`, { isActive: false })).status, 403);
			const addOn = await staff.post('/api/admin/addons', { name: 'سس', price: 1000 });
			assert.equal(addOn.status, 201, 'add-ons belong to the product side');
			assert.equal((await staff.del(`/api/admin/addons/${addOn.json.addOn.id}`)).status, 200);
		});
	});

	// ─── menu ────────────────────────────────────────────────────────────────────
	describe('menu', () => {
		let category: any;
		let product: any;

		test('menu types: created, renamed, ordered and hidden by the manager', async () => {
			assert.equal((await dev.post('/api/admin/menu-types', { name: '  ' })).status, 400);
			assert.equal((await dev.post('/api/admin/menu-types', { name: 'کافه' })).status, 409, 'names are unique');
			const hookah = await dev.post('/api/admin/menu-types', { name: ' قلیان ' });
			assert.equal(hookah.status, 201, hookah.text);
			assert.equal(hookah.json.menuType.name, 'قلیان');
			assert.equal(hookah.json.menuType.sortOrder, 1, 'a new type goes last');
			const hookahId = hookah.json.menuType.id;

			assert.deepEqual((await client().get('/api/menu-types')).json, [
				{ id: cafeTypeId, name: 'کافه' },
				{ id: hookahId, name: 'قلیان' },
			]);
			assert.equal((await dev.put('/api/admin/menu-types/order', { ids: [hookahId] })).status, 400, 'every type must be listed');
			assert.equal((await dev.put('/api/admin/menu-types/order', { ids: [hookahId, hookahId] })).status, 400);
			assert.equal((await dev.put('/api/admin/menu-types/order', { ids: [hookahId, cafeTypeId] })).status, 200);
			assert.deepEqual(
				(await client().get('/api/menu-types')).json.map((t: { id: number }) => t.id),
				[hookahId, cafeTypeId],
			);

			// a hidden type takes its categories and products off the public menu
			const cat = await dev.post('/api/admin/categories', { name: 'میوه‌ای', menuTypeId: hookahId });
			const prod = await dev.post('/api/admin/products', { name: 'دو سیب', price: 300000, categoryId: cat.json.category.id });
			assert.equal(prod.status, 201, prod.text);
			assert.equal((await dev.patch(`/api/admin/menu-types/${hookahId}`, { isActive: false, name: 'قلیان‌ها' })).status, 200);
			assert.deepEqual((await client().get('/api/menu-types')).json, [{ id: cafeTypeId, name: 'کافه' }]);
			assert.equal((await client().get('/api/categories')).json.length, 0);
			assert.equal((await client().get(`/api/products?categoryId=${cat.json.category.id}`)).json.length, 0);
			assert.equal((await client().get('/api/products')).json.length, 0);

			const blocked = await dev.del(`/api/admin/menu-types/${hookahId}`);
			assert.equal(blocked.status, 409, 'a type with categories is not deleted');
			assert.equal(blocked.json.categoryCount, 1);
			assert.equal((await dev.del(`/api/admin/categories/${cat.json.category.id}?withProducts=1`)).status, 200);
			assert.equal((await dev.del(`/api/admin/menu-types/${hookahId}`)).status, 200);
			assert.equal((await dev.del(`/api/admin/menu-types/${hookahId}`)).status, 404);
		});

		test('categories: create, validate, list publicly', async () => {
			assert.equal((await dev.post('/api/admin/categories', { name: 'قهوه', menuTypeId: 'bar' })).status, 400);
			assert.equal((await dev.post('/api/admin/categories', { name: 'قهوه', menuTypeId: 9999 })).status, 404);
			assert.equal((await dev.post('/api/admin/categories', { name: 'قهوه' })).status, 400);
			assert.equal((await dev.post('/api/admin/categories', { name: '  ', menuTypeId: cafeTypeId })).status, 400);
			const res = await dev.post('/api/admin/categories', { name: ' قهوه ', menuTypeId: cafeTypeId });
			assert.equal(res.status, 201);
			category = res.json.category;
			assert.equal(category.name, 'قهوه');
			const list = await client().get('/api/categories');
			assert.deepEqual(list.json, [{ id: category.id, name: 'قهوه', menuTypeId: cafeTypeId }]);
			const admin = await dev.get('/api/admin/categories');
			assert.equal(admin.json.categories[0].menuType.name, 'کافه');
		});

		test('upload checks the real file content, not just the mimetype', async () => {
			const fake = new FormData();
			fake.append('image', new Blob(['<?php echo 1; ?>'], { type: 'image/jpeg' }), 'x.jpg');
			assert.equal((await dev.post('/api/admin/upload', undefined, { form: fake })).status, 400);
			const text = new FormData();
			text.append('image', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
			assert.equal((await dev.post('/api/admin/upload', undefined, { form: text })).status, 400);
			assert.equal((await client().post('/api/admin/upload', undefined, { form: new FormData() })).status, 401);
		});

		test('products: uploaded image is kept, bad input rejected', async () => {
			const form = new FormData();
			form.append('image', jpegFile(), 'latte.jpg');
			const upload = await dev.post('/api/admin/upload', undefined, { form });
			assert.equal(upload.status, 200, upload.text);
			assert.match(upload.json.filename, /^temp-/);

			for (const bad of [
				{ name: 'x', price: 1, categoryId: category.id, image: '../../.env' },
				{ name: 'x', price: -1, categoryId: category.id },
				{ name: 'x', price: 1.5, categoryId: category.id },
				{ name: '', price: 1, categoryId: category.id },
				{ name: 'x', price: 1, categoryId: 9999 },
				{ name: 'x', price: 1, categoryId: category.id, image: 'temp-1700000000000-1.jpg' },
			]) {
				const res = await dev.post('/api/admin/products', bad);
				assert.ok([400, 404].includes(res.status), `${JSON.stringify(bad)} → ${res.status}`);
			}

			const res = await dev.post('/api/admin/products', {
				name: 'لاته',
				price: 95000,
				categoryId: category.id,
				image: upload.json.filename,
			});
			assert.equal(res.status, 201, res.text);
			product = res.json.product;
			// temp file is promoted so the stale-upload cleanup never deletes it
			assert.doesNotMatch(product.image, /^temp-/);
			assert.ok(fs.existsSync(path.join(UPLOADS, product.image)));
			assert.equal((await client().get(`/uploads/products/${product.image}`)).status, 200);

			const pub = await client().get(`/api/products?categoryId=${category.id}`);
			assert.equal(pub.json.length, 1);
			assert.equal((await client().get('/api/products?categoryId=abc')).status, 400);
		});

		test("a product cannot point at another product's image", async () => {
			const res = await dev.post('/api/admin/products', { name: 'کپی', price: 1000, categoryId: category.id, image: product.image });
			assert.equal(res.status, 400);
			assert.equal(
				(await dev.patch(`/api/admin/products/${product.id}`, { image: product.image, price: 96000 })).status,
				200,
				'own image is fine',
			);
		});

		test('replacing a product image deletes the old file', async () => {
			const form = new FormData();
			form.append('image', jpegFile(), 'new.jpg');
			const upload = await dev.post('/api/admin/upload', undefined, { form });
			const res = await dev.patch(`/api/admin/products/${product.id}`, { image: upload.json.filename, price: 99000 });
			assert.equal(res.status, 200, res.text);
			assert.equal(res.json.product.price, 99000);
			assert.ok(!fs.existsSync(path.join(UPLOADS, product.image)));
			product = res.json.product;
		});

		test('add-ons: one shared library, attached to any number of products', async () => {
			for (const bad of [{ name: '', price: 1 }, { name: 'x', price: -1 }, { name: 'x', price: 1.5 }, { name: 'x' }]) {
				assert.equal((await dev.post('/api/admin/addons', bad)).status, 400, JSON.stringify(bad));
			}
			const sauce = (await dev.post('/api/admin/addons', { name: 'سس فرانسوی', price: 25000 })).json.addOn;
			const cheese = (await dev.post('/api/admin/addons', { name: 'پنیر اضافه', price: 30000 })).json.addOn;
			const noOnion = await dev.post('/api/admin/addons', { name: 'بدون پیاز', price: 0 });
			assert.equal(noOnion.status, 201, 'a free add-on is allowed');

			assert.equal((await dev.patch(`/api/admin/products/${product.id}`, { addOnIds: [sauce.id, sauce.id] })).status, 400);
			assert.equal((await dev.patch(`/api/admin/products/${product.id}`, { addOnIds: [9999] })).status, 404);
			assert.equal((await dev.patch(`/api/admin/products/${product.id}`, { addOnIds: 'x' })).status, 400);
			const linked = await dev.patch(`/api/admin/products/${product.id}`, { addOnIds: [cheese.id, sauce.id] });
			assert.equal(linked.status, 200, linked.text);
			assert.deepEqual(linked.json.product.addOnIds, [cheese.id, sauce.id], 'the given order is kept');
			// the same add-on on a second product
			const pizza = await dev.post('/api/admin/products', { name: 'پیتزا', price: 400000, categoryId: category.id, addOnIds: [sauce.id] });
			assert.equal(pizza.status, 201, pizza.text);
			assert.deepEqual(pizza.json.product.addOnIds, [sauce.id]);

			const pub = (await client().get(`/api/products?categoryId=${category.id}`)).json;
			assert.deepEqual(pub.find((p: { id: number }) => p.id === product.id).addOns, [
				{ id: cheese.id, name: 'پنیر اضافه', price: 30000 },
				{ id: sauce.id, name: 'سس فرانسوی', price: 25000 },
			]);

			// editing other fields leaves the add-ons alone
			assert.deepEqual((await dev.patch(`/api/admin/products/${product.id}`, { price: 99000 })).json.product.addOnIds, [cheese.id, sauce.id]);

			// an inactive add-on stays attached but is not offered
			assert.equal((await dev.patch(`/api/admin/addons/${cheese.id}`, { isActive: false })).status, 200);
			const after = (await client().get(`/api/products?categoryId=${category.id}`)).json;
			assert.deepEqual(after.find((p: { id: number }) => p.id === product.id).addOns.map((a: { id: number }) => a.id), [sauce.id]);

			const list = (await dev.get('/api/admin/addons')).json.addOns;
			assert.equal(list.find((a: { id: number }) => a.id === sauce.id)._count.products, 2);

			// deleting an attached add-on needs confirmation, then detaches it everywhere
			const blocked = await dev.del(`/api/admin/addons/${sauce.id}`);
			assert.equal(blocked.status, 409);
			assert.equal(blocked.json.productCount, 2);
			assert.equal((await dev.del(`/api/admin/addons/${sauce.id}?force=1`)).status, 200);
			const products = (await dev.get('/api/admin/products')).json.products;
			assert.deepEqual(products.find((p: { id: number }) => p.id === product.id).addOnIds, [cheese.id]);
			assert.equal((await dev.del(`/api/admin/products/${pizza.json.product.id}`)).status, 200);
		});

		test('a category with products is only deleted after explicit confirmation', async () => {
			const res = await dev.del(`/api/admin/categories/${category.id}`);
			assert.equal(res.status, 409);
			assert.equal(res.json.productCount, 1);
			assert.equal((await dev.get('/api/admin/products')).json.products.length, 1);
			assert.equal((await dev.del(`/api/admin/categories/${category.id}?withProducts=1`)).status, 200);
			assert.equal((await dev.get('/api/admin/products')).json.products.length, 0);
			assert.ok(!fs.existsSync(path.join(UPLOADS, product.image)));
		});
	});

	// ─── reviews ─────────────────────────────────────────────────────────────────
	describe('reviews', () => {
		test('posted reviews stay hidden until approved', async () => {
			assert.equal((await client().post('/api/reviews', { text: 'x'.repeat(101) })).status, 400);
			assert.equal((await client().post('/api/reviews', { text: '   ' })).status, 400);
			const posted = await client().post('/api/reviews', { name: 'سارا', text: 'عالی بود' });
			assert.equal(posted.status, 201);
			assert.equal((await client().get('/api/reviews')).json.length, 0);
			const approved = await dev.patch(`/api/admin/reviews/${posted.json.id}`, { visible: true, reply: 'ممنون!' });
			assert.equal(approved.status, 200);
			assert.equal((await dev.patch(`/api/admin/reviews/${posted.json.id}`, { visible: 'yes' })).status, 400);
			const list = await client().get('/api/reviews?limit=30');
			assert.equal(list.json.total, 1);
			assert.equal(list.json.data[0].reply, 'ممنون!');
			// an empty reply removes it
			assert.equal((await dev.patch(`/api/admin/reviews/${posted.json.id}`, { reply: '' })).json.review.reply, null);
		});
	});

	// ─── regressions found during the merge ──────────────────────────────────────
	describe('input validation regressions', () => {
		test('settings: unknown keys, negative cleaning buffer and min > max are refused', async () => {
			assert.equal((await dev.patch('/api/admin/settings', { cleaningBufferMinutes: -500 })).status, 400);
			assert.equal((await dev.patch('/api/admin/settings', { minLeadMinutes: 1.5 })).status, 400);
			assert.equal((await dev.patch('/api/admin/settings', { anything: '1' })).status, 400);
			assert.equal((await dev.patch('/api/admin/settings', { minDurationMinutes: 300, maxDurationMinutes: 240 })).status, 400);
			const ok = await dev.patch('/api/admin/settings', { cleaningBufferMinutes: 20, cafeName: 'Roof' });
			assert.equal(ok.status, 200);
			assert.equal(ok.json.settings.cleaningBufferMinutes, '20');
		});

		test('closures: bad zone / table / time are a 400, not a raw database error', async () => {
			for (const body of [
				{ title: 'x', date: tehranDate(3), zone: 'MARS' },
				{ title: 'x', date: tehranDate(3), tableId: 'nope' },
				{ title: 'x', date: tehranDate(3), startTime: '25:00', endTime: '26:00' },
				{ title: 'x', date: tehranDate(3), startTime: '10:00' },
				{ title: 'x', date: tehranDate(3), startTime: '24:00', endTime: '24:00' },
				{ title: 'x', date: '2026-02-30' },
				{ title: '', date: tehranDate(3) },
			]) {
				const res = await dev.post('/api/admin/closures', body);
				assert.equal(res.status, 400, JSON.stringify(body));
				assert.doesNotMatch(res.text, /prisma/i);
			}
			assert.equal((await dev.post('/api/admin/closures', { title: 'تعمیرات', date: tehranDate(9), zone: 'ROOF' })).status, 201);
		});

		test('impossible dates and times are a 400, not a 500', async () => {
			const q = (params: string) => client().get(`/api/availability?guests=2&durationMinutes=60&${params}`);
			assert.equal((await q('date=2026-02-30&startTime=12:00')).status, 400);
			assert.equal((await q(`date=${tehranDate(3)}&startTime=24:00`)).status, 400);
			assert.equal((await q(`date=${tehranDate(3)}&rangeStart=24:00&rangeEnd=24:00`)).status, 400);
			const hold = (body: object) =>
				client().post('/api/reservations/hold', {
					tableIds: [tables.b.id],
					durationMinutes: 60,
					guestCount: 2,
					customerName: 'تست',
					customerPhone: '09120000004',
					...body,
				});
			assert.equal((await hold({ date: tehranDate(3), startTime: '25:99' })).status, 400);
			assert.equal((await hold({ date: '2026-13-01', startTime: '12:00' })).status, 400);
		});

		test('OTP with an unknown purpose is a 400', async () => {
			const res = await client().post('/api/otp/send', { phone: '09120000001', purpose: 'HACK' });
			assert.equal(res.status, 400);
			assert.doesNotMatch(res.text, /prisma/i);
		});

		test('customer name is limited', async () => {
			const res = await client().post('/api/reservations/hold', {
				tableIds: [tables.b.id],
				date: tehranDate(6),
				startTime: '12:00',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'ب'.repeat(200),
				customerPhone: '09120000003',
			});
			assert.equal(res.status, 400);
		});
	});

	// ─── working hours until midnight ────────────────────────────────────────────
	describe('closing at 24:00', () => {
		const day = tehranDate(4);
		const dow = new Date(`${day}T12:00:00+03:30`).getDay();
		const at = (startTime: string, tableId: string) =>
			client()
				.get(`/api/availability?date=${day}&guests=2&durationMinutes=60&startTime=${startTime}`)
				.then((res) => {
					assert.equal(res.status, 200, res.text);
					return res.json.tables.find((t: { id: string }) => t.id === tableId).availability;
				});

		test('working hours accept 24:00 as a closing time only', async () => {
			assert.equal((await dev.patch(`/api/admin/working-hours/${dow}`, { opensAt: '09:00', closesAt: '25:00' })).status, 400);
			assert.equal((await dev.patch(`/api/admin/working-hours/${dow}`, { opensAt: '24:00', closesAt: '24:00' })).status, 400);
			assert.equal((await dev.patch(`/api/admin/working-hours/${dow}`, { opensAt: '09:00', closesAt: '02:00' })).status, 400, 'no past-midnight hours');
			const ok = await dev.patch(`/api/admin/working-hours/${dow}`, { opensAt: '09:00', closesAt: '24:00' });
			assert.equal(ok.status, 200, ok.text);
			assert.equal(ok.json.workingHour.closesAt, '24:00');
		});

		test('a booking may end exactly at midnight, not later', async () => {
			const late = await at('23:00', tables.a.id);
			assert.equal(late.available, true, late.reason);
			assert.equal(late.endTime, '24:00');
			assert.equal((await at('23:30', tables.a.id)).available, false);

			const range = await client().get(`/api/availability?date=${day}&guests=2&durationMinutes=60&rangeStart=22:00&rangeEnd=24:00`);
			assert.equal(range.status, 200, range.text);
			assert.equal(range.json.tables.find((t: { id: string }) => t.id === tables.a.id).availability.startTime, '22:00');

			const booked = await client().post('/api/reservations/hold', {
				tableIds: [tables.a.id],
				date: day,
				startTime: '23:00',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'شب',
				customerPhone: '09120000020',
			});
			assert.equal(booked.status, 201, booked.text);
			assert.equal(new Date(booked.json.reservation.endAt).getTime(), new Date(`${day}T23:00:00+03:30`).getTime() + 3600000);
			assert.equal((await at('23:00', tables.a.id)).available, false, 'the table is taken now');
		});

		test('a closure until 24:00 blocks the last slot', async () => {
			assert.equal((await at('23:00', tables.b.id)).available, true);
			const closure = await dev.post('/api/admin/closures', { title: 'شب خصوصی', date: day, startTime: '23:30', endTime: '24:00', tableId: tables.b.id });
			assert.equal(closure.status, 201, closure.text);
			assert.equal((await at('23:00', tables.b.id)).available, false);
			assert.equal((await dev.del(`/api/admin/closures/${closure.json.closure.id}`)).status, 200);
			assert.equal((await dev.patch(`/api/admin/working-hours/${dow}`, { opensAt: '09:00', closesAt: '21:00' })).status, 200);
		});
	});

	// ─── reservations ────────────────────────────────────────────────────────────
	describe('reservations', () => {
		const date = tehranDate(2);
		const phone = '09121234567';
		let hold: any;
		let guest: Client;

		test('availability shows free tables and connected combos', async () => {
			const res = await client().get(`/api/availability?date=${date}&guests=2&durationMinutes=60&startTime=15:00`);
			assert.equal(res.status, 200, res.text);
			const a = res.json.tables.find((t: { id: string }) => t.id === tables.a.id);
			assert.equal(a.availability.available, true);
			assert.equal(a.availability.matchType, 'perfect');
			const big = await client().get(`/api/availability?date=${date}&guests=7&durationMinutes=60&startTime=15:00`);
			assert.equal(big.json.combos.length, 1);
		});

		test('a guest hold locks the table and only its owner can see or pay it', async () => {
			guest = client();
			const res = await guest.post('/api/reservations/hold', {
				tableIds: [tables.a.id],
				date,
				startTime: '15:00',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'علی',
				customerPhone: '+989121234567',
				decoration: true,
			});
			assert.equal(res.status, 201, res.text);
			hold = res.json.reservation;
			assert.equal(hold.status, 'HOLD');
			assert.equal(hold.customerPhone, phone);
			assert.equal(hold.totalAmount, 2 * 100000 + 50000);

			const again = await client().post('/api/reservations/hold', {
				tableIds: [tables.a.id],
				date,
				startTime: '15:30',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'رضا',
				customerPhone: '09120000000',
			});
			assert.equal(again.status, 400, 'overlapping hold must be refused');

			assert.equal((await client().get(`/api/reservations/${hold.id}`)).status, 403);
			assert.equal((await guest.get(`/api/reservations/${hold.id}`)).status, 200);
			assert.equal((await client().post(`/api/payments/${hold.id}/request`)).status, 403);
			const pay = await guest.post(`/api/payments/${hold.id}/request`);
			assert.equal(pay.status, 200, pay.text);
			assert.match(pay.json.paymentUrl, /^https:\/\/sandbox\.zarinpal\.com\/pg\/StartPay\//);
		});

		test('admin status changes follow the allowed transitions', async () => {
			const staff = await login('staff', 'StaffPass123');
			const set = (c: Client, status: string) => c.patch(`/api/admin/reservations/${hold.id}/status`, { status });
			assert.equal((await set(dev, 'CONFIRMED')).status, 409, 'a HOLD cannot be confirmed without payment');
			assert.equal((await set(dev, 'COMPLETED')).status, 409);
			assert.equal((await set(staff, 'CONFIRMED')).status, 403);
			assert.equal((await set(dev, 'BOGUS')).status, 400);
			const cancelled = await set(staff, 'CANCELLED');
			assert.equal(cancelled.status, 200);
			assert.equal(cancelled.json.reservation.refundStatus, 'NONE');
			assert.equal((await set(dev, 'CANCELLED')).status, 409, 'cannot cancel twice');
		});

		test('payment-review reservations can be confirmed by a manager', async () => {
			const r = await prisma.reservation.create({
				data: {
					trackingCode: 'RSV-000000001',
					customerName: 'بررسی',
					customerPhone: phone,
					guestCount: 2,
					startAt: new Date(`${date}T16:00:00+03:30`),
					endAt: new Date(`${date}T17:00:00+03:30`),
					durationMinutes: 60,
					status: 'PAYMENT_REVIEW',
					pricePerGuest: 100000,
					totalAmount: 200000,
					tables: { create: [{ tableId: tables.b.id }] },
					payments: { create: { amount: 200000, status: 'REVIEW', method: 'ZARINPAL', provider: 'zarinpal', isMock: false } },
				},
			});
			const res = await dev.patch(`/api/admin/reservations/${r.id}/status`, { status: 'CONFIRMED' });
			assert.equal(res.status, 200, res.text);
			assert.equal(res.json.reservation.paidAmount, 200000);
			const payment = await prisma.payment.findFirst({ where: { reservationId: r.id } });
			assert.equal(payment?.status, 'PAID');
		});

		test('guest tracks a reservation with an SMS code and cancels it', async () => {
			const manual = await dev.post('/api/admin/reservations/manual', {
				tableIds: [tables.c.id],
				date,
				startTime: '18:00',
				durationMinutes: 90,
				guestCount: 3,
				customerName: 'مریم',
				customerPhone: phone,
			});
			assert.equal(manual.status, 201, manual.text);
			const reservation = manual.json.reservation;
			assert.equal(reservation.status, 'CONFIRMED');

			const visitor = client();
			assert.equal((await visitor.post('/api/otp/send', { phone, purpose: 'GUEST_ACCESS' })).status, 200);
			const code = lastOtp(phone);
			assert.ok(code, 'OTP was "sent" to the console');
			assert.equal(
				(await visitor.post('/api/otp/verify', { phone, code: '000000', purpose: 'GUEST_ACCESS', trackingCode: reservation.trackingCode }))
					.status,
				400,
			);
			const verified = await visitor.post('/api/otp/verify', {
				phone,
				code,
				purpose: 'GUEST_ACCESS',
				trackingCode: reservation.trackingCode,
			});
			assert.equal(verified.status, 200, verified.text);

			const cancelled = await visitor.post(`/api/reservations/${reservation.id}/cancel`, {});
			assert.equal(cancelled.status, 200, cancelled.text);
			assert.equal(cancelled.json.reservation.status, 'CANCELLED');
			// the manual booking counted as paid at the café → refund is owed
			assert.equal(cancelled.json.reservation.refundStatus, 'PENDING');
			const twice = await visitor.post(`/api/reservations/${reservation.id}/cancel`, {});
			assert.equal(twice.status, 409, 'a clear 409, not a 500');
		});

		test('phone and code typed with Persian digits work (Persian keyboards)', async () => {
			const toFa = (s: string) => s.replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
			const latinPhone = '09127778899';
			const visitor = client();
			const sent = await visitor.post('/api/otp/send', { phone: toFa(latinPhone), purpose: 'LOGIN' });
			assert.equal(sent.status, 200, sent.text);
			const code = lastOtp(latinPhone);
			assert.ok(code, 'OTP went to the normalized number');
			const verified = await visitor.post('/api/otp/verify', { phone: toFa(latinPhone), code: ` ${toFa(code)} `, purpose: 'LOGIN', name: 'سارا' });
			assert.equal(verified.status, 200, verified.text);
			const manual = await dev.post('/api/admin/reservations/manual', {
				tableIds: [tables.a.id],
				date,
				startTime: '12:00',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'تلفنی',
				customerPhone: '۰۹۱۲۷۷۷۸۸۹۹',
			});
			assert.equal(manual.status, 201, manual.text);
			assert.equal(manual.json.reservation.customerPhone, latinPhone);
		});

		test('staff can book a walk-in for the next hour, online customers cannot', async () => {
			const today = tehranDate(0);
			const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', hour12: false }).format(new Date()));
			if (hour + 1 >= 20) return; // too late in the day for this check (café closes at 21:00)
			const startTime = `${String(hour + 1).padStart(2, '0')}:00`;
			const body = {
				tableIds: [tables.b.id],
				date: today,
				startTime,
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'حضوری',
				customerPhone: '09120000002',
			};
			assert.equal((await client().post('/api/reservations/hold', body)).status, 400, 'online booking keeps the lead time');
			assert.equal((await dev.post('/api/admin/reservations/manual', body)).status, 201);
			const past = { ...body, tableIds: [tables.c.id], startTime: '09:00' };
			if (hour >= 10) assert.equal((await dev.post('/api/admin/reservations/manual', past)).status, 400, 'never in the past');
		});

		test('paying on time confirms the hold', async () => {
			const c = client();
			const res = await c.post('/api/reservations/hold', {
				tableIds: [tables.a.id],
				date: tehranDate(7),
				startTime: '13:00',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'به‌موقع',
				customerPhone: '09120000010',
			});
			assert.equal(res.status, 201, res.text);
			const pay = await c.post(`/api/payments/${res.json.reservation.id}/request`);
			const authority = pay.json.paymentUrl.split('/').pop();
			const back = await c.get(`/api/payments/callback?Authority=${authority}&Status=OK`);
			assert.equal(back.status, 302);
			assert.match(back.headers.get('location') ?? '', /result=success/);
			const after = await prisma.reservation.findUnique({ where: { id: res.json.reservation.id }, include: { payments: true } });
			assert.ok(after);
			assert.equal(after.status, 'CONFIRMED');
			assert.equal(after.payments[0].status, 'PAID');
			assert.equal(after.payments[0].refId, '987654');
		});

		test('a payment that arrives after the hold expired never double-books the table', async () => {
			const date = tehranDate(8);
			const first = client();
			const h1 = await first.post('/api/reservations/hold', {
				tableIds: [tables.a.id],
				date,
				startTime: '14:00',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'دیرکرد',
				customerPhone: '09120000011',
			});
			assert.equal(h1.status, 201, h1.text);
			const pay = await first.post(`/api/payments/${h1.json.reservation.id}/request`);
			const authority = pay.json.paymentUrl.split('/').pop();
			// the customer stays on the gateway too long: the hold expires and someone else books the table
			await prisma.reservation.update({ where: { id: h1.json.reservation.id }, data: { status: 'EXPIRED' } });
			const h2 = await client().post('/api/reservations/hold', {
				tableIds: [tables.a.id],
				date,
				startTime: '14:00',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'نفر دوم',
				customerPhone: '09120000012',
			});
			assert.equal(h2.status, 201, h2.text);

			const back = await first.get(`/api/payments/callback?Authority=${authority}&Status=OK`);
			assert.match(back.headers.get('location') ?? '', /result=review/);
			const late = await prisma.reservation.findUnique({ where: { id: h1.json.reservation.id }, include: { payments: true } });
			assert.ok(late);
			assert.equal(late.status, 'PAYMENT_REVIEW');
			assert.equal(late.payments[0].status, 'REVIEW');

			// the manager cannot confirm it (table taken) but can cancel it, which records the refund
			assert.equal((await dev.patch(`/api/admin/reservations/${late.id}/status`, { status: 'CONFIRMED' })).status, 409);
			const cancelled = await dev.patch(`/api/admin/reservations/${late.id}/status`, { status: 'CANCELLED' });
			assert.equal(cancelled.status, 200);
			assert.equal(cancelled.json.reservation.refundStatus, 'PENDING');
		});

		test('a late payment is still confirmed when the table is free', async () => {
			const c = client();
			const res = await c.post('/api/reservations/hold', {
				tableIds: [tables.c.id],
				date: tehranDate(8),
				startTime: '19:00',
				durationMinutes: 60,
				guestCount: 2,
				customerName: 'دیر ولی آزاد',
				customerPhone: '09120000013',
			});
			const pay = await c.post(`/api/payments/${res.json.reservation.id}/request`);
			const authority = pay.json.paymentUrl.split('/').pop();
			await prisma.reservation.update({ where: { id: res.json.reservation.id }, data: { status: 'EXPIRED' } });
			const back = await c.get(`/api/payments/callback?Authority=${authority}&Status=OK`);
			assert.match(back.headers.get('location') ?? '', /result=success/);
			assert.equal((await prisma.reservation.findUnique({ where: { id: res.json.reservation.id } }))?.status, 'CONFIRMED');
		});

		test('the old "change reservation" API is gone', async () => {
			const res = await dev.post(`/api/reservations/${hold.id}/change/hold`, { tableIds: [tables.b.id] });
			assert.equal(res.status, 404);
		});

		test('cancelling a manually paid reservation records the refund', async () => {
			const r = await prisma.reservation.create({
				data: {
					trackingCode: 'RSV-000000002',
					customerName: 'تغییر',
					customerPhone: '09120000014',
					guestCount: 2,
					startAt: new Date(`${tehranDate(9)}T12:00:00+03:30`),
					endAt: new Date(`${tehranDate(9)}T13:00:00+03:30`),
					durationMinutes: 60,
					status: 'CONFIRMED',
					pricePerGuest: 100000,
					totalAmount: 200000,
					paidAmount: 200000,
					tables: { create: [{ tableId: tables.b.id }] },
					payments: { create: { amount: 200000, status: 'PAID', method: 'MANUAL', provider: 'zarinpal', isMock: true } },
				},
			});
			const res = await dev.patch(`/api/admin/reservations/${r.id}/status`, { status: 'CANCELLED' });
			assert.equal(res.json.reservation.refundStatus, 'PENDING');
		});

		test('dashboard combines reservation and menu numbers', async () => {
			const res = await dev.get('/api/admin/dashboard');
			assert.equal(res.status, 200);
			for (const key of ['actionNeeded', 'totalRevenue', 'visitorsToday', 'productsCount', 'categoriesCount', 'reviewsPending']) {
				assert.equal(typeof res.json[key], 'number', key);
			}
			assert.ok(res.json.actionNeeded >= 1, 'the pending refund needs attention');
		});
	});
});
