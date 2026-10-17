import { config } from '../config.js';
import express, { type Request } from 'express';
import { currentUser } from '../lib/request.js';
import { prisma } from '../lib/prisma.js';
import { normalizePhone } from '../lib/time.js';
import { optionalUser, requireUser } from '../middleware/auth.js';
import { cancelReservation, createReservationHold, getReservationFull } from '../services/reservation.service.js';
import { setCookie, signGuestToken, verifyGuestToken } from '../lib/auth.js';
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

reservationRouter.post('/hold', holdLimiter, optionalUser, async (req, res, next) => {
	try {
		const payload = req.body;
		const reservation = await createReservationHold({
			tableIds: payload.tableIds,
			date: payload.date,
			startTime: payload.startTime,
			durationMinutes: Number(payload.durationMinutes),
			guestCount: Number(payload.guestCount),
			customerName: payload.customerName,
			customerPhone: normalizePhone(payload.customerPhone),
			userId: req.user?.id || null,
			source: req.user ? 'ONLINE' : 'GUEST',
			decoration: payload.decoration === true,
			decorationNote: payload.decorationNote,
		});
		// کوکی دسترسی همان لحظه صادر می‌شود تا صفحه‌ی پرداخت/فاکتور
		// بدون نیاز به تایید پیامکی بتواند همین رزرو را ببیند
		setCookie(
			res,
			'guestToken',
			signGuestToken({
				phone: reservation.customerPhone,
				reservationId: reservation.id,
				trackingCode: reservation.trackingCode,
			}),
		);
		res.status(201).json({ reservation });
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
		res.json({ reservation });
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

		res.json({ reservation: updated });
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
		res.json({ reservations });
	} catch (error) {
		next(error);
	}
});
