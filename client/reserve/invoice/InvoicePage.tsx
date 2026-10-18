import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { DetailRow } from '../common/DetailRow';
import { Topbar } from '../../shared/chrome/Topbar';
import { ReserveFooter } from '../common/ReserveFooter';
import { PAYMENT_STATUS_FA, REFUND_STATUS_FA, faDateTime, faHours, faNumber, statusFa, tablesText, toman } from '../common/format';
import type { Reservation } from '../common/types';

// باید با CANCEL_WINDOW_MINUTES سرور (src/lib/constants.ts) یکی باشد؛ سرور دوباره چک می‌کند
const CANCEL_WINDOW_MINUTES = 120;

function canCancel(reservation: Reservation): boolean {
	return reservation.status === 'CONFIRMED' && new Date(reservation.startAt).getTime() - Date.now() > CANCEL_WINDOW_MINUTES * 60 * 1000;
}

const icsDate = (value: string | Date) =>
	new Date(value)
		.toISOString()
		.replace(/[-:]/g, '')
		.replace(/\.\d{3}/, '');

const escapeIcs = (text: string) =>
	String(text || '')
		.replace(/\\/g, '\\\\')
		.replace(/;/g, '\\;')
		.replace(/,/g, '\\,')
		.replace(/\n/g, '\\n');

