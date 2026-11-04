import express from 'express';
import type { Payment, Prisma, Reservation, ReservationStatus } from '@prisma/client';
import { errorMessage } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { serializable } from '../lib/transaction.js';
import { requestZarinpalPayment, verifyZarinpalPayment, type VerifyResult } from '../lib/payment.js';
import { confirmationMessage, notConfirmedMessage, sendMockSms } from '../lib/sms.js';
import { appendNote, ensureInvoice, getReservationFull } from '../services/reservation.service.js';
import { findConflictingReservations } from '../services/availability.service.js';
import { config } from '../config.js';
import rateLimit from 'express-rate-limit';
import { optionalUser } from '../middleware/auth.js';
import { hasReservationAccess } from './reservation.routes.js';

// Online payment with Zarinpal. Every trip to the gateway is its own Payment row with its own authority, so a
// customer who pays on an older gateway page (went back, pressed «پرداخت» again, paid on the first tab) is still
// found by the callback. The callback only ever changes the one payment it is about, and never overwrites a
// reservation that another callback has already confirmed.

const paymentRequestLimiter = rateLimit({
	// در تست‌های خودکار همه‌ی درخواست‌ها از یک IP می‌آیند
	skip: () => config.isTest,
	windowMs: 10 * 60 * 1000,
	max: 8,
	keyGenerator: (req) => `${req.ip}:${req.params.reservationId}`,
	message: { message: 'تعداد درخواست پرداخت بیش از حد مجاز است.' },
});

export const paymentRouter = express.Router();

function isPayable(reservation: Pick<Reservation, 'status' | 'holdExpiresAt'>): boolean {
	// فقط نگه‌داری فعال قابل پرداخت است. PAYMENT_REVIEW یعنی پول قبلاً گرفته شده و منتظر بررسی دستیه؛
	// اجازه‌ی پرداخت دوباره یعنی دو بار پول گرفتن از مشتری
	if (reservation.status !== 'HOLD') return false;
	if (reservation.holdExpiresAt && reservation.holdExpiresAt < new Date()) return false;
	return true;
}

/** A reservation that is already paid for and settled: more money for it is owed back to the customer. */
function isSettled(reservation: Pick<Reservation, 'status' | 'paidAmount'>): boolean {
	const settled: ReservationStatus[] = ['CONFIRMED', 'COMPLETED', 'NO_SHOW'];
	return settled.includes(reservation.status) || (reservation.status === 'CANCELLED' && reservation.paidAmount > 0);
}

/** The states a payment may be confirmed from (FAILED: a hold expired while the customer was on the gateway). */
const OPEN_PAYMENT: Payment['status'][] = ['PENDING', 'FAILED', 'REVIEW'];
/** Reservations a payment may still turn into PAYMENT_REVIEW; never one that is confirmed or closed. */
const REVIEWABLE: ReservationStatus[] = ['HOLD', 'EXPIRED'];

const REVIEW_NOTE = 'پرداخت بعد از پایان زمان نگه‌داری یا لغو رزرو انجام شد و میز در دسترس نبود؛ نیاز به بررسی و بازگشت وجه.';
const DUPLICATE_NOTE = 'این رزرو قبلاً پرداخت شده بود و مشتری دوباره پرداخت کرد؛ مبلغ دوم باید برگردانده شود.';
const UNKNOWN_NOTE = 'پرداخت دیگری برای این رزرو در درگاه انجام شد ولی تاییدش از زرین‌پال نرسید؛ در پنل زرین‌پال بررسی و در صورت کسر، برگردانده شود.';

type ConfirmOutcome = 'confirmed' | 'already' | 'review' | 'duplicate';

/**
 * Zarinpal confirmed this payment; records it.
 *   confirmed → the reservation is confirmed (and gets its invoice)
 *   already   → this same payment was recorded before (a repeated callback)
 *   review    → the hold had run out (or the reservation was cancelled / already in review) and the table is no
 *               longer free: PAYMENT_REVIEW, for a manager to confirm or cancel with a refund
 *   duplicate → the reservation was already paid by another payment: this one is owed back
 */
