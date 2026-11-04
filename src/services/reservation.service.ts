import type { Invoice, Payment, Prisma, Reservation, ReservationSource, User } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
import { serializable } from '../lib/transaction.js';
import { CLOCK_TIME, addMinutes, combineDateAndTime, generateInvoiceNumber, generateTrackingCode, isValidDateString } from '../lib/time.js';
import { getSettings, numberSetting } from './settings.service.js';
import { assertTablesAvailable } from './availability.service.js';
import { reminderMessage, sendMockSms } from '../lib/sms.js';
import { config } from '../config.js';
import { createHttpError, errorMessage, HttpError, prismaCode } from '../lib/http-error.js';
import { CANCEL_WINDOW_MINUTES } from '../lib/constants.js';

async function uniqueTrackingCode(client: Db): Promise<string> {
	for (let i = 0; i < 10; i++) {
		const code = generateTrackingCode();
		const existing = await client.reservation.findUnique({
			where: { trackingCode: code },
		});
		if (!existing) return code;
	}
	throw new Error('ساخت کد پیگیری ناموفق بود.');
}

async function uniqueInvoiceNumber(client: Db): Promise<string> {
	for (let i = 0; i < 10; i++) {
		const number = generateInvoiceNumber();
		const existing = await client.invoice.findUnique({ where: { number } });
		if (!existing) return number;
	}
	throw new Error('ساخت شماره فاکتور ناموفق بود.');
}

/**
 * The invoice of a paid reservation. Invoices are only issued once the reservation is paid (online payment
 * confirmed, a payment confirmed by a manager, or a staff booking paid at the café), never for a hold that may
 * expire unpaid. Safe to call twice: an existing invoice is kept.
 */
export async function ensureInvoice(client: Db, reservation: { id: string; totalAmount: number }): Promise<void> {
	if (await client.invoice.findUnique({ where: { reservationId: reservation.id } })) return;
	await client.invoice.create({ data: { reservationId: reservation.id, number: await uniqueInvoiceNumber(client), totalAmount: reservation.totalAmount } });
}

const NOTES_MAX = 500;

/**
 * The reservation's notes with one more line. Notes keep what happened (a late or second payment, the customer's
 * reason for cancelling, …) for the admin; before, each new note replaced the last one. A line already there is not
 * added twice (a repeated gateway answer), and the oldest lines give way when it gets long.
 */
export function appendNote(existing: string | null | undefined, note: string): string {
	const line = note.trim().slice(0, NOTES_MAX);
	const current = (existing ?? '').trim();
	if (!line || current.split('\n').includes(line)) return current;
	const combined = current ? `${current}\n${line}` : line;
	return combined.length > NOTES_MAX ? combined.slice(combined.length - NOTES_MAX) : combined;
}

/** Everything a booking needs; values come from request bodies, so they are re-validated here. */
export interface ReservationInput {
	tableIds: unknown;
	date: unknown;
	startTime: unknown;
	durationMinutes: unknown;
	guestCount: unknown;
	customerName: unknown;
	customerPhone: string;
	userId?: string | null;
	source?: ReservationSource;
	decoration?: boolean;
	decorationNote?: unknown;
}

const fullInclude = {
	tables: { include: { table: true } },
	payments: true,
	invoice: true,
	user: true,
} satisfies Prisma.ReservationInclude;

