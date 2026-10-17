import { prisma } from './prisma.js';
import type { SmsLog, SmsType } from '@prisma/client';
import { config } from '../config.js';

type WithTrackingCode = { trackingCode: string };

export async function sendMockSms({ phone, type, message }: { phone: string; type: SmsType; message: string }): Promise<SmsLog | null> {
	const status = config.smsMode === 'console' ? 'MOCK_SENT' : 'PENDING_PROVIDER';
	// کد تایید نباید تو دیتابیس بمونه؛ فقط شکل پیام لاگ می‌شه
	const storedMessage = type === 'OTP' ? 'کد تایید Roof: ******' : message;
	let log: SmsLog | null = null;
	try {
		log = await prisma.smsLog.create({ data: { phone, type, message: storedMessage, status } });
	} catch (error) {
		console.error('ثبت لاگ پیامک ناموفق بود (ارسال پیامک ادامه پیدا می‌کند):', error);
	}
	if (config.smsMode === 'console') {
		console.log(`\n[MOCK SMS][${type}] ${phone}: ${message}\n`);
	} else {
		// TODO: وقتی پروایدر واقعی (مثلاً ir.sms) انتخاب شد، اینجا فراخوانی واقعی اضافه می‌شه.
		// log می‌تونه null باشه (اگه نوشتن لاگ بالاتر شکست خورده باشه)
		if (log) {
			await prisma.smsLog
				.update({ where: { id: log.id }, data: { status: 'FAILED' } })
				.catch((error) => console.error('به‌روزرسانی وضعیت لاگ پیامک ناموفق بود:', error));
		}
		throw new Error(`هیچ سرویس پیامکی برای SMS_MODE="${config.smsMode}" پیاده‌سازی نشده است.`);
	}
	return log;
}

export function otpMessage(code: string): string {
	return `کد تایید Roof: ${code}`;
}

export function confirmationMessage(reservation: WithTrackingCode): string {
	return `رزرو شما در Roof تایید شد. کد پیگیری: ${reservation.trackingCode}`;
}

export function notConfirmedMessage(reservation: WithTrackingCode): string {
	return `رزرو ${reservation.trackingCode} تایید نشد، لطفاً با مجموعه تماس بگیرید.`;
}

export function reminderMessage(reservation: WithTrackingCode, minutesBefore: number | null = null): string {
	// متن از روی تنظیم واقعی ساخته می‌شه، نه عدد ثابت
	const when = typeof minutesBefore === 'number' && Number.isFinite(minutesBefore)
		? minutesBefore >= 60
			? `${Math.round(minutesBefore / 60).toLocaleString('fa-IR')} ساعت`
			: `${Math.round(minutesBefore).toLocaleString('fa-IR')} دقیقه`
		: 'کمی';
	return `یادآوری Roof: رزرو شما تا ${when} دیگر شروع می‌شود. کد: ${reservation.trackingCode}`;
}
