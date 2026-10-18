import { useEffect, useState } from 'react';
import { ApiError, api, errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { DetailRow } from '../common/DetailRow';
import { OtpWidget } from '../common/OtpWidget';
import { Topbar } from '../../shared/chrome/Topbar';
import { ReserveFooter } from '../common/ReserveFooter';
import { faDateTime, statusFa, tablesText, toman } from '../common/format';
import type { CurrentUser, Reservation } from '../common/types';

type Result = { kind: 'empty' } | { kind: 'error'; message: string } | { kind: 'reservation'; reservation: Reservation };
type Flow = { kind: 'checking' } | { kind: 'guest'; notice?: string; key: number } | { kind: 'user' };

export function TrackPage() {
	const [flow, setFlow] = useState<Flow>({ kind: 'checking' });
	const [result, setResult] = useState<Result>({ kind: 'empty' });

	useEffect(() => {
		api<{ user: CurrentUser | null }>('/api/me')
			.then(({ user }) => setFlow(user ? { kind: 'user' } : { kind: 'guest', key: 0 }))
			.catch(() => setFlow({ kind: 'guest', key: 0 }));
	}, []);

	const showReservation = async (idOrCode: string) => {
		const { reservation } = await api<{ reservation: Reservation }>(`/api/reservations/${encodeURIComponent(idOrCode)}`);
		setResult({ kind: 'reservation', reservation });
	};

	return (
		<>
		<main className="shell">
			<Topbar sub="پیگیری رزرو مهمان">
				<a href="/reserve">رزرو جدید</a>
				<a href="/reserve/profile">حساب من</a>
			</Topbar>

			<section className="page-head">
				<h2>رزروت رو پیدا کن</h2>
			</section>

			<section className="grid">
				<aside className="card card-pad">
					<h3>دسترسی مهمان</h3>
					<div id="otpBox">
						{flow.kind === 'guest' && (
							<OtpWidget
								key={flow.key}
								purpose="GUEST_ACCESS"
								extraFields={[{ key: 'trackingCode', label: 'کد پیگیری', placeholder: 'RSV-123456' }]}
								submitLabel="نمایش رزرو"
								initialNotice={flow.notice ? { message: flow.notice, type: 'warn' } : null}
								onVerified={async (data) => {
									try {
										if (!data?.reservationId) throw new Error('رزروی برای این کد پیگیری پیدا نشد.');
										await showReservation(data.reservationId);
									} catch (error) {
										setResult({ kind: 'error', message: errorText(error) });
									}
								}}
							/>
						)}
						{flow.kind === 'user' && (
							<QuickLookup
								onShow={showReservation}
								// این رزرو مال حساب فعلی نیست؛ برگشت به مسیر تایید پیامکی
								onNotOwner={() => setFlow({ kind: 'guest', key: Date.now(), notice: 'این رزرو به حساب شما وصل نیست؛ با تایید پیامکی ادامه بده.' })}
							/>
						)}
					</div>
				</aside>
				<section className="card card-pad">
					<h3>جزئیات رزرو</h3>
					<div id="result" className={result.kind === 'empty' ? 'empty-state' : result.kind === 'error' ? 'notice danger' : ''}>
						{result.kind === 'empty' && (
							<>
								{ICONS.search}
								<strong>هنوز رزروی نمایش داده نشده</strong>
								<p>فرم کناری رو پر کن تا جزئیات رزرو رو ببینی.</p>
							</>
						)}
						{result.kind === 'error' && result.message}
						{result.kind === 'reservation' && <ReservationSummary reservation={result.reservation} />}
					</div>
				</section>
			</section>
		</main>
		<ReserveFooter />
		</>
	);
}

/** A signed-in customer looks up their own reservation by code, without an SMS. */
function QuickLookup({ onShow, onNotOwner }: { onShow: (code: string) => Promise<void>; onNotOwner: () => void }) {
	const [code, setCode] = useState('');
	const [busy, setBusy] = useState(false);
	const [notice, setNotice] = useState<string | null>(null);

	const show = async () => {
		const value = code.trim().toUpperCase();
		if (!value) {
			setNotice('کد پیگیری رو وارد کن.');
			return;
		}
		setBusy(true);
		try {
			await onShow(value);
			setNotice(null);
		} catch (error) {
			if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
				onNotOwner();
				return;
			}
			setNotice(errorText(error));
		} finally {
			setBusy(false);
		}
	};

	return (
		<div className="form-grid">
			<div className="field">
				<label>کد پیگیری</label>
				<input id="quickCode" placeholder="RSV-123456" value={code} onChange={(event) => setCode(event.target.value)} />
			</div>
			<button type="button" className="primary-btn" id="quickShow" disabled={busy} onClick={show}>
				نمایش رزرو
			</button>
			<div id="quickNotice" className={notice ? 'notice danger' : undefined}>
				{notice}
			</div>
		</div>
	);
}

function ReservationSummary({ reservation }: { reservation: Reservation }) {
	return (
		<>
			<DetailRow label="کد پیگیری" value={reservation.trackingCode} />
			<DetailRow label="نام" value={reservation.customerName} />
			<DetailRow label="زمان" value={faDateTime(reservation.startAt)} />
			<DetailRow label="میز" value={tablesText(reservation)} />
			<DetailRow label="مبلغ" value={toman(reservation.totalAmount)} />
			<div className="detail-row">
				<span>وضعیت</span>
				<span className={`status ${reservation.status}`}>{statusFa(reservation.status)}</span>
			</div>
			<div className="actions">
				<a className="secondary-btn" href={`/reserve/invoice?id=${encodeURIComponent(reservation.id)}`}>
					{ICONS.receipt}
					<span>فاکتور</span>
				</a>
			</div>
		</>
	);
}