/** An .ics file with a reminder 3 hours before, for the phone's calendar. */
function downloadCalendarFile(reservation: Reservation) {
	const lines = [
		'BEGIN:VCALENDAR',
		'VERSION:2.0',
		'PRODID:-//Roof//Reservation//FA',
		'BEGIN:VEVENT',
		`UID:${reservation.trackingCode}@roof`,
		`DTSTAMP:${icsDate(new Date())}`,
		`DTSTART:${icsDate(reservation.startAt)}`,
		`DTEND:${icsDate(reservation.endAt)}`,
		`SUMMARY:${escapeIcs('رزرو میز در کافه Roof')}`,
		`DESCRIPTION:${escapeIcs(`کد پیگیری: ${reservation.trackingCode}\nمیز ${tablesText(reservation)}\n${reservation.guestCount} نفر`)}`,
		'BEGIN:VALARM',
		'TRIGGER:-PT3H',
		'ACTION:DISPLAY',
		`DESCRIPTION:${escapeIcs('۳ ساعت تا رزرو کافه Roof')}`,
		'END:VALARM',
		'END:VEVENT',
		'END:VCALENDAR',
	];
	const blob = new Blob([lines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const link = document.createElement('a');
	link.href = url;
	link.download = `roof-${reservation.trackingCode}.ics`;
	document.body.appendChild(link);
	link.click();
	document.body.removeChild(link);
	URL.revokeObjectURL(url);
}

type View = { kind: 'skeleton' } | { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'invoice'; reservation: Reservation };

export function InvoicePage() {
	const [view, setView] = useState<View>({ kind: 'skeleton' });
	const [cancelling, setCancelling] = useState(false);
	const [cancelError, setCancelError] = useState<string | null>(null);
	const id = new URLSearchParams(window.location.search).get('id');

	const load = useCallback(
		async (isCurrent: () => boolean = () => true) => {
			try {
				if (!id) throw new Error('شناسه فاکتور در آدرس پیدا نشد.');
				setView({ kind: 'loading' });
				const { reservation } = await api<{ reservation: Reservation }>(`/api/reservations/${encodeURIComponent(id)}`);
				if (isCurrent()) setView({ kind: 'invoice', reservation });
			} catch (error) {
				if (isCurrent()) setView({ kind: 'error', message: errorText(error) });
			}
		},
		[id],
	);

	useEffect(() => {
		let current = true;
		load(() => current);
		return () => {
			current = false;
		};
	}, [load]);

	const cancel = async (reservation: Reservation) => {
		const paid = (reservation.payments || []).some((p) => p.status === 'PAID');
		const question = paid
			? 'رزرو لغو شود؟ بعد از لغو، برای بازگشت وجه با مجموعه تماس بگیرید. این کار قابل برگشت نیست.'
			: 'رزرو لغو شود؟ این کار قابل برگشت نیست.';
		if (!window.confirm(question)) return;
		setCancelling(true);
		setCancelError(null);
		try {
			await api(`/api/reservations/${encodeURIComponent(reservation.id)}/cancel`, { method: 'POST', body: {} });
			await load();
		} catch (error) {
			setCancelError(errorText(error));
		} finally {
			setCancelling(false);
		}
	};

	return (
		<>
		<main className="shell">
			<Topbar sub="فاکتور رزرو">
				<a href="/reserve">رزرو جدید</a>
				<a href="/reserve/profile">پروفایل</a>
			</Topbar>

			<section className="card card-pad" style={{ maxWidth: '640px', marginTop: '26px' }} id="invoiceBox">
				{view.kind === 'skeleton' && (
					<>
						<div className="skeleton" style={{ height: '22px', width: '50%', marginBottom: '16px' }}></div>
						<div className="skeleton" style={{ height: '14px', width: '85%', marginBottom: '8px' }}></div>
						<div className="skeleton" style={{ height: '14px', width: '70%' }}></div>
					</>
				)}
				{view.kind === 'loading' && <div className="notice">در حال بارگذاری فاکتور…</div>}
				{view.kind === 'error' && (
					<>
						<div className="notice danger">{view.message}</div>
						<div className="actions">
							<a className="secondary-btn" href="/reserve">
								بازگشت به رزرو
							</a>
						</div>
					</>
				)}
				{view.kind === 'invoice' && (
					<Invoice reservation={view.reservation} cancelling={cancelling} cancelError={cancelError} onCancel={() => cancel(view.reservation)} />
				)}
			</section>
		</main>
		<ReserveFooter />
		</>
	);
}

function Invoice({ reservation, cancelling, cancelError, onCancel }: { reservation: Reservation; cancelling: boolean; cancelError: string | null; onCancel: () => void }) {
	const payment = reservation.payments?.[0];
	return (
		<>
			<div className="invoice-head">
				<div>
					<h3 style={{ marginBottom: '6px' }}>فاکتور رزرو Roof</h3>
					<span className="invoice-num">کد پیگیری {reservation.trackingCode}</span>
				</div>
				<div style={{ textAlign: 'left' }}>
					<div className="brand-word" style={{ fontSize: '22px' }}>
						{reservation.invoice?.number || '—'}
					</div>
					<span className={`status ${reservation.status}`} style={{ marginTop: '6px' }}>
						{statusFa(reservation.status)}
					</span>
				</div>
			</div>

			<DetailRow label="نام مشتری" value={reservation.customerName} />
			<DetailRow label="شماره موبایل" value={reservation.customerPhone} />
			<DetailRow label="تاریخ و ساعت" value={faDateTime(reservation.startAt)} />
			<DetailRow label="مدت رزرو" value={`${faHours(reservation.durationMinutes)} ساعت`} />
			<DetailRow label="میز" value={tablesText(reservation)} />
			<DetailRow label="تعداد نفرات" value={faNumber(reservation.guestCount || 0)} />
			{reservation.decorationAmount > 0 && (
				<DetailRow
					label="تزئین میز"
					value={`${toman(reservation.decorationAmount)}${reservation.decorationNote ? ` · ${reservation.decorationNote}` : ''}`}
				/>
			)}
			<DetailRow label="قیمت هر نفر" value={toman(reservation.pricePerGuest)} />
			<DetailRow label="وضعیت پرداخت" value={payment?.status ? PAYMENT_STATUS_FA[payment.status] || payment.status : '—'} />
			{payment?.refId ? <DetailRow label="کد پیگیری پرداخت" value={payment.refId} /> : null}
			{reservation.refundStatus && reservation.refundStatus !== 'NONE' ? (
				<DetailRow label="وضعیت بازگشت وجه" value={REFUND_STATUS_FA[reservation.refundStatus] || reservation.refundStatus} />
			) : null}

			<div className="amount-row">
				<span>مبلغ کل</span>
				<strong>{toman(reservation.totalAmount)}</strong>
			</div>

			<div className="actions">
				<button className="primary-btn" id="printBtn" onClick={() => window.print()}>
					{ICONS.receipt}
					<span>پرینت فاکتور</span>
				</button>
				<button className="secondary-btn" id="calendarBtn" onClick={() => downloadCalendarFile(reservation)}>
					{ICONS.calendar}
					<span>افزودن به تقویم</span>
				</button>
				<a className="secondary-btn" href="/reserve/profile">
					پروفایل من
				</a>
			</div>
			{canCancel(reservation) && (
				<>
					<div className="actions invoice-cancel">
						<button className="secondary-btn" id="cancelBtn" disabled={cancelling} onClick={onCancel}>
							{ICONS.x}
							<span>لغو رزرو</span>
						</button>
					</div>
					<div id="cancelNotice" aria-live="polite" className={cancelError ? 'notice danger' : undefined}>
						{cancelError}
					</div>
				</>
			)}
		</>
	);
}
