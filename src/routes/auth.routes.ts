import express, { type Request } from 'express';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import { prisma } from '../lib/prisma.js';
import { clearCookie, setCookie, signAdminToken, signGuestToken, signUserToken, verifyUserToken } from '../lib/auth.js';
import { latinDigits, normalizePhone } from '../lib/time.js';
import { otpMessage, sendMockSms } from '../lib/sms.js';
import { config } from '../config.js';
import { randomInt } from 'crypto';
import { optionalUser, requireUser } from '../middleware/auth.js';
import { normalizeUsername } from '../lib/roles.js';
import { currentUser } from '../lib/request.js';

// هش bcrypt معتبر (۶۰ کاراکتر) از یک رشته‌ی تصادفی؛ فقط برای یکسان نگه داشتن زمان پاسخ
const DUMMY_PASSWORD_HASH = '$2b$10$aSeBTOggmRzaYYKHqHDz2eQPrC5Eacr6fNxBub.SHZAKJ3gq1ahba';

export const authRouter = express.Router();

const OTP_PURPOSES = ['LOGIN', 'GUEST_ACCESS'];

function makeOtpCode() {
	return String(randomInt(100000, 1000000));
}

// برای ارسال، کلید فقط شماره است؛ وگرنه با تعویض IP می‌شود یک شماره را بمباران کرد
const otpSendKey = (req: Request): string => normalizePhone(req.body?.phone) || req.ip || '';
const otpKey = (req: Request): string => `${req.ip}:${normalizePhone(req.body?.phone)}`;
const otpSendLimiter = rateLimit({
	// در تست‌های خودکار همه‌ی درخواست‌ها از یک IP می‌آیند
	skip: () => config.isTest,
	windowMs: 10 * 60 * 1000,
	max: 5,
	keyGenerator: otpSendKey,
	message: {
		message: 'تعداد درخواست بیش از حد مجاز است؛ کمی بعد دوباره تلاش کن.',
	},
});
const otpVerifyLimiter = rateLimit({
	// در تست‌های خودکار همه‌ی درخواست‌ها از یک IP می‌آیند
	skip: () => config.isTest,
	windowMs: 10 * 60 * 1000,
	max: 10,
	keyGenerator: otpKey,
	message: {
		message: 'تعداد تلاش بیش از حد مجاز است؛ کمی بعد دوباره تلاش کن.',
	},
});
const adminLoginLimiter = rateLimit({
	// در تست‌های خودکار همه‌ی درخواست‌ها از یک IP می‌آیند
	skip: () => config.isTest,
	windowMs: 15 * 60 * 1000,
	max: 8,
	message: {
		message: 'تعداد تلاش بیش از حد مجاز است؛ کمی بعد دوباره تلاش کن.',
	},
});

authRouter.post('/otp/send', otpSendLimiter, async (req, res, next) => {
	try {
		const phone = normalizePhone(req.body?.phone);
		const purpose = req.body?.purpose || 'LOGIN';
		if (!phone) return res.status(400).json({ message: 'شماره موبایل نامعتبر است.' });
		// قبلاً مقدار نامعتبر مستقیم به دیتابیس می‌رفت و خطای خام Prisma با کد ۵۰۰ برمی‌گشت
		if (!OTP_PURPOSES.includes(purpose)) return res.status(400).json({ message: 'نوع درخواست نامعتبر است.' });
		const code = makeOtpCode();
		const codeHash = await bcrypt.hash(code, 10);
		const expiresAt = new Date(Date.now() + 2 * 60 * 1000);
		const createdOtp = await prisma.otpCode.create({
			data: { phone, purpose, codeHash, expiresAt },
		});
		// پاک‌سازی کدهای منقضی/مصرف‌شده‌ی همین شماره تا جدول بی‌نهایت بزرگ نشود
		prisma.otpCode
			.deleteMany({
				where: {
					phone,
					OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }],
				},
			})
			.catch((error) => console.error('پاک‌سازی کدهای قدیمی ناموفق بود:', error));
		try {
			await sendMockSms({ phone, type: 'OTP', message: otpMessage(code) });
		} catch (smsError) {
			// کد ساخته شده ولی ارسال نشده؛ پاکش می‌کنیم تا تلاش بعدی کاربر تمیز باشد
			console.error('ارسال کد تایید ناموفق بود:', smsError);
			// فقط همین کدی که الان ساخته شد پاک می‌شه، نه کدهای معتبر قبلی
			await prisma.otpCode.delete({ where: { id: createdOtp.id } }).catch(() => {});
			return res.status(503).json({ message: 'ارسال پیامک در حال حاضر ممکن نیست؛ کمی بعد دوباره تلاش کن.' });
		}
		res.json({
			message: 'کد تایید ارسال شد.',
		});
	} catch (error) {
		next(error);
	}
});