async function confirmPaid(reservationId: string, paymentId: string, refId: string | null, rawResponse: Prisma.InputJsonValue): Promise<ConfirmOutcome> {
	return serializable(async (tx): Promise<ConfirmOutcome> => {
		const [fresh, payment] = await Promise.all([tx.reservation.findUnique({ where: { id: reservationId } }), tx.payment.findUnique({ where: { id: paymentId } })]);
		if (!fresh || !payment) throw new Error('رزرو یا پرداخت پیدا نشد.');
		if (payment.status === 'PAID' || payment.status === 'REFUND_PENDING' || payment.status === 'REFUNDED') return payment.status === 'PAID' ? 'already' : 'duplicate';
		const now = new Date();

		if (isSettled(fresh)) {
			await tx.payment.update({ where: { id: payment.id }, data: { status: 'REFUND_PENDING', refId, verifiedAt: now, rawResponse } });
			await tx.reservation.update({ where: { id: fresh.id }, data: { refundStatus: 'PENDING', notes: appendNote(fresh.notes, DUPLICATE_NOTE) } });
			return 'duplicate';
		}

		// the table was not kept for this payment the whole time: confirm only if nobody else has it now.
		// PAYMENT_REVIEW is checked too: a repeated callback must not confirm a reservation whose table was taken.
		const lapsed =
			fresh.status === 'EXPIRED' ||
			fresh.status === 'PAYMENT_REVIEW' ||
			fresh.status === 'CANCELLED' ||
			(fresh.status === 'HOLD' && fresh.holdExpiresAt !== null && fresh.holdExpiresAt < now);
		const blocked = fresh.status === 'CANCELLED' || (lapsed && (await findConflictingReservations(fresh.id, tx)).length > 0);
		if (blocked) {
			await tx.payment.update({ where: { id: payment.id }, data: { status: 'REVIEW', refId, rawResponse } });
			await tx.reservation.update({ where: { id: fresh.id }, data: { status: 'PAYMENT_REVIEW', notes: appendNote(fresh.notes, REVIEW_NOTE) } });
			return 'review';
		}

		await tx.payment.update({ where: { id: payment.id }, data: { status: 'PAID', refId, verifiedAt: now, rawResponse } });
		// the other gateway trips of this reservation were not paid (if one still is, it comes back as a duplicate)
		await tx.payment.updateMany({ where: { reservationId: fresh.id, id: { not: payment.id }, status: 'PENDING' }, data: { status: 'FAILED' } });
		await tx.reservation.update({ where: { id: fresh.id }, data: { status: 'CONFIRMED', paidAmount: fresh.totalAmount, holdExpiresAt: null } });
		await ensureInvoice(tx, fresh);
		return 'confirmed';
	});
}

