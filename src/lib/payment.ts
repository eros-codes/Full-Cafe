import type { Prisma } from '@prisma/client';
import { config } from '../config.js';

const HOST = config.paymentMode === 'live' ? 'payment.zarinpal.com' : 'sandbox.zarinpal.com';
const REQUEST_URL = `https://${HOST}/pg/v4/payment/request.json`;
const VERIFY_URL = `https://${HOST}/pg/v4/payment/verify.json`;
const STARTPAY_URL = `https://${HOST}/pg/StartPay`;

interface ZarinpalError {
	code?: number;
	message?: string;
}

interface ZarinpalResponse {
	data?: { code?: number; authority?: string; ref_id?: number | string } | unknown[];
	errors?: ZarinpalError | ZarinpalError[] | unknown[];
}

function responseData(response: ZarinpalResponse): { code?: number; authority?: string; ref_id?: number | string } {
	// زرین‌پال در حالت خطا data را آرایه‌ی خالی برمی‌گرداند
	return response.data && !Array.isArray(response.data) ? response.data : {};
}

async function fetchZarinpal(url: string, body: Record<string, unknown>): Promise<ZarinpalResponse> {
	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), 10000);
	let response: Response;
	let text: string;
	// مرحله‌ی شبکه: فقط خطاهای اتصال/timeout اینجا مدیریت می‌شن
	try {
		response = await fetch(url, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Accept: 'application/json',
			},
			body: JSON.stringify(body),
			signal: controller.signal,
		});
		text = await response.text();
	} catch (error) {
		if (error instanceof Error && error.name === 'AbortError') throw new Error('درگاه پرداخت زرین‌پال به‌موقع پاسخ نداد.');
		throw new Error('اتصال به درگاه پرداخت زرین‌پال برقرار نشد.');
	} finally {
		clearTimeout(timeout);
	}
	// مرحله‌ی پارس: جدا نگه داشته می‌شه تا پیامش توسط catch بالا بلعیده نشه
	try {
		return JSON.parse(text) as ZarinpalResponse;
	} catch {
		throw new Error(`پاسخ نامعتبر از درگاه پرداخت (کد ${response.status}).`);
	}
}

export async function requestZarinpalPayment({
	amount,
	description,
	callbackUrl,
	mobile,
}: {
	amount: number;
	description: string;
	callbackUrl: string;
	mobile?: string;
}): Promise<{ authority: string; paymentUrl: string; raw: Prisma.InputJsonValue }> {
	if (!config.zarinpalMerchantId) throw new Error('ZARINPAL_MERCHANT_ID تنظیم نشده است.');
	const response = await fetchZarinpal(REQUEST_URL, {
		merchant_id: config.zarinpalMerchantId,
		amount,
		currency: 'IRT',
		description,
		callback_url: callbackUrl,
		metadata: mobile ? { mobile } : undefined,
	});
	const data = responseData(response);
	if (data.code !== 100 || !data.authority) {
		// errors گاهی آبجکت و گاهی آرایه‌ست؛ هر دو حالت پوشش داده می‌شه
		const first = (Array.isArray(response.errors) ? response.errors[0] : response.errors) as ZarinpalError | undefined;
		const gatewayMessage = first?.message;
		const gatewayCode = first?.code;
		throw new Error(
			gatewayMessage ? `${gatewayMessage}${gatewayCode ? ` (کد ${gatewayCode})` : ''}` : 'اتصال به درگاه پرداخت زرین‌پال ناموفق بود.',
		);
	}
	return {
		authority: data.authority,
		paymentUrl: `${STARTPAY_URL}/${data.authority}`,
		raw: response as Prisma.InputJsonValue,
	};
}

export interface VerifyResult {
	ok: boolean;
	alreadyVerified: boolean;
	refId: string | null;
	code: number | undefined;
	raw: Prisma.InputJsonValue;
}

/**
 * بعد از برگشت از درگاه، پرداخت رو نزد زرین‌پال verify می‌کنه.
 * code=100 یعنی همین الان تایید شد؛ code=101 یعنی قبلاً تایید شده بود
 * (idempotency - اگه callback دوبار بیاد، بار دوم فقط همینو می‌گیریم،
 * دوباره confirmed نمی‌کنیم رزرو رو).
 */
export async function verifyZarinpalPayment({ amount, authority }: { amount: number; authority: string }): Promise<VerifyResult> {
	if (!config.zarinpalMerchantId) throw new Error('ZARINPAL_MERCHANT_ID تنظیم نشده است.');
	const response = await fetchZarinpal(VERIFY_URL, {
		merchant_id: config.zarinpalMerchantId,
		amount,
		currency: 'IRT',
		authority,
	});
	const data = responseData(response);
	const code = data.code;
	if ((code === 100 || code === 101) && !data.ref_id) {
		console.error('زرین‌پال تایید موفق داد ولی ref_id نفرستاد:', JSON.stringify(response));
	}
	return {
		ok: code === 100 || code === 101,
		alreadyVerified: code === 101,
		refId: data.ref_id ? String(data.ref_id) : null,
		code,
		raw: response as Prisma.InputJsonValue,
	};
}
