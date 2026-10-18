import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { api, errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { HoldRing } from '../common/HoldRing';
import { Topbar } from '../../shared/chrome/Topbar';
import { ReserveFooter } from '../common/ReserveFooter';
import { endTimeFa, faDateTime, faNumber, tablesText, toman } from '../common/format';
import type { Reservation } from '../common/types';

type View =
	| { kind: 'skeleton' }
	| { kind: 'loading' }
	| { kind: 'invalid'; message: string }
	| { kind: 'expired'; title: string; message: string }
	| { kind: 'review' }
	| { kind: 'success'; reservation: Reservation }
	| { kind: 'fail'; message?: string }
	| { kind: 'summary'; reservation: Reservation };

const EXPIRED_TITLE = 'زمان نگه‌داری تمام شد';
const EXPIRED_TEXT = 'میز دیگر برات نگه داشته نمی‌شه؛ از صفحه‌ی رزرو دوباره انتخاب کن.';

function Row({ icon, label, value }: { icon: ReactElement; label: string; value: string }) {
	return (
		<div className="detail-row">
			<span className="ico">{icon}</span>
			<span>
				{`${label}: `}
				<strong>{value}</strong>
			</span>
		</div>
	);
}

export function PaymentPage() {
	const [view, setView] = useState<View>({ kind: 'skeleton' });
	const [paying, setPaying] = useState(false);
	const search = new URLSearchParams(window.location.search);
	const id = search.get('id');
	// result فقط یک‌بار مصرف می‌شود؛ وگرنه «تلاش دوباره» بعد از پرداخت ناموفق دوباره همان صفحه‌ی fail را نشان می‌داد
	const resultParam = useRef(search.get('result'));

	/** Loads the reservation and shows the matching state. `isCurrent` drops answers of an abandoned load. */
	const load = useCallback(async (isCurrent: () => boolean = () => true) => {
		if (!id) {
			setView({ kind: 'invalid', message: 'شناسه رزرو در آدرس صفحه پیدا نشد.' });
			return;
		}
		setView({ kind: 'loading' });
		try {
			const { reservation } = await api<{ reservation: Reservation }>(`/api/reservations/${encodeURIComponent(id)}`);
			if (!isCurrent()) return;
			const result = resultParam.current;
			resultParam.current = null;
			if (result) window.history.replaceState(null, '', `${window.location.pathname}?id=${encodeURIComponent(id)}`);

			// برگشت از درگاه زرین‌پال - بک‌اند خودش در callback همه‌چیز را verify و ثبت کرده
			if (result === 'success' || reservation.status === 'CONFIRMED') return setView({ kind: 'success', reservation });
			if (result === 'fail') return setView({ kind: 'fail' });
			if (reservation.status === 'PAYMENT_REVIEW') return setView({ kind: 'review' });
			if (reservation.status === 'CANCELLED') {
				return setView({ kind: 'expired', title: 'این رزرو لغو شده', message: 'این رزرو لغو شده؛ از صفحه‌ی رزرو می‌تونی دوباره یه میز انتخاب کنی.' });
			}
			if (reservation.status === 'EXPIRED') return setView({ kind: 'expired', title: EXPIRED_TITLE, message: EXPIRED_TEXT });
			if (reservation.status === 'COMPLETED' || reservation.status === 'NO_SHOW') {
				return setView({ kind: 'expired', title: 'این رزرو بسته شده', message: 'این رزرو دیگه قابل پرداخت نیست؛ برای رزرو جدید به صفحه‌ی اصلی برو.' });
			}
			setPaying(false);
			setView({ kind: 'summary', reservation });
		} catch (error) {
			if (isCurrent()) setView({ kind: 'invalid', message: errorText(error) });
		}
	}, [id]);

	useEffect(() => {
		let current = true;
		load(() => current);
		return () => {
			current = false;
		};
	}, [load]);

	// پرداخت موفق: بعد از یک لحظه به فاکتور؛ replace تا این صفحه در تاریخچه نماند
	useEffect(() => {
		if (view.kind !== 'success') return;
		const target = `/reserve/invoice?id=${encodeURIComponent(view.reservation.id)}`;
		const timer = window.setTimeout(() => window.location.replace(target), 1400);
		return () => window.clearTimeout(timer);
	}, [view]);

	const pay = async (reservation: Reservation) => {
		setPaying(true);
		try {
			const { paymentUrl } = await api<{ paymentUrl: string }>(`/api/payments/${reservation.id}/request`, { method: 'POST' });
			if (!paymentUrl) throw new Error('درگاه پرداخت در دسترس نیست.');
			window.location.href = paymentUrl;
		} catch (error) {
			setView({ kind: 'fail', message: errorText(error) });
		}
	};

	return (
		<>
		<main className="shell">
			<Topbar sub="پرداخت رزرو">
				<a href="/reserve">رزرو جدید</a>
				<a href="/reserve/profile">پروفایل</a>
			</Topbar>

			<section className="page-head">
				<h2>تایید نهایی و پرداخت</h2>
			</section>

			<section className="card card-pad" id="paymentBox">
				{view.kind === 'skeleton' && (
					<>
						<div className="skeleton" style={{ height: '16px', width: '40%', marginBottom: '14px' }}></div>
						<div className="skeleton" style={{ height: '12px', width: '78%', marginBottom: '7px' }}></div>
						<div className="skeleton" style={{ height: '12px', width: '60%' }}></div>
					</>
				)}
				{view.kind === 'loading' && <div className="notice">در حال بارگذاری…</div>}
				{view.kind === 'invalid' && (
					<>
						<h3>پرداخت</h3>
						<div className="notice danger">{view.message}</div>
						<div className="actions">
							<a className="primary-btn" href="/reserve">
								رزرو جدید
							</a>
						</div>
					</>
				)}
				{view.kind === 'expired' && (
					<div className="result-state">
						<div className="result-icon warn">{ICONS.clock}</div>
						<h3>{view.title}</h3>
						<p>{view.message}</p>
						<a className="primary-btn" href="/reserve" style={{ maxWidth: '200px' }}>
							انتخاب دوباره
						</a>
					</div>
				)}
				{view.kind === 'review' && (
					<div className="result-state">
						<div className="result-icon warn">{ICONS.clock}</div>
						<h3>پرداخت در حال بررسیه</h3>
						<p>پرداختت ثبت شده و داره بررسی می‌شه؛ نتیجه‌ش به‌زودی مشخص می‌شه. لازم نیست دوباره پرداخت کنی.</p>
						<button className="secondary-btn" id="refreshStatus" style={{ maxWidth: '200px' }} onClick={() => load()}>
							بررسی وضعیت
						</button>
					</div>
				)}
				{view.kind === 'success' && (
					<div className="result-state">
						<div className="result-icon ok">{ICONS.check}</div>
						<h3>پرداخت موفق بود</h3>
						<p>رزروت تایید شد.</p>
						<div className="tracking-code">{view.reservation.trackingCode}</div>
					</div>
				)}
				{view.kind === 'fail' && (
					<div className="result-state">
						<div className="result-icon fail">{ICONS.x}</div>
						<h3>پرداخت ناموفق بود</h3>
						<p>{view.message || 'میز تا پایان زمان نگه‌داری همچنان براته؛ می‌تونی دوباره تلاش کنی.'}</p>
						<button className="primary-btn" id="retryPay" style={{ maxWidth: '180px' }} onClick={() => load()}>
							تلاش دوباره
						</button>
					</div>
				)}
				{view.kind === 'summary' && (
					<Summary
						reservation={view.reservation}
						paying={paying}
						onPay={() => pay(view.reservation)}
						onExpire={() => setView({ kind: 'expired', title: EXPIRED_TITLE, message: EXPIRED_TEXT })}
					/>
				)}
			</section>
		</main>
		<ReserveFooter />
		</>
	);
}

function Summary({ reservation, paying, onPay, onExpire }: { reservation: Reservation; paying: boolean; onPay: () => void; onExpire: () => void }) {
	const holdActive =
		['HOLD', 'PAYMENT_PENDING'].includes(reservation.status) && reservation.holdExpiresAt !== null && new Date(reservation.holdExpiresAt) > new Date();
	// کل مهلت از ساخت رزرو تا انقضا؛ وگرنه حلقه بعد از هر رفرش دوباره از صد درصد شروع می‌کرد
	const holdTotalSeconds =
		holdActive && reservation.createdAt && reservation.holdExpiresAt
			? Math.max(1, Math.round((new Date(reservation.holdExpiresAt).getTime() - new Date(reservation.createdAt).getTime()) / 1000))
			: undefined;

	return (
		<>
			<h3>خلاصه رزرو</h3>
			<div style={{ marginBottom: '16px' }}>
				<Row icon={ICONS.receipt} label="کد پیگیری" value={reservation.trackingCode} />
				<Row icon={ICONS.table} label="میز" value={tablesText(reservation)} />
				<Row icon={ICONS.clock} label="زمان" value={`${faDateTime(reservation.startAt)} تا ${endTimeFa(reservation.startAt, reservation.endAt)}`} />
				<Row icon={ICONS.users} label="تعداد نفرات" value={faNumber(reservation.guestCount || 0)} />
				{reservation.decorationAmount > 0 && (
					<Row
						icon={ICONS.check}
						label="تزئین میز"
						value={`${toman(reservation.decorationAmount)}${reservation.decorationNote ? ` · ${reservation.decorationNote}` : ''}`}
					/>
				)}
				<div className="amount-row">
					<span>مبلغ قابل پرداخت</span>
					<strong>{toman(reservation.totalAmount)}</strong>
				</div>
			</div>

			{holdActive && reservation.holdExpiresAt && (
				<div className="hold-ring-wrap" style={{ marginBottom: '16px' }}>
					<div id="ringMount">
						<HoldRing expiresAt={reservation.holdExpiresAt} totalSeconds={holdTotalSeconds} onExpire={onExpire} />
					</div>
					<div className="hold-ring-text">
						<strong>زمان نگه‌داری میز</strong>
						<span>جای رزروت تا پایان این تایمر محفوظه.</span>
					</div>
				</div>
			)}

			<div className="actions">
				<button className="primary-btn" id="payBtn" disabled={paying} onClick={onPay}>
					{ICONS.check}
					<span>پرداخت</span>
				</button>
			</div>
		</>
	);
}
