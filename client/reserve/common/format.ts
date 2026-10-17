import { faNumber } from '../../shared/format';

export { faNumber, toman } from '../../shared/format';

const STATUS_FA: Record<string, string> = {
	DRAFT: 'پیش‌نویس',
	HOLD: 'رزرو موقت',
	PAYMENT_PENDING: 'در انتظار پرداخت',
	PAYMENT_REVIEW: 'بررسی پرداخت',
	CONFIRMED: 'تایید شده',
	CANCELLED: 'لغو شده',
	COMPLETED: 'تکمیل‌شده',
	NO_SHOW: 'عدم حضور',
	EXPIRED: 'منقضی شده',
};

export function statusFa(status: string): string {
	return STATUS_FA[status] || status;
}

export const PAYMENT_STATUS_FA: Record<string, string> = {
	PENDING: 'در انتظار',
	PAID: 'پرداخت‌شده',
	FAILED: 'ناموفق',
	REVIEW: 'در حال بررسی',
	REFUND_PENDING: 'در انتظار بازگشت وجه',
	REFUNDED: 'بازگشت داده شده',
};

export const REFUND_STATUS_FA: Record<string, string> = {
	PENDING: 'در انتظار بازگشت به شما',
	DONE: 'بازگشت داده شد',
};

export function faDateTime(value: string | Date | null | undefined): string {
	const d = new Date(value ?? '');
	if (Number.isNaN(d.getTime())) return '—';
	return d.toLocaleString('fa-IR', { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * End time of a reservation, e.g. «۱۷:۰۰». A booking that ends exactly at midnight of the next day
 * (the café closes at 24:00) is shown as «۲۴:۰۰», not «۰۰:۰۰».
 */
export function endTimeFa(startAt: string | Date, endAt: string | Date): string {
	const start = new Date(startAt);
	const end = new Date(endAt);
	if (Number.isNaN(end.getTime())) return '—';
	if (end.getHours() === 0 && end.getMinutes() === 0 && end.toDateString() !== start.toDateString()) {
		return (24).toLocaleString('fa-IR', { minimumIntegerDigits: 2 }) + ':' + (0).toLocaleString('fa-IR', { minimumIntegerDigits: 2 });
	}
	return end.toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
}

/** "1 و 3" — the display numbers of a reservation's tables. */
export function tablesText(reservation: { tables?: { table?: { displayNumber?: string } | null }[] } | null | undefined): string {
	const tables = reservation?.tables;
	if (!Array.isArray(tables) || tables.length === 0) return '—';
	return tables.map((rt) => rt?.table?.displayNumber ?? '؟').join(' و ');
}

export function faHours(minutes: unknown): string {
	const n = Number(minutes);
	return faNumber(Number.isFinite(n) ? n / 60 : 0);
}
