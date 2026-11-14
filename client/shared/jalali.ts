// Persian (Jalali) dates for the admin forms. The browser's date picker is Gregorian only, while the café thinks
// in Persian dates (an official holiday, a phone booking «for Thursday the 15th of Aban»). The conversion goes
// through Intl's persian calendar, which every current browser and Node have, so there is no leap-year table here
// to get wrong. Dates travel as "YYYY-MM-DD" (Gregorian), exactly what the API takes.
// No imports: the tests load this file directly.

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'];

/** Indexed like Date.getDay() (0 = Sunday). */
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

export interface JalaliDate {
	year: number;
	/** 1 = فروردین … 12 = اسفند */
	month: number;
	day: number;
}

const DAY_MS = 86_400_000;
const persianParts = new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', {
	timeZone: 'UTC',
	year: 'numeric',
	month: 'numeric',
	day: 'numeric',
});

/** Noon UTC of a calendar day: far from any edge, so the time zone never moves it to another day. */
const noonOf = (iso: string) => new Date(`${iso}T12:00:00Z`);
const isoOf = (date: Date) => date.toISOString().slice(0, 10);

function jalaliOf(date: Date): JalaliDate {
	const parts = Object.fromEntries(persianParts.formatToParts(date).map((p) => [p.type, p.value]));
	return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day) };
}

/** A real Gregorian day in "YYYY-MM-DD" form (not 2026-02-30). */
export function isIsoDate(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(noonOf(value).getTime()) && isoOf(noonOf(value)) === value;
}

/** "2026-11-04" → { year: 1405, month: 8, day: 13 } (null for anything that is not a real day). */
export function isoToJalali(iso: string): JalaliDate | null {
	return isIsoDate(iso) ? jalaliOf(noonOf(iso)) : null;
}

/** { year: 1405, month: 8, day: 13 } → "2026-11-04"; null for a day the month does not have (31 Mehr, 30 Esfand of a common year). */
export function jalaliToIso({ year, month, day }: JalaliDate): string | null {
	if (![year, month, day].every(Number.isInteger) || year < 1300 || year > 1500 || month < 1 || month > 12 || day < 1 || day > 31)
		return null;
	// 1 Farvardin is 20 or 21 March of year + 621; months 1–6 have 31 days, 7–11 have 30
	const offset = (month <= 7 ? (month - 1) * 31 : 186 + (month - 7) * 30) + day - 1;
	const guess = Date.UTC(year + 621, 2, 21 + offset, 12);
	for (const shift of [0, -1, 1, -2, 2]) {
		const date = new Date(guess + shift * DAY_MS);
		const j = jalaliOf(date);
		if (j.year === year && j.month === month && j.day === day) return isoOf(date);
	}
	return null;
}

export function daysInJalaliMonth(year: number, month: number): number {
	if (month <= 6) return 31;
	if (month <= 11) return 30;
	return jalaliToIso({ year, month: 12, day: 30 }) ? 30 : 29;
}

/** Today in Tehran as "YYYY-MM-DD" (not the device's own time zone: a laptop set to UTC is a day behind after midnight). */
export function tehranToday(now = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Days from `from` to `to` (both "YYYY-MM-DD"). */
export function daysBetween(from: string, to: string): number {
	return Math.round((noonOf(to).getTime() - noonOf(from).getTime()) / DAY_MS);
}

const faDigits = (n: number) => n.toLocaleString('fa-IR', { useGrouping: false });

/** "2026-11-04" → «چهارشنبه ۱۳ آبان ۱۴۰۵» ('' for anything that is not a real day). */
export function jalaliLabel(iso: string, { weekday = true }: { weekday?: boolean } = {}): string {
	const j = isoToJalali(iso);
	if (!j) return '';
	const date = `${faDigits(j.day)} ${JALALI_MONTHS[j.month - 1]} ${faDigits(j.year)}`;
	return weekday ? `${WEEKDAYS[noonOf(iso).getUTCDay()]} ${date}` : date;
}

/** The calendar day (Tehran) of a stored moment, e.g. a closure's date, as "YYYY-MM-DD". */
export function tehranDayOf(moment: string | Date): string {
	return tehranToday(new Date(moment));
}
