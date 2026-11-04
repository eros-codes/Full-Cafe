// The working hours on the About page (client/site/about/hours.ts). No database needed.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { hourText, invitationLine, persianYear, weekLines, type WorkingDay } from '../client/site/about/hours.js';

const week = (hours: (Partial<WorkingDay> | null)[]): WorkingDay[] =>
	// index 0 = Saturday … 6 = Friday, as the café reads the week; stored with JavaScript's day numbers
	hours.flatMap((h, i) => (h === null ? [] : [{ dayOfWeek: (i + 6) % 7, opensAt: '09:00', closesAt: '24:00', isClosed: false, ...h }]));

describe('About page: working hours', () => {
	test('times in Persian digits, «صبح» on a morning opening', () => {
		assert.equal(hourText('09:00', true), '۹ صبح');
		assert.equal(hourText('14:00', true), '۱۴');
		assert.equal(hourText('23:30', false), '۲۳:۳۰');
		assert.equal(hourText('24:00', false), '۲۴');
	});

	test('the same hours every day: one line, and the invitation says so', () => {
		const same = week(Array(7).fill({}));
		assert.deepEqual(weekLines(same), [{ days: 'هر روز هفته', hours: '۹ صبح تا ۲۴' }]);
		assert.equal(invitationLine(same), 'از صبح تا نیمه‌شب، هر روز هفته');
		const early = week(Array(7).fill({ closesAt: '21:00' }));
		assert.deepEqual(weekLines(early), [{ days: 'هر روز هفته', hours: '۹ صبح تا ۲۱' }]);
		assert.equal(invitationLine(early), 'هر روز هفته، ۹ صبح تا ۲۱', 'not «تا نیمه‌شب» when the café closes at nine');
	});

	test('days with other hours or closed: grouped from Saturday, and no invitation line', () => {
		const days = week([{}, {}, {}, {}, {}, { opensAt: '10:00', closesAt: '23:00' }, { isClosed: true }]);
		assert.deepEqual(weekLines(days), [
			{ days: 'شنبه تا چهارشنبه', hours: '۹ صبح تا ۲۴' },
			{ days: 'پنجشنبه', hours: '۱۰ صبح تا ۲۳' },
			{ days: 'جمعه', hours: 'تعطیل' },
		]);
		assert.equal(invitationLine(days), null);
		const two = week([{}, {}, {}, {}, {}, { closesAt: '23:00' }, { closesAt: '23:00' }]);
		assert.equal(weekLines(two)[1].days, 'پنجشنبه و جمعه');
		// a day without a row is closed, as for the bookings
		assert.deepEqual(weekLines(week([{}, {}, {}, {}, {}, {}, null])).at(-1), { days: 'جمعه', hours: 'تعطیل' });
		assert.equal(invitationLine(week(Array(7).fill({ isClosed: true }))), null);
	});

	test('the year of the footer follows the calendar', () => {
		assert.equal(persianYear(new Date('2026-11-03T12:00:00Z')), '۱۴۰۵');
		assert.equal(persianYear(new Date('2027-03-22T12:00:00Z')), '۱۴۰۶', 'after Nowruz');
	});
});
