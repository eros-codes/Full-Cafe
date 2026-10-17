import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../shared/api';
import { toman } from '../../shared/format';
import { ICONS, type IconName } from '../../shared/icons';
import { faDateTime, statusFa } from '../../reserve/common/format';
import type { Reservation } from '../../reserve/common/types';
import { adminApi } from '../common/adminApi';
import { EmptyState, ErrorNotice, Skeleton, fa } from '../common/ui';

// باید با STATUS_TRANSITIONS در admin.routes.ts یکی باشد: فقط تغییرهای مجاز نمایش داده می‌شوند
const STATUS_ACTIONS: { to: string; label: string; from: string[]; managerOnly?: boolean; afterStart?: boolean }[] = [
	{ to: 'CONFIRMED', label: 'تایید پرداخت و رزرو', from: ['PAYMENT_REVIEW'], managerOnly: true },
	{ to: 'COMPLETED', label: 'تکمیل‌شده', from: ['CONFIRMED'], afterStart: true },
	{ to: 'NO_SHOW', label: 'عدم حضور مشتری', from: ['CONFIRMED'], afterStart: true },
	{ to: 'CANCELLED', label: 'لغو رزرو', from: ['HOLD', 'PAYMENT_PENDING', 'PAYMENT_REVIEW', 'CONFIRMED'] },
];

// ترتیب: کلید سرور، برچسب، آیکون (آیکون اول میاد تا در RTL سمت راست بشینه)
const TABS: [string, string, IconName][] = [
	['action', 'نیاز به بررسی', 'stop'],
	['all', 'همه', 'list'],
	['today', 'امروز', 'calendar'],
	['confirmed', 'تایید‌شده', 'clock'],
	['completed', 'تکمیل‌شده', 'check'],
	['noshow', 'عدم حضور', 'ban'],
	['cancelled', 'لغو‌شده', 'x'],
];

type ListState = { state: 'loading' } | { state: 'error'; message: string } | { state: 'loaded'; list: Reservation[]; total: number };

interface Props {
	isMain: boolean;
	reloadKey: number;
	/** A status changed: the dashboard numbers change too. */
	onChanged: () => void;
}

