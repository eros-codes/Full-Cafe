import { useEffect, useRef, useState } from 'react';
import { api, errorText } from '../../shared/api';
import { faNumber } from '../../shared/format';
import { safeStorage } from '../../shared/storage';

const SEND_LABEL = 'ارسال کد تایید';
const COOLDOWN_SECONDS = 60;

export interface OtpExtraField {
	key: string;
	label: string;
	placeholder?: string;
	required?: boolean;
}

export interface OtpVerifyResult {
	reservationId?: string;
	user?: unknown;
	[key: string]: unknown;
}

interface Props {
	purpose: 'LOGIN' | 'GUEST_ACCESS';
	extraFields?: OtpExtraField[];
	submitLabel?: string;
	onVerified: (data: OtpVerifyResult) => void | Promise<void>;
	initialNotice?: { message: string; type: string } | null;
}

type Notice = { message: string; type: string } | null;

/** Phone number → SMS code → verify. "Resend" waits 60 s, and the wait survives a page refresh. */
export function OtpWidget({ purpose, extraFields = [], submitLabel = 'تایید', onVerified, initialNotice = null }: Props) {
	const [extras, setExtras] = useState<Record<string, string>>({});
	const [phone, setPhone] = useState('');
	const [code, setCode] = useState('');
	const [sent, setSent] = useState(false);
	const [notice, setNotice] = useState<Notice>(initialNotice);
	const [sending, setSending] = useState(false);
	const [verifying, setVerifying] = useState(false);
	const [cooldownEnds, setCooldownEnds] = useState<number | null>(null);
	const [now, setNow] = useState(Date.now());
	const codeRef = useRef<HTMLInputElement>(null);

	const storageKey = (forPhone: string) => `otpCooldown:${purpose}:${forPhone.trim()}`;

	// a wait started before a refresh continues for the same number; a new number starts free
	useEffect(() => {
		const stored = Number(safeStorage.get(storageKey(phone)));
		setCooldownEnds(stored > Date.now() ? stored : null);
	}, [phone, purpose]);

	useEffect(() => {
		if (!cooldownEnds) return;
		const timer = window.setInterval(() => {
			setNow(Date.now());
			if (Date.now() >= cooldownEnds) {
				safeStorage.remove(storageKey(phone));
				setCooldownEnds(null);
			}
		}, 1000);
		setNow(Date.now());
		return () => window.clearInterval(timer);
	}, [cooldownEnds]);

	useEffect(() => {
		if (sent) codeRef.current?.focus();
	}, [sent]);

	const remaining = cooldownEnds ? Math.ceil((cooldownEnds - now) / 1000) : 0;
	const coolingDown = remaining > 0;

	const send = async () => {
		if (!phone.trim()) {
			setNotice({ message: 'شماره موبایل رو وارد کن.', type: 'danger' });
			return;
		}
		const missing = extraFields.find((f) => f.required && !(extras[f.key] || '').trim());
		if (missing) {
			setNotice({ message: `${missing.label} رو وارد کن.`, type: 'danger' });
			return;
		}
		setSending(true);
		try {
			await api('/api/otp/send', { method: 'POST', body: { phone: phone.trim(), purpose } });
			setNotice({ message: 'کد ارسال شد', type: 'ok' });
			setSent(true);
			const ends = Date.now() + COOLDOWN_SECONDS * 1000;
			safeStorage.set(storageKey(phone), String(ends));
			setCooldownEnds(ends);
		} catch (error) {
			setNotice({ message: errorText(error), type: 'danger' });
		} finally {
			setSending(false);
		}
	};

	const verify = async () => {
		if (!code.trim()) {
			setNotice({ message: 'کد تایید رو وارد کن.', type: 'danger' });
			return;
		}
		setVerifying(true);
		try {
			const payload = Object.fromEntries(extraFields.map((f) => [f.key, (extras[f.key] || '').trim()]));
			// فیلدهای اضافی اول قرار می‌گیرند تا نتوانند phone/code/purpose را بازنویسی کنند
			const data = await api<OtpVerifyResult>('/api/otp/verify', { method: 'POST', body: { ...payload, phone: phone.trim(), code: code.trim(), purpose } });
			setNotice({ message: 'تایید شد.', type: 'ok' });
			await onVerified(data);
		} catch (error) {
			setNotice({ message: errorText(error), type: 'danger' });
		} finally {
			setVerifying(false);
		}
	};

	return (
		<div className="form-grid otp-widget">
			{extraFields.map((field) => (
				<div className="field" key={field.key}>
					<label>
						{field.label}
						{field.required ? ' *' : ''}
					</label>
					<input
						data-otp-extra={field.key}
						placeholder={field.placeholder || ''}
						value={extras[field.key] || ''}
						onChange={(event) => setExtras((values) => ({ ...values, [field.key]: event.target.value }))}
					/>
				</div>
			))}
			<div className="field">
				<label>شماره موبایل</label>
				<input
					data-otp-phone
					placeholder="09..."
					inputMode="tel"
					value={phone}
					onChange={(event) => setPhone(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && !coolingDown && !sending) send();
					}}
				/>
			</div>
			<button type="button" className="secondary-btn" data-otp-send disabled={sending || coolingDown} onClick={send}>
				{coolingDown ? `ارسال مجدد (${faNumber(remaining)})` : SEND_LABEL}
			</button>
			<div className="field" data-otp-code-field hidden={!sent}>
				<label>کد تایید</label>
				<input
					data-otp-code
					inputMode="numeric"
					maxLength={6}
					ref={codeRef}
					value={code}
					onChange={(event) => setCode(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === 'Enter' && !verifying) verify();
					}}
				/>
			</div>
			<button type="button" className="primary-btn" data-otp-verify hidden={!sent} disabled={verifying} onClick={verify}>
				{submitLabel}
			</button>
			<div data-otp-notice className={notice ? `notice ${notice.type}`.trim() : undefined}>
				{notice?.message}
			</div>
		</div>
	);
}
