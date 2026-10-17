import express from 'express';
import type { Prisma, Reservation, ReservationStatus } from '@prisma/client';
import { errorMessage } from '../lib/http-error.js';
import { prisma } from '../lib/prisma.js';
import { requestZarinpalPayment, verifyZarinpalPayment, type VerifyResult } from '../lib/payment.js';
import { confirmationMessage, notConfirmedMessage, sendMockSms } from '../lib/sms.js';
import { getReservationFull, type ReservationFull } from '../services/reservation.service.js';
import { findConflictingReservations } from '../services/availability.service.js';
import { config } from '../config.js';
import rateLimit from 'express-rate-limit';
import { optionalUser } from '../middleware/auth.js';
import { hasReservationAccess } from './reservation.routes.js';

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
	// PAYMENT_REVIEW یعنی پول قبلاً گرفته شده و منتظر بررسی دستیه؛
	// اجازه‌ی پرداخت دوباره یعنی دو بار پول گرفتن از مشتری
	const closed: ReservationStatus[] = ['CONFIRMED', 'CANCELLED', 'COMPLETED', 'NO_SHOW', 'PAYMENT_REVIEW', 'EXPIRED'];
	if (closed.includes(reservation.status)) return false;
	if (reservation.holdExpiresAt && reservation.holdExpiresAt < new Date()) return false;
	return true;
}

const CONFIRMABLE_STATUSES: ReservationStatus[] = ['HOLD', 'PAYMENT_PENDING', 'PAYMENT_REVIEW', 'EXPIRED'];
const HOLDING_STATUSES: ReservationStatus[] = ['HOLD', 'PAYMENT_PENDING'];

type ConfirmOutcome = 'confirmed' | 'already' | 'review';

/**
 * پرداخت نزد زرین‌پال تایید شده؛ رزرو را تایید می‌کند.
 * اگر نگه‌داری میز در همین فاصله تمام شده (مشتری بیش از زمان نگه‌داری در صفحه‌ی درگاه بوده) و میز
 * به کس دیگری رسیده، یا رزرو لغو شده، رزرو تایید نمی‌شود و برای بررسی دستی/بازگشت وجه
 * به PAYMENT_REVIEW می‌رود. قبلاً در این حالت هم تایید می‌شد و یک میز دو بار رزرو می‌شد.
 * خروجی: 'confirmed' | 'already' | 'review'
 */
async function confirmPaid(
	reservation: ReservationFull,
	refId: string | null,
	rawResponse: Prisma.InputJsonValue,
): Promise<ConfirmOutcome> {
	const outcome = await prisma.$transaction(
		async (tx): Promise<ConfirmOutcome> => {
			const fresh = await tx.reservation.findUnique({ where: { id: reservation.id } });
			if (!fresh || fresh.status === 'CONFIRMED') return 'already';
			const lapsed =
				fresh.status === 'EXPIRED' ||
				(HOLDING_STATUSES.includes(fresh.status) && fresh.holdExpiresAt !== null && fresh.holdExpiresAt < new Date());
			const blocked =
				!CONFIRMABLE_STATUSES.includes(fresh.status) || (lapsed && (await findConflictingReservations(fresh.id, tx)).length > 0);
			if (blocked) {
				await tx.payment.updateMany({
					where: { reservationId: fresh.id, status: { in: ['PENDING', 'FAILED', 'REVIEW'] } },
					data: { status: 'REVIEW', refId, rawResponse },
				});
				await tx.reservation.update({
					where: { id: fresh.id },
					data: {
						status: 'PAYMENT_REVIEW',
						notes: 'پرداخت بعد از پایان زمان نگه‌داری یا لغو رزرو انجام شد و میز در دسترس نبود؛ نیاز به بررسی و بازگشت وجه.',
					},
				});
				return 'review';
			}
			await tx.payment.updateMany({
				where: { reservationId: fresh.id, status: { in: ['PENDING', 'FAILED', 'REVIEW'] } },
				data: { status: 'PAID', refId, verifiedAt: new Date(), rawResponse },
			});
			await tx.reservation.update({
				where: { id: fresh.id },
				data: { status: 'CONFIRMED', paidAmount: fresh.totalAmount, holdExpiresAt: null },
			});
			return 'confirmed';
		},
		{ isolationLevel: 'Serializable' },
	);
	// اگر درخواست هم‌زمان دیگری زودتر رزرو را تایید کرده باشد، پیامک تکراری فرستاده نمی‌شود
	if (outcome === 'confirmed') {
		try {
			await sendMockSms({ phone: reservation.customerPhone, type: 'CONFIRMATION', message: confirmationMessage(reservation) });
		} catch (smsError) {
			console.error('SMS تایید ارسال نشد (رزرو همچنان تایید شده باقی می‌ماند):', smsError);
		}
	}
	return outcome;
}

