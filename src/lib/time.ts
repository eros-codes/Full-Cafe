import { randomInt } from 'crypto';

/** A clock time inside the day, 00:00–23:59. */
export const CLOCK_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** A closing / end time: 00:00–23:59, or 24:00 for "until midnight". */
export const CLOSING_TIME = /^(([01]\d|2[0-3]):[0-5]\d|24:00)$/;
export const END_OF_DAY = '24:00';
const MINUTES_PER_DAY = 24 * 60;

export function pad2(value: number | string): string {
	return String(value).padStart(2, '0');
}

export function minutesToTime(totalMinutes: number): string {
	const total = Number(totalMinutes);
	// بدون این محافظ، ورودی بزرگ‌تر از یک شبانه‌روز خروجی نامعتبری مثل "25:00" می‌سازه
	if (!Number.isFinite(total) || total < 0 || total > 1439) {
		throw new Error(`دقیقه خارج از محدوده‌ی یک شبانه‌روز است: ${totalMinutes}`);
	}
	const h = Math.floor(total / 60);
	const m = total % 60;
	return `${pad2(h)}:${pad2(m)}`;
}

/**
 * "HH:MM" → minutes since midnight. `allowEndOfDay` also accepts "24:00" (= 1440), which is only
 * meaningful as a closing / end time ("open until midnight").
 */
export function timeToMinutes(time: string, { allowEndOfDay = false }: { allowEndOfDay?: boolean } = {}): number {
	if (allowEndOfDay && time === END_OF_DAY) return MINUTES_PER_DAY;
	const [h, m] = String(time).split(':').map(Number);
	if (!Number.isFinite(h) || !Number.isFinite(m)) throw new Error(`فرمت ساعت نامعتبر است: ${time}`);
	if (h < 0 || h > 23 || m < 0 || m > 59) throw new Error(`ساعت خارج از محدوده‌ی معتبر است: ${time}`);
	return h * 60 + m;
}

/** Minutes since midnight → "HH:MM" for an end time; exactly midnight at the end of the day is "24:00". */
export function endMinutesToTime(totalMinutes: number): string {
	return totalMinutes === MINUTES_PER_DAY ? END_OF_DAY : minutesToTime(totalMinutes);
}

/** A real calendar date in "YYYY-MM-DD" form (rejects 2026-02-30, 2026-13-01, …). */
export function isValidDateString(value: unknown): value is string {
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const d = new Date(year, month - 1, day);
	return d.getFullYear() === year && d.getMonth() === month - 1 && d.getDate() === day;
}

export function dateOnlyString(date: Date | string | number = new Date()): string {
	const d = new Date(date);
	// بر اساس وقت محلی (Asia/Tehran) نه UTC، وگرنه بامدادها تاریخ دیروز برمی‌گرده
	return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function combineDateAndTime(dateString: string, timeString: string): Date {
	const [year, month, day] = dateString.split('-').map(Number);
	const [hour, minute] = timeString.split(':').map(Number);
	return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function addMinutes(date: Date | string | number, minutes: number): Date {
	return new Date(new Date(date).getTime() + minutes * 60 * 1000);
}

export function overlapWithBuffer(startA: Date, endA: Date, startB: Date, endB: Date, bufferMinutes = 0): boolean {
	const bufferedStartB = addMinutes(startB, -bufferMinutes);
	const bufferedEndB = addMinutes(endB, bufferMinutes);
	return startA < bufferedEndB && endA > bufferedStartB;
}

export function makeTimeSlots(openTime: string, closeTime: string, intervalMinutes = 15): string[] {
	const step = Number(intervalMinutes);
	// بدون این محافظ، مقدار صفر یا منفی حلقه رو بی‌نهایت می‌کنه و کل سرور قفل می‌شه
	if (!Number.isFinite(step) || step <= 0) {
		throw new Error(`فاصله‌ی زمانی اسلات باید عددی بزرگ‌تر از صفر باشد: ${intervalMinutes}`);
	}
	const slots: string[] = [];
	// closeTime می‌تواند 24:00 باشد؛ ولی شروع رزرو همیشه داخل همان روز است (حداکثر 23:59)
	const end = Math.min(timeToMinutes(closeTime, { allowEndOfDay: true }), MINUTES_PER_DAY - 1);
	for (let m = timeToMinutes(openTime); m <= end; m += step) {
		slots.push(minutesToTime(m));
	}
	return slots;
}

export function addDays(date: Date | string | number, days: number): Date {
	const copy = new Date(date);
	copy.setDate(copy.getDate() + days);
	return copy;
}

/** Persian (۰–۹) and Arabic-Indic (٠–٩) digits → 0–9. Phone keyboards in Iran often type these. */
export function latinDigits(value: string): string {
	return value.replace(/[\u06F0-\u06F9]/g, (d) => String(d.charCodeAt(0) - 0x06f0)).replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function normalizePhone(phone: unknown): string {
	// قبلاً شماره‌ای که با کیبورد فارسی (۰۹۱۲…) تایپ می‌شد کلاً حذف و «نامعتبر» می‌شد
	let p = latinDigits(String(phone || ''))
		.trim()
		.replace(/[^0-9+]/g, '');
	if (p.startsWith('+98')) p = '0' + p.slice(3);
	else if (p.startsWith('0098')) p = '0' + p.slice(4);
	else if (p.startsWith('98') && p.length === 12) p = '0' + p.slice(2);
	else if (p.length === 10 && p.startsWith('9')) p = '0' + p;
	return /^09\d{9}$/.test(p) ? p : '';
}

// ۹ رقم به‌جای ۶ رقم: فضای حالت هزار برابر می‌شه و randomInt هم
// برخلاف Math.random قابل حدس زدن نیست (این کدها کلید پیگیری مهمان‌اند)
function randomDigits(length: number): string {
	let out = '';
	for (let i = 0; i < length; i += 1) out += randomInt(0, 10);
	return out;
}

export function generateTrackingCode(): string {
	return `RSV-${randomDigits(9)}`;
}

export function generateInvoiceNumber(): string {
	return `INV-${randomDigits(9)}`;
}

// Removed dead helpers `toFaZone` and `toFaReservationStatus` because they are unused
// and their translations differ from other parts of the project. If needed,
// reintroduce a single canonical implementation used across the codebase.
