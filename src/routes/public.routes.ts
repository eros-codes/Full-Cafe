import express from 'express';
import { queryString } from '../lib/request.js';
import { CLOCK_TIME, CLOSING_TIME, isValidDateString } from '../lib/time.js';
import { getAvailability, getPublicConfig, getTablesWithConnections } from '../services/availability.service.js';
import { optionalUser } from '../middleware/auth.js';
import { prisma } from '../lib/prisma.js';

export const publicRouter = express.Router();

// The café's hours for the About page: the same hours the bookings follow (set in the panel's «ساعت کاری»).
// Before, the page had «هر روز هفته، ۹ صبح تا ۲۴» written into it, whatever the panel said.
publicRouter.get('/working-hours', async (_req, res, next) => {
	try {
		const days = await prisma.workingHour.findMany({
			select: { dayOfWeek: true, opensAt: true, closesAt: true, isClosed: true },
			orderBy: { dayOfWeek: 'asc' },
		});
		res.json({ days });
	} catch (error) {
		next(error);
	}
});

publicRouter.get('/config', async (_req, res, next) => {
	try {
		res.json(await getPublicConfig());
	} catch (error) {
		next(error);
	}
});

publicRouter.get('/tables', async (_req, res, next) => {
	try {
		const { tables } = await getTablesWithConnections();
		res.json({ tables });
	} catch (error) {
		next(error);
	}
});

publicRouter.get('/availability', optionalUser, async (req, res, next) => {
	try {
		const guestCount = Number(req.query.guests);
		const durationMinutes = Number(req.query.durationMinutes);
		const date = queryString(req.query.date);
		const startTime = queryString(req.query.startTime);
		const rangeStart = queryString(req.query.rangeStart);
		const rangeEnd = queryString(req.query.rangeEnd);
		if (!isValidDateString(date)) {
			return res.status(400).json({ message: 'تاریخ نامعتبر است.' });
		}
		if (!Number.isInteger(guestCount) || guestCount < 1 || guestCount > 50) {
			return res.status(400).json({ message: 'تعداد نفرات نامعتبر است.' });
		}
		if (!Number.isInteger(durationMinutes) || durationMinutes < 1) {
			return res.status(400).json({ message: 'مدت رزرو نامعتبر است.' });
		}
		const badTime =
			(req.query.startTime && !CLOCK_TIME.test(String(req.query.startTime))) ||
			(req.query.rangeStart && !CLOCK_TIME.test(String(req.query.rangeStart))) ||
			// پایان بازه می‌تواند 24:00 باشد (کافه تا نیمه‌شب باز است)
			(req.query.rangeEnd && !CLOSING_TIME.test(String(req.query.rangeEnd)));
		if (badTime) {
			return res.status(400).json({ message: 'فرمت ساعت نامعتبر است.' });
		}
		if (rangeStart && rangeEnd && rangeStart >= rangeEnd) {
			return res.status(400).json({ message: 'ساعت پایان بازه باید بعد از ساعت شروع باشد.' });
		}
		const data = await getAvailability(
			{
				date,
				guestCount,
				durationMinutes,
				startTime: startTime || undefined,
				rangeStart: rangeStart || undefined,
				rangeEnd: rangeEnd || undefined,
			},
			{ ownerUserId: req.user?.id },
		);
		res.json(data);
	} catch (error) {
		next(error);
	}
});