export type ReservationWithRelations = Prisma.ReservationGetPayload<{ include: typeof fullInclude }>;

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export async function createReservationHold({
	tableIds,
	date,
	startTime,
	durationMinutes,
	guestCount,
	customerName,
	customerPhone,
	userId = null,
	source = 'ONLINE',
	decoration = false,
	decorationNote = null,
}: ReservationInput): Promise<ReservationWithRelations> {
	if (!isStringArray(tableIds) || tableIds.length < 1 || tableIds.length > 6) throw createHttpError(400, 'انتخاب میز نامعتبر است.');
	if (new Set(tableIds).size !== tableIds.length) throw createHttpError(400, 'یک میز نمی‌تواند دوبار در یک رزرو باشد.');
	if (typeof guestCount !== 'number' || !Number.isInteger(guestCount) || guestCount < 1 || guestCount > 50) throw createHttpError(400, 'تعداد نفرات نامعتبر است.');
	if (typeof durationMinutes !== 'number' || !Number.isInteger(durationMinutes) || durationMinutes < 1) throw createHttpError(400, 'مدت رزرو نامعتبر است.');
	// قبلاً «2026-02-30» یا «25:99» از این چک رد می‌شد و به خطای ۵۰۰ می‌رسید
	if (!isValidDateString(date)) throw createHttpError(400, 'تاریخ نامعتبر است.');
	if (typeof startTime !== 'string' || !CLOCK_TIME.test(startTime)) throw createHttpError(400, 'ساعت شروع نامعتبر است.');
	if (!customerPhone) throw createHttpError(400, 'شماره موبایل نامعتبر است.');
	if (typeof customerName !== 'string' || !customerName.trim()) throw createHttpError(400, 'نام مشتری لازم است.');
	if (customerName.trim().length > 80) throw createHttpError(400, 'نام مشتری حداکثر ۸۰ کاراکتر است.');
	const name = customerName.trim();

	// خواندن تنظیمات قبل از باز شدن تراکنش، تا از استخر اتصال‌ها اتصال دوم گرفته نشود
	const settings = await getSettings();
	const pricePerGuest = numberSetting(settings, 'pricePerGuest', 100000);
	const holdMinutes = numberSetting(settings, 'holdMinutes', 10);
	// قیمت از تنظیمات خونده می‌شه نه از ورودی کاربر، وگرنه می‌شد مبلغ دلخواه فرستاد
	const decorationPrice = numberSetting(settings, 'decorationPrice', 0, { min: 0 });
	const decorationAmount = decoration && decorationPrice > 0 ? decorationPrice : 0;
	const safeDecorationNote = decorationAmount > 0 && decorationNote ? String(decorationNote).trim().slice(0, 200) || null : null;

	try {
		return await serializable(async (tx) => {
				// A customer's new hold lets go of their earlier unpaid ones. Before, going back from the payment page
				// and picking the same table again failed («رزرو شده است») because their own hold still had it, and
				// every try kept another table locked until it ran out. A payment still made on an old gateway page is
				// handled by the callback like any late payment (confirmed if the table is free, otherwise refunded).
				if (source === 'ONLINE' && userId) {
					const released = await tx.reservation.updateMany({ where: { userId, status: 'HOLD' }, data: { status: 'EXPIRED' } });
					if (released.count) {
						await tx.payment.updateMany({ where: { status: 'PENDING', reservation: { userId, status: 'EXPIRED' } }, data: { status: 'FAILED' } });
					}
				}
				await assertTablesAvailable({ tableIds, date, startTime, durationMinutes, guestCount }, tx, {
					// رزرو دستی پرسنل (تلفنی/حضوری) می‌تونه برای همین الان یا چند دقیقه‌ی بعد ثبت بشه
					ignoreLeadTime: source === 'ADMIN_MANUAL',
				});
				const totalAmount = pricePerGuest * guestCount + decorationAmount;
				const startAt = combineDateAndTime(date, startTime);
				const endAt = addMinutes(startAt, durationMinutes);
				const trackingCode = await uniqueTrackingCode(tx);
				const manual = source === 'ADMIN_MANUAL';
				const holdExpiresAt = addMinutes(new Date(), holdMinutes);

				return tx.reservation.create({
					data: {
						trackingCode,
						userId,
						customerName: name,
						customerPhone,
						guestCount,
						startAt,
						endAt,
						durationMinutes,
						status: manual ? 'CONFIRMED' : 'HOLD',
						source,
						holdExpiresAt: manual ? null : holdExpiresAt,
						pricePerGuest,
						totalAmount,
						decorationAmount,
						decorationNote: safeDecorationNote,
						paidAmount: manual ? totalAmount : 0,
						tables: {
							create: tableIds.map((tableId) => ({ tableId })),
						},
						// a staff booking is paid at the café, so its invoice exists at once; an online hold gets one when it is paid
						...(manual ? { invoice: { create: { number: await uniqueInvoiceNumber(tx), totalAmount } } } : {}),
						payments: {
							create: {
								amount: totalAmount,
								status: manual ? 'PAID' : 'PENDING',
								method: manual ? 'MANUAL' : 'ZARINPAL',
								provider: manual ? 'manual' : 'zarinpal',
							},
						},
					},
					include: fullInclude,
				});
		});
	} catch (error) {
		if (prismaCode(error) === 'P2034') throw createHttpError(409, 'این میز همین الان توسط شخص دیگری رزرو شد؛ یک گزینه‌ی دیگر انتخاب کن.');
		if (error instanceof HttpError) throw error;
		throw createHttpError(500, errorMessage(error) || 'رزرو ناموفق بود.');
	}
}

const fullIncludeOrdered = {
	...fullInclude,
	payments: { orderBy: { createdAt: 'desc' } },
} satisfies Prisma.ReservationInclude;

export type ReservationFull = Prisma.ReservationGetPayload<{ include: typeof fullIncludeOrdered }>;

export async function getReservationFull(idOrCode: unknown): Promise<ReservationFull | null> {
	if (typeof idOrCode !== 'string' || !idOrCode.trim()) return null;
	const where: Prisma.ReservationWhereUniqueInput = idOrCode.startsWith('RSV-') ? { trackingCode: idOrCode } : { id: idOrCode };
	return prisma.reservation.findUnique({
		where,
		include: fullIncludeOrdered,
	});
}

// ─── What a customer sees ────────────────────────────────────────────────────

/** The account as the customer sees it (no token version or other internals). */
export const toCustomerUser = (user: Pick<User, 'id' | 'name' | 'phone'>) => ({ id: user.id, name: user.name, phone: user.phone });

type CustomerSource = Reservation & { payments?: Payment[]; user?: User | null; invoice?: Invoice | null };