// مرحله ۱: شروع پرداخت - کاربر رو به درگاه زرین‌پال می‌فرسته
paymentRouter.post('/:reservationId/request', paymentRequestLimiter, optionalUser, async (req, res, next) => {
	try {
		const reservation = await getReservationFull(req.params.reservationId);
		if (!reservation) return res.status(404).json({ message: 'رزرو پیدا نشد.' });
		// قبلاً هر کسی با داشتن شناسه‌ی رزرو می‌توانست برایش درخواست پرداخت بسازد
		if (!hasReservationAccess(req, reservation)) return res.status(403).json({ message: 'دسترسی به این رزرو ندارید.' });
		if (!isPayable(reservation)) {
			const wasActivelyHolding = HOLDING_STATUSES.includes(reservation.status);
			if (wasActivelyHolding && reservation.holdExpiresAt && reservation.holdExpiresAt < new Date()) {
				await prisma.reservation.update({ where: { id: reservation.id }, data: { status: 'EXPIRED' } });
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

		await prisma.payment.updateMany({
			where: { reservationId: reservation.id, status: { in: ['PENDING', 'FAILED', 'REVIEW'] } },
			data: { authority, status: 'PENDING' },
		});

		res.json({ paymentUrl });
	} catch (error) {
		next(error);
	}
});

// مرحله ۲: زرین‌پال کاربر رو به همینجا برمی‌گردونه (GET، نه fetch از فرانت)
paymentRouter.get('/callback', async (req, res) => {
	const { Authority: authority, Status: status } = req.query;
	const redirectTo = (id: string, result: 'success' | 'fail' | 'review') => res.redirect(`/reserve/payment?id=${encodeURIComponent(id)}&result=${result}`);

	// بدون این بررسی، Prisma فیلدِ undefined را از شرط حذف می‌کند و
	// «آخرین پرداخت کل سیستم» برگردانده می‌شود
	if (typeof authority !== 'string' || !authority.trim()) {
		return res.redirect('/reserve/payment?result=fail');
	}

	try {
		const payment = await prisma.payment.findFirst({ where: { authority }, orderBy: { createdAt: 'desc' } });
		if (!payment) return res.redirect('/reserve/payment?result=fail');

		const reservation = await getReservationFull(payment.reservationId);
		if (!reservation) return res.redirect('/reserve/payment?result=fail');

		// idempotent: اگه قبلاً confirmed شده (مثلاً زرین‌پال دوبار callback داد)، دوباره verify نمی‌کنیم
		if (reservation.status === 'CONFIRMED') return redirectTo(reservation.id, 'success');

		if (status !== 'OK') {
			await prisma.payment.updateMany({
				where: { reservationId: reservation.id, status: { in: ['PENDING', 'REVIEW'] } },
				data: { status: 'FAILED' },
			});
			return redirectTo(reservation.id, 'fail');
		}

		let verify: VerifyResult;
		try {
			verify = await verifyZarinpalPayment({ amount: reservation.totalAmount, authority });
		} catch (verifyError) {
			// ممکنه پول گرفته شده باشه ولی جواب به ما نرسیده؛ حتماً باید رد بمونه
			console.error('تایید پرداخت نزد زرین‌پال شکست خورد (وضعیت پرداخت نامعلوم):', verifyError);
			await prisma.payment
				.updateMany({ where: { reservationId: reservation.id, status: { in: ['PENDING', 'FAILED'] } }, data: { status: 'REVIEW' } })
				.catch((e) => console.error('ثبت وضعیت REVIEW ناموفق بود:', e));
			await prisma.reservation
				.update({ where: { id: reservation.id }, data: { status: 'PAYMENT_REVIEW' } })
				.catch((e) => console.error('ثبت وضعیت PAYMENT_REVIEW ناموفق بود:', e));
			return redirectTo(reservation.id, 'review');
		}
		if (!verify.ok) {
			await prisma.payment.updateMany({
				where: { reservationId: reservation.id, status: { in: ['PENDING', 'REVIEW'] } },
				data: { status: 'FAILED', rawResponse: verify.raw },
			});
			await sendMockSms({ phone: reservation.customerPhone, type: 'NOT_CONFIRMED', message: notConfirmedMessage(reservation) }).catch(
				(smsError) => console.error('SMS عدم تایید ارسال نشد:', smsError),
			);
			return redirectTo(reservation.id, 'fail');
		}

		try {
			const outcome = await confirmPaid(reservation, verify.refId, verify.raw);
			if (outcome === 'review') return redirectTo(reservation.id, 'review');
		} catch (confirmError) {
			// پول گرفته شده ولی ثبت نهایی شکست خورد؛ حتماً باید رد بماند تا دستی بررسی شود
			console.error('پرداخت نزد زرین‌پال تایید شد ولی ثبت رزرو شکست خورد:', confirmError);
			await prisma.payment
				.updateMany({
					where: { reservationId: reservation.id, status: { in: ['PENDING', 'FAILED'] } },
					data: { status: 'REVIEW', refId: verify.refId, rawResponse: verify.raw },
				})
				.catch((e) => console.error('ثبت وضعیت REVIEW هم شکست خورد:', e));
			await prisma.reservation
				.update({
					where: { id: reservation.id },
					data: { status: 'PAYMENT_REVIEW' },
				})
				.catch((e) => console.error('ثبت وضعیت PAYMENT_REVIEW هم شکست خورد:', e));
			return redirectTo(reservation.id, 'review');
		}
		return redirectTo(reservation.id, 'success');
	} catch (error) {
		console.error('Zarinpal callback error:', error);
		return res.redirect('/reserve/payment?result=fail');
	}
});
