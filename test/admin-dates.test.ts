// Persian dates in the admin forms (client/shared/jalali.ts). No database needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
	daysBetween,
	daysInJalaliMonth,
	isoToJalali,
	jalaliLabel,
	jalaliToIso,
	tehranDayOf,
	tehranToday,
} from '../client/shared/jalali.js';

describe('admin forms: Persian dates', () => {
	test('known days both ways', () => {
		for (const [iso, j] of [
			['2026-11-04', { year: 1405, month: 8, day: 13 }],
			['2026-03-21', { year: 1405, month: 1, day: 1 }],
			['2025-03-20', { year: 1403, month: 12, day: 30 }], // last day of a leap year
			['2026-09-22', { year: 1405, month: 6, day: 31 }],
			['2026-09-23', { year: 1405, month: 7, day: 1 }],
		] as const) {
			assert.deepEqual(isoToJalali(iso), j, iso);
			assert.equal(jalaliToIso(j), iso, JSON.stringify(j));
		}
	});

	test('every day of fifteen years goes there and back', () => {
		let day = new Date(Date.UTC(2020, 0, 1, 12));
		for (let i = 0; i < 365 * 15; i++, day = new Date(day.getTime() + 86_400_000)) {
			const iso = day.toISOString().slice(0, 10);
			assert.equal(jalaliToIso(isoToJalali(iso)!), iso);
		}
	});

	test('days a month does not have are refused, not moved to the next month', () => {
		assert.equal(jalaliToIso({ year: 1405, month: 7, day: 31 }), null, 'Mehr has 30 days');
		assert.equal(jalaliToIso({ year: 1404, month: 12, day: 30 }), null, '1404 is not a leap year');
		assert.equal(jalaliToIso({ year: 1405, month: 13, day: 1 }), null);
		assert.equal(isoToJalali('2026-02-30'), null);
		assert.equal(isoToJalali('not a date'), null);
		assert.deepEqual(
			[1, 6, 7, 11].map((m) => daysInJalaliMonth(1405, m)),
			[31, 31, 30, 30],
		);
		assert.deepEqual(
			[1399, 1403, 1404, 1408].map((y) => daysInJalaliMonth(y, 12)),
			[30, 30, 29, 30],
		);
	});

	test('labels in Persian, with the weekday', () => {
		assert.equal(jalaliLabel('2026-11-04'), 'چهارشنبه ۱۳ آبان ۱۴۰۵');
		assert.equal(jalaliLabel('2026-11-06', { weekday: false }), '۱۵ آبان ۱۴۰۵');
		assert.equal(jalaliLabel(''), '');
	});

	test('today and stored dates are read in Tehran, whatever the device time zone', () => {
		// 00:30 in Tehran on 5 Nov is still 4 Nov in UTC
		assert.equal(tehranToday(new Date('2026-11-04T21:00:00Z')), '2026-11-05');
		// a closure stored as Tehran midnight
		assert.equal(tehranDayOf('2026-11-04T20:30:00.000Z'), '2026-11-05');
		assert.equal(daysBetween('2026-11-04', '2026-11-06'), 2);
		assert.equal(daysBetween('2026-11-04', '2026-11-03'), -1);
	});
});
