import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { latinDigits } from '../../shared/format';
import { adminApi } from '../common/adminApi';
import { ErrorNotice, Notice, Skeleton, type NoticeState } from '../common/ui';

const FIELDS: [string, string][] = [
	['pricePerGuest', 'قیمت هر نفر (تومان)'],
	['decorationPrice', 'هزینه تزئین (تومان · صفر = غیرفعال)'],
	['reservationWindowDays', 'بازه باز بودن رزرو (روز)'],
	['minLeadMinutes', 'حداقل فاصله از الان (دقیقه)'],
	['minDurationMinutes', 'حداقل مدت رزرو (دقیقه)'],
	['maxDurationMinutes', 'حداکثر مدت رزرو (دقیقه)'],
	['slotIntervalMinutes', 'فاصله اسلات‌ها (دقیقه)'],
	['cleaningBufferMinutes', 'زمان آماده‌سازی بین رزروها (دقیقه)'],
	['holdMinutes', 'مدت نگه‌داری hold (دقیقه)'],
	['reminderBeforeMinutes', 'یادآوری پیامکی قبل از رزرو (دقیقه)'],
];

const DEFAULT_NOTICE: NoticeState = { type: '', text: 'قیمت پیش‌فرض: ۱۰۰٬۰۰۰ تومان به ازای هر نفر.' };

/** Price per guest and the booking rules (window, durations, slot size, hold time, reminder). */
export function Settings() {
	const [values, setValues] = useState<Record<string, string> | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<NoticeState>(DEFAULT_NOTICE);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let current = true;
		adminApi<{ settings: Record<string, unknown> }>('/api/admin/settings')
			.then(({ settings }) => {
				if (current) setValues(Object.fromEntries(FIELDS.map(([key]) => [key, String(settings[key] ?? '')])));
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, []);

	if (error) return <ErrorNotice message={error} />;
	if (!values) return <Skeleton height={140} />;

	const save = async () => {
		const body: Record<string, string> = {};
		FIELDS.forEach(([key]) => {
			const value = latinDigits(values[key] ?? '').trim();
			if (value !== '') body[key] = value;
		});
		setBusy(true);
		try {
			await adminApi('/api/admin/settings', { method: 'PATCH', body });
			setNotice({ type: 'ok', text: 'تنظیمات ذخیره شد.' });
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="form-grid">
			<div className="row">
				{FIELDS.map(([key, label]) => (
					<div className="field" key={key}>
						<label htmlFor={`set-${key}`}>{label}</label>
						<input id={`set-${key}`} value={values[key]} onChange={(e) => setValues({ ...values, [key]: e.target.value })} />
					</div>
				))}
			</div>
			<button id="saveSettings" className="primary-btn" disabled={busy} onClick={save}>
				ذخیره تنظیمات
			</button>
			<Notice id="settingsNotice" notice={notice} />
		</div>
	);
}
