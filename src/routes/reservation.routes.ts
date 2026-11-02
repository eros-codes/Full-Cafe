import { config } from '../config.js';
import express, { type Request } from 'express';
import { currentUser } from '../lib/request.js';
import { prisma } from '../lib/prisma.js';
import { optionalUser, requireUser } from '../middleware/auth.js';
import { cancelReservation, createReservationHold, getReservationFull, toCustomerReservation } from '../services/reservation.service.js';
import { verifyGuestToken } from '../lib/auth.js';
import rateLimit from 'express-rate-limit';

// هر HOLD میزها را تا چند دقیقه قفل می‌کند، پس باید محدود باشد
const holdLimiter = rateLimit({
	// در تست‌های خودکار همه‌ی درخواست‌ها از یک IP می‌آیند
	skip: () => config.isTest,
	windowMs: 10 * 60 * 1000,
	max: 10,
	message: { message: 'تعداد درخواست رزرو بیش از حد مجاز است؛ کمی بعد دوباره تلاش کن.' },
});
export const reservationRouter = express.Router();

/**
 * A hold needs a verified phone number: the customer signs in with an SMS code first (the booking page does it in
 * the same dialog), and the reservation is made with the number of that account, whatever number the request
 * names. Before, anyone could hold tables with any number, without proving it was theirs.
 */
reservationRouter.post('/hold', holdLimiter, requireUser, async (req, res, next) => {
	try {
		const payload = req.body;
		const user = currentUser(req);
		const reservation = await createReservationHold({
			tableIds: payload.tableIds,
			date: payload.date,
			startTime: payload.startTime,
			durationMinutes: Number(payload.durationMinutes),
			guestCount: Number(payload.guestCount),
			customerName: payload.customerName,
			customerPhone: user.phone,
			userId: user.id,
			source: 'ONLINE',
			decoration: payload.decoration === true,
			decorationNote: payload.decorationNote,
		});
		// the payment and invoice pages see it as the account's own reservation (no guest cookie needed)
		res.status(201).json({ reservation: toCustomerReservation(reservation) });
	} catch (error) {
		next(error);
	}
});

/** The reservation's owner (signed-in user) or the guest who holds its access cookie. */
export function hasReservationAccess(req: Request, reservation: { id: string; userId: string | null }): boolean {
	if (req.user && reservation.userId === req.user.id) return true;
	if (!req.cookies?.guestToken) return false;
	try {
		return verifyGuestToken(req.cookies.guestToken).reservationId === reservation.id;
	} catch {
		return false;
	}
}

reservationRouter.get('/:id', optionalUser, async (req, res, next) => {
	try {
		const reservation = await getReservationFull(req.params.id);
		if (!reservation) return res.status(404).json({ message: 'رزرو پیدا نشد.' });
		if (!hasReservationAccess(req, reservation))
			return res.status(403).json({
				message: 'برای دیدن این رزرو باید وارد حساب شوی یا با کد پیگیری تایید کنی.',
			});
		res.json({ reservation: toCustomerReservation(reservation) });
	} catch (error) {
		next(error);
	}
});

reservationRouter.post('/:id/cancel', optionalUser, async (req, res, next) => {
	try {
		const reservation = await getReservationFull(req.params.id);
		if (!reservation) return res.status(404).json({ message: 'رزرو پیدا نشد.' });
		if (!hasReservationAccess(req, reservation)) {
			return res.status(403).json({ message: 'برای لغو رزرو باید مالک رزرو باشید.' });
		}
		const updated = await cancelReservation(
			reservation.id,
			typeof req.body?.note === 'string' && req.body.note.trim() ? req.body.note : 'لغو توسط مشتری',
		);

		res.json({ reservation: updated && toCustomerReservation(updated) });
	} catch (error) {
		next(error);
	}
});

reservationRouter.get('/profile/list', requireUser, async (req, res, next) => {
	try {
		// رزروهای مهمانِ همین شماره که هنوز به حساب وصل نشدن، همین‌جا وصل می‌شن —
		// تا اگه کاربر بعد از ورود هم رزرو مهمان ثبت کرد، از قلم نیفته
		const user = currentUser(req);
		await prisma.reservation
			.updateMany({ where: { customerPhone: user.phone, userId: null }, data: { userId: user.id } })
			.catch((error) => console.error('اتصال رزروهای قبلی ناموفق بود:', error));

		const reservations = await prisma.reservation.findMany({
			where: { userId: user.id },
			orderBy: { startAt: 'desc' },
			include: {
				tables: { include: { table: true } },
				invoice: true,
				payments: true,
			},
		});
		res.json({ reservations: reservations.map(toCustomerReservation) });
	} catch (error) {
		next(error);
	}
});
