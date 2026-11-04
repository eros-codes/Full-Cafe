import { faDigits } from '../../shared/format.js';

// The working hours as the About page shows them (GET /api/working-hours: the hours of the panel's «ساعت کاری»,
// the same ones the bookings follow). Pure: unit-tested in test/site-hours.test.ts.

export interface WorkingDay {
	/** 0 = Sunday … 6 = Saturday (JavaScript's numbering, as stored). */
	dayOfWeek: number;
	opensAt: string;
	closesAt: string;
	isClosed: boolean;
}

export interface HoursLine {
	days: string;
	hours: string;
}

/** The Persian week starts on Saturday. */
const WEEK = [6, 0, 1, 2, 3, 4, 5];
const DAY_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

/** «09:00» → «۹ صبح» (opening), «23:30» → «۲۳:۳۰», «24:00» → «۲۴». */
export function hourText(time: string, opening: boolean): string {
	const [h, m] = time.split(':').map(Number);
	const text = m ? `${h}:${String(m).padStart(2, '0')}` : String(h);
	return faDigits(text) + (opening && h < 12 ? ' صبح' : '');
}

const dayHours = (day: WorkingDay | undefined) => (!day || day.isClosed ? 'تعطیل' : `${hourText(day.opensAt, true)} تا ${hourText(day.closesAt, false)}`);

/**
 * The week in as few lines as possible: consecutive days with the same hours together, from Saturday.
 * «هر روز هفته» / «۹ صبح تا ۲۴» when every day is the same. A day without a row is closed (as for bookings).
 */
export function weekLines(days: readonly WorkingDay[]): HoursLine[] {
	const byDay = new Map(days.map((day) => [day.dayOfWeek, day]));
	const groups: { from: number; to: number; hours: string }[] = [];
	for (const d of WEEK) {
		const hours = dayHours(byDay.get(d));
		const last = groups.at(-1);
		if (last && last.hours === hours) last.to = d;
		else groups.push({ from: d, to: d, hours });
	}
	if (groups.length === 1) return [{ days: 'هر روز هفته', hours: groups[0].hours }];
	return groups.map(({ from, to, hours }) => {
		const span = WEEK.indexOf(to) - WEEK.indexOf(from);
		const label = span === 0 ? DAY_FA[from] : span === 1 ? `${DAY_FA[from]} و ${DAY_FA[to]}` : `${DAY_FA[from]} تا ${DAY_FA[to]}`;
		return { days: label, hours };
	});
}

/** The line under «یه فنجون قهوه منتظرته»: only when it is true for every day of the week (otherwise null). */
export function invitationLine(days: readonly WorkingDay[]): string | null {
	const lines = weekLines(days);
	if (lines.length !== 1 || lines[0].hours === 'تعطیل') return null;
	const day = days[0];
	const opensMorning = Number(day.opensAt.split(':')[0]) < 12;
	if (opensMorning && day.closesAt === '24:00') return 'از صبح تا نیمه‌شب، هر روز هفته';
	return `هر روز هفته، ${lines[0].hours}`;
}

/** The current year of the Persian calendar, in Persian digits («۱۴۰۵»). */
export function persianYear(date: Date = new Date()): string {
	const year = new Intl.DateTimeFormat('en-US-u-ca-persian', { year: 'numeric' }).format(date).replace(/\D/g, '');
	return faDigits(year);
}