export function Reservations({ isMain, reloadKey, onChanged }: Props) {
	const [filter, setFilter] = useState('action');
	const [counts, setCounts] = useState<Record<string, number> | null>(null);
	const [list, setList] = useState<ListState>({ state: 'loading' });
	const [notice, setNotice] = useState<string | null>(null);
	const [busyId, setBusyId] = useState<string | null>(null);
	// how many rows were open, so a refresh does not jump back to the first page
	const shown = useRef(0);

	const load = useCallback(async (activeFilter: string, isCurrent: () => boolean = () => true) => {
		setList({ state: 'loading' });
		setNotice(null);
		try {
			const result = await adminApi<{ counts: Record<string, number> }>('/api/admin/reservations/counts');
			if (isCurrent()) setCounts(result.counts);
		} catch {
			// بدون شمارنده‌ها، تب‌ها بدون عدد نشون داده می‌شن
			if (isCurrent()) setCounts((c) => c ?? {});
		}
		try {
			// سقف سمت سرور ۲۰۰ است
			const limit = Math.min(Math.max(shown.current, 100), 200);
			const { reservations, total } = await adminApi<{ reservations: Reservation[]; total: number }>(
				`/api/admin/reservations?filter=${activeFilter}&limit=${limit}&offset=0`,
			);
			if (!isCurrent()) return;
			shown.current = reservations.length;
			setList({ state: 'loaded', list: reservations, total: total ?? reservations.length });
		} catch (error) {
			if (isCurrent()) setList({ state: 'error', message: errorText(error) });
		}
	}, []);

	useEffect(() => {
		let current = true;
		load(filter, () => current);
		return () => {
			current = false;
		};
	}, [filter, reloadKey, load]);

	const loadMore = async () => {
		if (list.state !== 'loaded') return;
		try {
			const { reservations, total } = await adminApi<{ reservations: Reservation[]; total: number }>(
				`/api/admin/reservations?filter=${filter}&limit=100&offset=${list.list.length}`,
			);
			const merged = list.list.concat(reservations || []);
			shown.current = merged.length;
			setList({ state: 'loaded', list: merged, total: total ?? merged.length });
		} catch (error) {
			setList({ state: 'error', message: errorText(error) });
		}
	};

	const changeStatus = async (reservation: Reservation, status: string, label: string) => {
		// تغییر وضعیت (به‌خصوص لغو) برگشت‌پذیر نیست و برای مشتری پیامک می‌فرستد
		if (!window.confirm(`وضعیت این رزرو به «${label}» تغییر کند؟ این کار قابل برگشت نیست.`)) return;
		setBusyId(reservation.id);
		try {
			await adminApi(`/api/admin/reservations/${reservation.id}/status`, { method: 'PATCH', body: { status } });
			await load(filter);
			if (isMain) onChanged();
		} catch (error) {
			setNotice(errorText(error));
		} finally {
			setBusyId(null);
		}
	};

	const actionsFor = (reservation: Reservation) => {
		const started = new Date(reservation.startAt) <= new Date();
		return STATUS_ACTIONS.filter(
			(action) => action.from.includes(reservation.status) && (!action.managerOnly || isMain) && (!action.afterStart || started),
		);
	};

	return (
		<>
			<div id="reservationTabs" className="filter-tabs">
				{counts &&
					TABS.map(([key, label, icon]) => (
						<button type="button" key={key} className={`filter-tab${key === filter ? ' active' : ''}`} onClick={() => key !== filter && setFilter(key)}>
							{ICONS[icon]}
							<span>{`${label} (${fa(counts[key] ?? 0)})`}</span>
						</button>
					))}
			</div>
			<div id="reservationBox">
				{list.state === 'loading' && <Skeleton height={180} />}
				{list.state === 'error' && <ErrorNotice message={list.message} />}
				{list.state === 'loaded' && list.list.length === 0 && <EmptyState title="هنوز رزروی ثبت نشده" text="رزروهای جدید همین‌جا ظاهر می‌شن." />}
				{list.state === 'loaded' && list.list.length > 0 && (
					<>
						{notice ? (
							<div id="reservationsNotice" className="notice danger">
								{notice}
							</div>
						) : list.list.length < list.total ? (
							<div id="reservationsNotice" className="notice">
								<span>{`${fa(list.list.length)} رزرو از مجموع ${fa(list.total)} رزرو نمایش داده شده.`}</span>{' '}
								<button type="button" className="secondary-btn" id="loadMoreReservations" onClick={loadMore}>
									نمایش بیشتر
								</button>
							</div>
						) : (
							<div id="reservationsNotice"></div>
						)}
						<div className="table-scroll">
							<table className="table-list">
								<thead>
									<tr>
										<th>کد</th>
										<th>مشتری</th>
										<th>زمان</th>
										<th>میز</th>
										<th>مبلغ</th>
										<th>وضعیت</th>
										<th>عملیات</th>
									</tr>
								</thead>
								<tbody>
									{list.list.map((r) => {
										const actions = actionsFor(r);
										return (
											<tr key={r.id}>
												<td>{r.trackingCode}</td>
												<td>
													{r.customerName}
													<br />
													<small style={{ color: 'var(--deep-taupe)' }}>{r.customerPhone}</small>
												</td>
												<td>{faDateTime(r.startAt)}</td>
												<td>{(r.tables || []).map((item) => item.table?.displayNumber).join(' و ')}</td>
												<td>
													{`${toman(r.totalAmount)}${r.decorationAmount > 0 ? ' ' : ''}`}
													{r.decorationAmount > 0 && <span className="chip">{`🎀 ${r.decorationNote || 'تزئین'}`}</span>}
												</td>
												<td>
													<span className={`status ${r.status}`}>{statusFa(r.status)}</span>
													{r.refundStatus === 'PENDING' && (
														<>
															{' '}
															<span className="chip">بازگشت وجه</span>
														</>
													)}
												</td>
												<td>
													{actions.length ? (
														<select
															value=""
															disabled={busyId === r.id}
															aria-label={`تغییر وضعیت رزرو ${r.trackingCode}`}
															onChange={(event) => {
																const action = actions.find((a) => a.to === event.target.value);
																if (action) changeStatus(r, action.to, action.label);
															}}
														>
															<option value="">انتخاب</option>
															{actions.map((a) => (
																<option key={a.to} value={a.to}>
																	{a.label}
																</option>
															))}
														</select>
													) : (
														<span className="hint">—</span>
													)}
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</>
				)}
			</div>
		</>
	);
}