// مرحله ۱: شروع پرداخت - کاربر رو به درگاه زرین‌پال می‌فرسته
paymentRouter.post('/:reservationId/request', paymentRequestLimiter, optionalUser, async (req, res, next) => {
	try {
		const reservation = await getReservationFull(req.params.reservationId);
		if (!reservation) return res.status(404).json({ message: 'رزرو پیدا نشد.' });
		// قبلاً هر کسی با داشتن شناسه‌ی رزرو می‌توانست برایش درخواست پرداخت بسازد
		if (!hasReservationAccess(req, reservation)) return res.status(403).json({ message: 'دسترسی به این رزرو ندارید.' });
		if (!isPayable(reservation)) {
			if (reservation.status === 'HOLD' && reservation.holdExpiresAt && reservation.holdExpiresAt < new Date()) {
				await prisma.reservation.updateMany({ where: { id: reservation.id, status: 'HOLD' }, data: { status: 'EXPIRED' } });
			}
			return res.status(400).json({ message: 'این رزرو دیگر قابل پرداخت نیست.' });
		}

		let authority: string;
		let paymentUrl: string;
		try {
			({ authority, paymentUrl } = await requestZarinpalPayment({
				amount: reservation.totalAmount,
				description: `رزرو Roof · کد پیگیری ${reservation.trackingCode}`,
				callbackUrl: `${config.appUrl}/api/payments/callback`,
				mobile: reservation.customerPhone,
			}));
		} catch (gatewayError) {
			// خطای سرویس بیرونی نباید ۵۰۰ بشه؛ وگرنه در production پیامش
			// با متن عمومی جایگزین می‌شه و دلیل واقعی گم می‌شه
			console.error('درخواست پرداخت از زرین‌پال ناموفق بود:', gatewayError);
			return res.status(502).json({ message: `اتصال به درگاه پرداخت ممکن نشد: ${errorMessage(gatewayError)}` });
		}

		// The first trip uses the payment made with the hold; every later one gets its own row. Before, each new
		// trip overwrote the authority of the last one, and paying on an older gateway page was never found.
		// The unused row is claimed in the update itself: two «پرداخت» taps at once must not both write into it
		// (the first page's authority would be lost, and paying on it never found).
		const unused = reservation.payments.find((p) => p.status === 'PENDING' && !p.authority);
		const claimed = unused ? await prisma.payment.updateMany({ where: { id: unused.id, authority: null }, data: { authority } }) : { count: 0 };
		if (claimed.count === 0) {
			await prisma.payment.create({
				data: { reservationId: reservation.id, amount: reservation.totalAmount, status: 'PENDING', method: 'ZARINPAL', provider: 'zarinpal', authority },
			});
		}

		res.json({ paymentUrl });
	} catch (error) {
		next(error);
	}
});

type Result = 'success' | 'fail' | 'review' | 'duplicate';

