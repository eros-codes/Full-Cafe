import type { Prisma, ReservationSource } from '@prisma/client';
import { prisma, type Db } from '../lib/prisma.js';
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
		return await prisma.$transaction(
			async (tx) => {
				await assertTablesAvailable({ tableIds, date, startTime, durationMinutes, guestCount }, tx, {
					// رزرو دستی پرسنل (تلفنی/حضوری) می‌تونه برای همین الان یا چند دقیقه‌ی بعد ثبت بشه
					ignoreLeadTime: source === 'ADMIN_MANUAL',
				});
				const totalAmount = pricePerGuest * guestCount + decorationAmount;
				const startAt = combineDateAndTime(date, startTime);
				const endAt = addMinutes(startAt, durationMinutes);
				const trackingCode = await uniqueTrackingCode(tx);
				const invoiceNumber = await uniqueInvoiceNumber(tx);
				const holdExpiresAt = addMinutes(new Date(), holdMinutes);

				return tx.reservation.create({
					data: {
						trackingCode,
						userId,
						customerName,
						customerPhone,
						guestCount,
						startAt,
						endAt,
						durationMinutes,
						status: source === 'ADMIN_MANUAL' ? 'CONFIRMED' : 'HOLD',
						source,
						holdExpiresAt: source === 'ADMIN_MANUAL' ? null : holdExpiresAt,
						pricePerGuest,
						totalAmount,
						decorationAmount,
						decorationNote: safeDecorationNote,
						paidAmount: source === 'ADMIN_MANUAL' ? totalAmount : 0,
						tables: {
							create: tableIds.map((tableId) => ({ tableId })),
						},
						invoice: {
							create: { number: invoiceNumber, totalAmount },
						},
						payments: {
							create: {
								amount: totalAmount,
								status: source === 'ADMIN_MANUAL' ? 'PAID' : 'PENDING',
								method: source === 'ADMIN_MANUAL' ? 'MANUAL' : 'ZARINPAL',
								provider: source === 'ADMIN_MANUAL' ? 'manual' : 'zarinpal',
								isMock: false,
							},
						},
					},
					include: {
						tables: { include: { table: true } },
						payments: true,
						invoice: true,
						user: true,
					},
				});
			},
			{ isolationLevel: 'Serializable' },
		);
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
				notes: String(note || reservation.notes || '').slice(0, 500) || null,
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
