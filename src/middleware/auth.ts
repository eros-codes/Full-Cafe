import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { AdminRole } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { verifyAdminToken, verifyUserToken } from '../lib/auth.js';

export async function optionalUser(req: Request, _res: Response, next: NextFunction): Promise<unknown> {
	const token: string | undefined = req.cookies?.userToken;
	if (!token) return next();

	let payload: { sub: string; ver?: number };
	try {
		payload = verifyUserToken(token);
	} catch (_) {
		return next(); // توکن نامعتبر یا منقضی: کاربر مهمان در نظر گرفته می‌شه
	}

	try {
		const user = await prisma.user.findUnique({ where: { id: payload.sub } });
		if (user && user.isActive !== false && (payload.ver ?? 0) === (user.tokenVersion ?? 0)) {
			req.user = user;
		}
	} catch (error) {
		// خطای دیتابیس نباید بی‌صدا به «مهمان» ترجمه بشه
		console.error('optionalUser: خواندن کاربر از دیتابیس ناموفق بود', error);
	}
	next();
}

export async function requireUser(req: Request, res: Response, next: NextFunction): Promise<unknown> {
	const token: string | undefined = req.cookies?.userToken;
	if (!token) return res.status(401).json({ message: 'لطفاً وارد حساب شوید.' });

	let payload: { sub: string; ver?: number };
	try {
		payload = verifyUserToken(token);
	} catch (_) {
		return res.status(401).json({ message: 'نشست کاربری نامعتبر است.' });
	}

	try {
		const user = await prisma.user.findUnique({ where: { id: payload.sub } });
		if (!user) return res.status(401).json({ message: 'کاربر پیدا نشد.' });
		if (user.isActive === false) return res.status(403).json({ message: 'حساب کاربری غیرفعال شده است.' });
		if ((payload.ver ?? 0) !== (user.tokenVersion ?? 0)) return res.status(401).json({ message: 'نشست منقضی شده؛ دوباره وارد شو.' });
		req.user = user;
		next();
	} catch (error) {
		// خطای دیتابیس نباید به «نشست نامعتبر» ترجمه بشه، وگرنه کاربر بی‌دلیل بیرون می‌افته
		console.error('requireUser: خواندن کاربر از دیتابیس ناموفق بود', error);
		res.status(503).json({ message: 'سرویس موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.' });
	}
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction): Promise<unknown> {
	const token: string | undefined = req.cookies?.adminToken;
	if (!token) return res.status(401).json({ message: 'ورود ادمین لازم است.' });

	let payload: { sub: string; ver?: number };
	try {
		payload = verifyAdminToken(token);
	} catch (_) {
		return res.status(401).json({ message: 'نشست ادمین نامعتبر است.' });
	}

	try {
		const admin = await prisma.adminUser.findUnique({ where: { id: payload.sub } });
		if (!admin || !admin.isActive) return res.status(401).json({ message: 'ادمین فعال نیست.' });
		if ((payload.ver ?? 0) !== (admin.tokenVersion ?? 0)) {
			return res.status(401).json({ message: 'رمز عبور تغییر کرده؛ دوباره وارد شو.' });
		}
		req.admin = admin;
		next();
	} catch (error) {
		console.error('requireAdmin: خواندن ادمین از دیتابیس ناموفق بود', error);
		res.status(503).json({ message: 'سرویس موقتاً در دسترس نیست؛ کمی بعد دوباره تلاش کن.' });
	}
}

/** Allows the request only for the given roles, e.g. requireRole('DEVELOPER', 'MAIN'). */
export function requireRole(...roles: readonly AdminRole[]): RequestHandler {
	return (req, res, next) => {
		if (!req.admin) return res.status(401).json({ message: 'ورود ادمین لازم است.' });
		if (!roles.includes(req.admin.role)) return res.status(403).json({ message: 'سطح دسترسی کافی نیست.' });
		next();
	};
}