// مرحله ۲: زرین‌پال کاربر رو به همینجا برمی‌گردونه (GET، نه fetch از فرانت)
paymentRouter.get('/callback', async (req, res) => {
	const { Authority: authority, Status: status } = req.query;
	const redirectTo = (id: string, result: Result) => res.redirect(`/reserve/payment?id=${encodeURIComponent(id)}&result=${result}`);

	// بدون این بررسی، Prisma فیلدِ undefined را از شرط حذف می‌کند و
	// «آخرین پرداخت کل سیستم» برگردانده می‌شود
	if (typeof authority !== 'string' || !authority.trim()) {
		return res.redirect('/reserve/payment?result=fail');
	}

	try {
		const payment = await prisma.payment.findFirst({ where: { authority }, orderBy: { createdAt: 'desc' } });
		if (!payment) return res.redirect('/reserve/payment?result=fail');
		const reservation = await prisma.reservation.findUnique({ where: { id: payment.reservationId } });
		if (!reservation) return res.redirect('/reserve/payment?result=fail');

		// idempotent: همین پرداخت قبلاً ثبت شده (مثلاً زرین‌پال دوبار callback داد یا مشتری صفحه را تازه کرد)
		if (payment.status === 'PAID') return redirectTo(reservation.id, 'success');
		if (payment.status === 'REFUND_PENDING' || payment.status === 'REFUNDED') return redirectTo(reservation.id, 'duplicate');

		if (status !== 'OK') {
			// فقط همین پرداخت، و فقط اگر هنوز در انتظار بود. پرداختِ «در حال بررسی» (احتمالاً پول کم شده) با
			// تکرار آدرس برگشت از درگاه ناموفق نمی‌شود، و رزرو دست نمی‌خورد.
			await prisma.payment.updateMany({ where: { id: payment.id, status: 'PENDING' }, data: { status: 'FAILED' } });
			return redirectTo(reservation.id, 'fail');
		}

		let verify: VerifyResult;
		try {
			verify = await verifyZarinpalPayment({ amount: payment.amount, authority });
		} catch (verifyError) {
			// ممکنه پول گرفته شده باشه ولی جواب به ما نرسیده؛ حتماً باید رد بمونه
			console.error('تایید پرداخت نزد زرین‌پال شکست خورد (وضعیت پرداخت نامعلوم):', verifyError);
			await markUnknown(payment.id, reservation.id);
			return redirectTo(reservation.id, 'review');
		}
		if (!verify.ok) {
			const changed = await prisma.payment.updateMany({
				where: { id: payment.id, status: { in: ['PENDING', 'FAILED'] } },
				data: { status: 'FAILED', rawResponse: verify.raw },
			});
			// پیامک فقط بار اول، و نه برای رزروی که با پرداخت دیگری تایید شده
			if (changed.count > 0 && reservation.status === 'HOLD') {
				await sendMockSms({ phone: reservation.customerPhone, type: 'NOT_CONFIRMED', message: notConfirmedMessage(reservation) }).catch((smsError) =>
					console.error('SMS عدم تایید ارسال نشد:', smsError),
				);
			}
			return redirectTo(reservation.id, 'fail');
		}

		let outcome: ConfirmOutcome;
		try {
			outcome = await confirmPaid(reservation.id, payment.id, verify.refId, verify.raw);
		} catch (confirmError) {
			// پول گرفته شده ولی ثبت نهایی شکست خورد. اگر callback هم‌زمان دیگری همین پرداخت را ثبت کرده، همه‌چیز درست است؛
			// وگرنه پرداخت برای بررسی دستی می‌ماند. رزروی که تایید شده هرگز به «بررسی» برنمی‌گردد.
			console.error('پرداخت نزد زرین‌پال تایید شد ولی ثبت رزرو شکست خورد:', confirmError);
			const now = await prisma.payment.findUnique({ where: { id: payment.id } }).catch(() => null);
			if (now?.status === 'PAID') return redirectTo(reservation.id, 'success');
			await prisma.payment
				.updateMany({
					where: { id: payment.id, status: { in: ['PENDING', 'FAILED'] } },
					data: { status: 'REVIEW', refId: verify.refId, rawResponse: verify.raw },
				})
				.catch((e) => console.error('ثبت وضعیت REVIEW هم شکست خورد:', e));
			await prisma.reservation
				.updateMany({ where: { id: reservation.id, status: { in: REVIEWABLE } }, data: { status: 'PAYMENT_REVIEW' } })
				.catch((e) => console.error('ثبت وضعیت PAYMENT_REVIEW هم شکست خورد:', e));
			return redirectTo(reservation.id, 'review');
		}

		if (outcome === 'confirmed') {
			try {
				await sendMockSms({ phone: reservation.customerPhone, type: 'CONFIRMATION', message: confirmationMessage(reservation) });
			} catch (smsError) {
				console.error('SMS تایید ارسال نشد (رزرو همچنان تایید شده باقی می‌ماند):', smsError);
			}
		}
		return redirectTo(reservation.id, outcome === 'confirmed' || outcome === 'already' ? 'success' : outcome);
	} catch (error) {
		console.error('Zarinpal callback error:', error);
		return res.redirect('/reserve/payment?result=fail');
	}
});

/**
 * Zarinpal did not answer the verify: the money may or may not have been taken. The payment waits for a manual
 * check. A reservation still on hold goes to PAYMENT_REVIEW; one that another payment already confirmed stays
 * confirmed and is marked as possibly owing a refund (it then shows up under «نیاز به اقدام»).
 */
async function markUnknown(paymentId: string, reservationId: string): Promise<void> {
	try {
		await prisma.payment.updateMany({ where: { id: paymentId, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'REVIEW' } });
		const reservation = await prisma.reservation.findUnique({ where: { id: reservationId } });
		if (!reservation) return;
		if (isSettled(reservation)) {
			await prisma.reservation.update({ where: { id: reservation.id }, data: { refundStatus: 'PENDING', notes: appendNote(reservation.notes, UNKNOWN_NOTE) } });
		} else {
			await prisma.reservation.updateMany({ where: { id: reservation.id, status: { in: REVIEWABLE } }, data: { status: 'PAYMENT_REVIEW' } });
		}
	} catch (error) {
		console.error('ثبت وضعیت پرداخت نامعلوم ناموفق بود:', error);
	}
}
