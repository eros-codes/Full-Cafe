import { prisma } from './prisma.js';

// Rows that are only useful for a while and would otherwise pile up forever. Run once a day (src/server.ts).

/** SMS codes a day after they ran out (before, they were only cleared when the same number asked again). */
const OTP_KEEP_MS = 24 * 60 * 60 * 1000;
/** The SMS log: a year is plenty to answer «did the customer get the confirmation?». */
const SMS_LOG_KEEP_DAYS = 365;

export async function cleanupOldRecords(now = new Date()): Promise<void> {
	try {
		const [otp, sms] = await Promise.all([
			prisma.otpCode.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - OTP_KEEP_MS) } } }),
			prisma.smsLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - SMS_LOG_KEEP_DAYS * 24 * 60 * 60 * 1000) } } }),
		]);
		if (otp.count || sms.count) console.log(`پاک‌سازی: ${otp.count} کد پیامکی منقضی، ${sms.count} لاگ پیامک قدیمی.`);
	} catch (error) {
		console.error('پاک‌سازی رکوردهای قدیمی ناموفق بود:', error instanceof Error ? error.message : error);
	}
}