/**
 * A reservation as the booking pages get it: the payments without the gateway's raw answer and authority
 * (the authority is what the payment callback looks payments up by), the account without its internals.
 */
export function toCustomerReservation<R extends CustomerSource>(reservation: R) {
	// notes are for the café (why a payment is under review, what is owed back): not part of the customer's view
	const { payments, user, invoice, notes: _notes, ...rest } = reservation;
	return {
		...rest,
		...(payments ? { payments: payments.map(({ id, status, amount, refId, createdAt, verifiedAt }) => ({ id, status, amount, refId, createdAt, verifiedAt })) } : {}),
		...(user !== undefined ? { user: user && toCustomerUser(user) } : {}),
		...(invoice !== undefined ? { invoice: invoice && { number: invoice.number, totalAmount: invoice.totalAmount, createdAt: invoice.createdAt } } : {}),
	};
}

export async function createManualReservation(data: Omit<ReservationInput, 'source'>): Promise<ReservationWithRelations> {
	return createReservationHold({ ...data, source: 'ADMIN_MANUAL' });
}

/** Customers may cancel a confirmed reservation up to CANCEL_WINDOW_MINUTES before it starts. */
export function canCancel(reservation: { startAt: Date; status: string }): boolean {
	const deadline = addMinutes(new Date(), CANCEL_WINDOW_MINUTES);
	return reservation.startAt > deadline && reservation.status === 'CONFIRMED';
}

export async function cancelReservation(reservationId: string, note: string | null = '') {
	const reservation = await getReservationFull(reservationId);
	if (!reservation) throw createHttpError(404, 'رزرو پیدا نشد.');
	// قبلاً اینجا Error ساده پرتاب می‌شد و کاربر به‌جای دلیل واقعی «خطای داخلی سرور» می‌دید
	if (!canCancel(reservation)) throw createHttpError(409, 'لغو رزرو فقط تا ۲ ساعت قبل از شروع و برای رزرو تاییدشده مجاز است.');
	// اگر پول واقعی پرداخت شده، لغو باید بدهی بازگشت وجه را ثبت کند —
	// مشابه رفتار مسیر لغو توسط ادمین
	// هر پرداخت PAID یعنی پول گرفته شده و لغو باید بدهی بازگشت وجه ثبت کند
	const paidReal = (reservation.payments || []).some((p) => p.status === 'PAID');
	const updated = await prisma.$transaction(async (tx) => {
		// شرط وضعیت داخل همان update: دو درخواست لغو هم‌زمان فقط یک‌بار اثر دارند
		const changed = await tx.reservation.updateMany({
			where: { id: reservation.id, status: 'CONFIRMED' },
			data: {
				status: 'CANCELLED',
				notes: note ? appendNote(reservation.notes, note) : reservation.notes,
				...(paidReal ? { refundStatus: 'PENDING' } : {}),
			},
		});
		if (changed.count === 0) throw createHttpError(409, 'وضعیت این رزرو همین الان تغییر کرد.');
		if (paidReal) {
			await tx.payment.updateMany({
				where: { reservationId: reservation.id, status: 'PAID' },
				data: { status: 'REFUND_PENDING' },
			});
		}
		return tx.reservation.findUnique({ where: { id: reservation.id } });
	});
	await sendMockSms({
		phone: reservation.customerPhone,
		type: 'CANCELLATION',
		message: paidReal
			? `رزرو ${reservation.trackingCode} لغو شد. برای بازگشت وجه با مجموعه تماس بگیرید.`
			: `رزرو ${reservation.trackingCode} لغو شد.`,
	}).catch((error) => console.error('SMS لغو ارسال نشد:', error));
	return updated;
}

export async function sendDueReminders(): Promise<number> {
	const settings = await getSettings();
	const reminderMinutes = numberSetting(settings, 'reminderBeforeMinutes', 180, { min: 0 });
	if (reminderMinutes <= 0) return 0;

	const now = new Date();
	const windowEnd = addMinutes(now, reminderMinutes);

	const due = await prisma.reservation.findMany({
		where: {
			status: 'CONFIRMED',
			reminderSentAt: null,
			startAt: { gt: now, lte: windowEnd },
		},
		include: { tables: { include: { table: true } } },
		take: 50,
	});

	let sent = 0;
	for (const reservation of due) {
		const bookedInsideWindow = addMinutes(new Date(reservation.createdAt), reminderMinutes) >= new Date(reservation.startAt);
		if (bookedInsideWindow) {
			await prisma.reservation.update({ where: { id: reservation.id }, data: { reminderSentAt: now } }).catch(() => {});
			continue;
		}

		try {
			await sendMockSms({
				phone: reservation.customerPhone,
				type: 'REMINDER',
				message: reminderMessage(reservation, reminderMinutes),
			});
			await prisma.reservation.update({ where: { id: reservation.id }, data: { reminderSentAt: new Date() } });
			sent += 1;
		} catch (error) {
			console.error(`ارسال یادآوری برای رزرو ${reservation.trackingCode} ناموفق بود:`, error);
		}
	}
	return sent;
}
