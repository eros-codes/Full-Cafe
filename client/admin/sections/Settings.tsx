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

/** Price per guest, the booking rules (window, durations, slot size, hold time, reminder) and the «انتخاب برای من» switch. */
export function Settings() {
	const [values, setValues] = useState<Record<string, string> | null>(null);
	const [recommender, setRecommender] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<NoticeState>(DEFAULT_NOTICE);
	const [busy, setBusy] = useState(false);

	useEffect(() => {
		let current = true;
		adminApi<{ settings: Record<string, unknown> }>('/api/admin/settings')
			.then(({ settings }) => {
				if (!current) return;
				setValues(Object.fromEntries(FIELDS.map(([key]) => [key, String(settings[key] ?? '')])));
				setRecommender(String(settings.recommenderEnabled) === '1');
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
			<RecommenderSwitch on={recommender} onChange={setRecommender} />
		</div>
	);
}

/** «انتخاب برای من» on the menu page: saved as soon as it is switched. */
function RecommenderSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<NoticeState>(null);

	const toggle = async (next: boolean) => {
		setBusy(true);
		setNotice(null);
		// the box changes at once; if saving fails it goes back
		onChange(next);
		try {
			await adminApi('/api/admin/settings', { method: 'PATCH', body: { recommenderEnabled: next } });
		} catch (err) {
			onChange(!next);
			setNotice({ type: 'danger', text: errorText(err) });
			setBusy(false);
			return;
		}
		// the box itself shows that it worked; only something the admin cannot see is said
		try {
			if (next) {
				const { enabled } = await adminApi<{ enabled: boolean }>('/api/recommender/status');
				if (!enabled) {
					setNotice({
						type: 'warn',
						text: 'روشن است، ولی دکمه هنوز در منو دیده نمی‌شود: حداقل یک گروه سلیقه‌ی فعال با گزینه (بخش «انتخاب برای من») و یک محصول موجود در دسته‌ای که نوع دارد لازم است.',
					});
				}
			}
		} catch {
			// saved; only the check of the menu page failed
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="settings-block">
			<h4>«انتخاب برای من»</h4>
			<label className="checkbox-row settings-switch">
				<input id="set-recommender" type="checkbox" checked={on} disabled={busy} onChange={(e) => toggle(e.target.checked)} />
				<span>نمایش دکمه‌ی «نمی‌دونی چی انتخاب کنی؟» در صفحه‌ی منو</span>
			</label>
			<p className="hint">چند سوال کوتاه از مشتری می‌پرسد و ۱ تا ۳ محصول پیشنهاد می‌دهد. قبل از روشن کردن، محصولات را برچسب بزن.</p>
			<Notice notice={notice} />
		</div>
	);
}