authRouter.post('/otp/verify', otpVerifyLimiter, async (req, res, next) => {
	try {
		const phone = normalizePhone(req.body?.phone);
		const { code, name, purpose = 'LOGIN', trackingCode } = req.body || {};
		if (!phone) return res.status(400).json({ message: 'شماره موبایل نامعتبر است.' });
		if (!OTP_PURPOSES.includes(purpose)) return res.status(400).json({ message: 'نوع درخواست نامعتبر است.' });

		const otp = await prisma.otpCode.findFirst({
			where: {
				phone,
				purpose,
				consumedAt: null,
				expiresAt: { gt: new Date() },
			},
			orderBy: { createdAt: 'desc' },
		});
		if (!otp || otp.attempts >= 5) return res.status(400).json({ message: 'کد تایید اشتباه یا منقضی است.' });

		const match = await bcrypt.compare(latinDigits(String(code || '')).trim(), otp.codeHash);
		if (!match) {
			await prisma.otpCode.update({
				where: { id: otp.id },
				data: { attempts: { increment: 1 } },
			});
			return res.status(400).json({ message: 'کد تایید اشتباه یا منقضی است.' });
		}
		await prisma.otpCode.update({
			where: { id: otp.id },
			data: { consumedAt: new Date() },
		});

		if (purpose === 'GUEST_ACCESS') {
			const cleanTrackingCode = latinDigits(String(trackingCode || ''))
				.trim()
				.toUpperCase();
			const reservation = await prisma.reservation.findFirst({
				where: { trackingCode: cleanTrackingCode, customerPhone: phone },
			});
			if (!reservation)
				return res.status(404).json({
					message: 'رزرو با این شماره و کد پیگیری پیدا نشد.',
				});
			const token = signGuestToken({
				phone,
				reservationId: reservation.id,
				trackingCode: cleanTrackingCode,
			});
			setCookie(res, 'guestToken', token);
			return res.json({
				message: 'دسترسی مهمان تایید شد.',
				reservationId: reservation.id,
			});
		}

		const safeName = name ? String(name).trim().slice(0, 80) : null;
		let resolvedName = safeName;
		if (!resolvedName) {
			const previous = await prisma.reservation.findFirst({
				where: { customerPhone: phone, customerName: { not: '' } },
				orderBy: { createdAt: 'desc' },
				select: { customerName: true },
			});
			resolvedName = previous?.customerName?.trim() || null;
		}

		const existing = await prisma.user.findUnique({ where: { phone } });
		if (!existing && !resolvedName) {
			return res.status(400).json({ message: 'برای ساخت حساب، وارد کردن نام لازم است.' });
		}

		const user = await prisma.user.upsert({
			where: { phone },
			update: { name: resolvedName || undefined },
			create: { phone, name: resolvedName },
		});

		await prisma.reservation
			.updateMany({ where: { customerPhone: phone, userId: null }, data: { userId: user.id } })
			.catch((error) => console.error('اتصال رزروهای قبلی به حساب ناموفق بود:', error));

		setCookie(res, 'userToken', signUserToken(user));
		res.json({ message: 'ورود انجام شد.', user });
	} catch (error) {
		next(error);
	}
});

authRouter.get('/me', optionalUser, (req, res) => {
	res.json({ user: req.user || null });
});

authRouter.patch('/me', requireUser, async (req, res, next) => {
	try {
		const safeName = req.body?.name ? String(req.body.name).trim().slice(0, 80) : '';
		// نام برای پیگیری رزرو ضروریه؛ نباید بشه خالیش کرد
		if (!safeName) return res.status(400).json({ message: 'نام نمی‌تواند خالی باشد.' });
		const user = await prisma.user.update({
			where: { id: currentUser(req).id },
			data: { name: safeName },
		});
		res.json({ user });
	} catch (error) {
		next(error);
	}
});

authRouter.post('/logout', optionalUser, async (req, res) => {
	// بالا بردن tokenVersion باعث می‌شود توکن‌های صادرشده‌ی قبلی دیگر پذیرفته نشوند
	if (req.user) {
		await prisma.user
			.update({ where: { id: req.user.id }, data: { tokenVersion: { increment: 1 } } })
			.catch((error) => console.error('باطل‌کردن توکن هنگام خروج ناموفق بود:', error));
	}
	clearCookie(res, 'userToken');
	clearCookie(res, 'guestToken');
	res.json({ message: 'خروج انجام شد.' });
});

authRouter.post('/admin/login', adminLoginLimiter, async (req, res, next) => {
	try {
		// باید با normalizeUsername موقع ساخت ادمین هماهنگ باشه، وگرنه ورود شکست می‌خوره
		const username = normalizeUsername(req.body?.username);
		const password = typeof req.body?.password === 'string' ? req.body.password : '';
		if (!username || !password) return res.status(400).json({ message: 'نام کاربری و رمز عبور لازم است.' });
		if (username.length > 64 || password.length > 128) return res.status(400).json({ message: 'اطلاعات ورود اشتباه است.' });

		const admin = await prisma.adminUser.findUnique({ where: { username } });
		// حتی وقتی ادمین وجود ندارد یک مقایسه‌ی ساختگی انجام می‌شود تا زمان پاسخ
		// در هر دو حالت یکسان بماند و نام‌های کاربری معتبر از روی زمان لو نروند.
		// هش باید یک هش معتبر ۶۰ کاراکتری bcrypt باشد، وگرنه compare فوراً false برمی‌گرداند.
		const hashToCompare = admin?.passwordHash || DUMMY_PASSWORD_HASH;
		const ok = await bcrypt.compare(password, hashToCompare);
		if (!admin || !admin.isActive || !ok) return res.status(401).json({ message: 'اطلاعات ورود اشتباه است.' });
		setCookie(res, 'adminToken', signAdminToken(admin));
		res.json({
			message: 'ورود ادمین انجام شد.',
			admin: { id: admin.id, username: admin.username, name: admin.name, role: admin.role },
		});
	} catch (error) {
		next(error);
	}
});

authRouter.post('/admin/logout', (_req, res) => {
	clearCookie(res, 'adminToken');
	res.json({ message: 'خروج ادمین انجام شد.' });
});
