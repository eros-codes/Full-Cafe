// The floor plan's data: prisma/seed-data/floor-map.json must fit client/public/maps/roof-map.json and the drawing,
// and broken layouts are refused with a clear list. No database needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLayout, type LayoutTable } from '../src/services/floor-plan.service.js';
import { BRAND, fillBrandTokens } from '../src/brand.js';

const layoutFile = JSON.parse(fs.readFileSync(new URL('../prisma/seed-data/floor-map.json', import.meta.url), 'utf8'));
const mapConfig = JSON.parse(fs.readFileSync(new URL('../client/public/maps/roof-map.json', import.meta.url), 'utf8'));
const baseSvg = fs.readFileSync(new URL('../client/public/maps/roof-base.svg', import.meta.url), 'utf8');

/** The map draws a table and its chairs at 60% (booking.css .roof-table-lift). */
const DRAWN = 0.6;
function footprint(t: LayoutTable) {
	const xs = [t.width / 2, -t.width / 2, ...t.chairs.flatMap((c) => [c.x - 12, c.x + 12])].map((v) => v * DRAWN);
	const ys = [t.height / 2, -t.height / 2, ...t.chairs.flatMap((c) => [c.y - 12, c.y + 12])].map((v) => v * DRAWN);
	return { left: t.x + Math.min(...xs), right: t.x + Math.max(...xs), top: t.y + Math.min(...ys), bottom: t.y + Math.max(...ys) };
}

describe('floor plan', () => {
	const layout = parseLayout(layoutFile);

	test('the layout file is valid: codes, numbers, seats, connections', () => {
		assert.ok(layout.tables.length >= 10);
		for (const t of layout.tables) {
			assert.ok(t.maxGuests <= t.capacity && t.minGuests <= t.maxGuests, t.code);
			assert.equal(t.capacity, t.chairs.length, `${t.code}: one seat per chair`);
		}
		assert.ok(layout.connections.length > 0);
	});

	test('every table sits inside its hall, and no two tables (with their chairs) overlap', () => {
		for (const t of layout.tables) {
			const b = mapConfig.zones[t.zone].bounds;
			const f = footprint(t);
			assert.ok(f.left >= b.x && f.right <= b.x + b.width && f.top >= b.y && f.bottom <= b.y + b.height, `${t.code} is outside ${t.zone}`);
		}
		for (const [i, a] of layout.tables.entries()) {
			for (const b of layout.tables.slice(i + 1)) {
				const fa = footprint(a);
				const fb = footprint(b);
				const apart = fa.right + 8 <= fb.left || fb.right + 8 <= fa.left || fa.bottom + 8 <= fb.top || fb.bottom + 8 <= fa.top;
				assert.ok(apart, `${a.code} and ${b.code} overlap`);
			}
		}
	});

	test('joined tables are neighbours in the same hall', () => {
		const byCode = new Map(layout.tables.map((t) => [t.code, t]));
		for (const [a, b] of layout.connections) {
			const ta = byCode.get(a)!;
			const tb = byCode.get(b)!;
			assert.equal(ta.zone, tb.zone, `${a}–${b}`);
			assert.ok(Math.hypot(ta.x - tb.x, ta.y - tb.y) < 260, `${a}–${b} are far apart`);
		}
	});

	test('the map file names the three halls; the drawing has no black fill by default and no old name', () => {
		assert.deepEqual(Object.keys(mapConfig.zones), ['ALL', 'WINDOW', 'CENTER', 'ROOF']);
		// the page keeps only what is inside <svg>: the fill="none" default has to be on the inner group
		assert.match(baseSvg, /<svg[^>]*>\s*<!--[\s\S]*?-->\s*<g fill="none">/);
		assert.doesNotMatch(baseSvg, /روف|Roof/);
	});

	test('broken layouts are refused, every problem listed', () => {
		const table = layoutFile.tables[0];
		assert.throws(() => parseLayout({ tables: [] }), /non-empty/);
		assert.throws(
			() =>
				parseLayout({
					tables: [
						{ ...table, maxGuests: 9 },
						{ ...table, zone: 'GARDEN', x: 5000 },
					],
					connections: [[table.code, 'NOPE']],
				}),
			(error: Error) =>
				/maxGuests is more than capacity/.test(error.message) &&
				/used twice/.test(error.message) &&
				/zone must be/.test(error.message) &&
				/outside the plan/.test(error.message) &&
				/connection/.test(error.message),
		);
	});
});

describe('brand', () => {
	test('one place for the name: placeholders in the pages are filled from src/brand.ts', () => {
		const html = fillBrandTokens(
			'<title>منو | %BRAND_FA%</title><meta content="%BRAND_CAFE_FA% —"><link href="%BRAND_MARK%"><b>%BRAND_UNKNOWN%</b>',
		);
		assert.equal(
			html,
			`<title>منو | ${BRAND.nameFa}</title><meta content="${BRAND.cafeFa} —"><link href="${BRAND.logo.mark}"><b>%BRAND_UNKNOWN%</b>`,
		);
		for (const file of fs.readdirSync(new URL('../client/public/images/brand/', import.meta.url))) assert.match(file, /\.svg$/);
	});

	test('no page or component still names the old café', () => {
		const roots = ['../client/', '../src/'];
		const hits: string[] = [];
		const walk = (url: URL) => {
			for (const entry of fs.readdirSync(url, { withFileTypes: true })) {
				const child = new URL(entry.name + (entry.isDirectory() ? '/' : ''), url);
				if (entry.isDirectory()) {
					if (entry.name !== 'public' && entry.name !== 'node_modules') walk(child);
					continue;
				}
				if (!/\.(tsx?|html|css)$/.test(entry.name) || entry.name === 'brand.ts') continue;
				const text = fs.readFileSync(child, 'utf8');
				// «روف» as a word (not inside پروفایل, میکروفون, حروف), and the Latin name as shown text
				for (const line of text.split('\n')) {
					if (/(^|[^؀-ۿ])روف([^؀-ۿ]|$)/.test(line) || />\s*Roof|'Roof|Roof,|Roof:| Roof\b(?! running)/.test(line)) {
						hits.push(`${child.pathname.split('/roof/').pop()}: ${line.trim().slice(0, 80)}`);
					}
				}
			}
		};
		for (const root of roots) walk(new URL(root, import.meta.url));
		assert.deepEqual(hits, []);
	});
});
