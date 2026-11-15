import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { faDigits } from '../../shared/format';
import { ICONS } from '../../shared/icons';
import { jalaliLabel, tehranDayOf, tehranToday } from '../../shared/jalali';
import type { MapTable } from '../../reserve/map/types';
import { adminApi } from '../common/adminApi';
import { affectedNotice, type AffectedReservation } from '../common/AffectedReservations';
import { JalaliDateField } from '../common/JalaliDateField';
import { ErrorNotice, Notice, Skeleton, ZONE_FA, type NoticeState } from '../common/ui';

interface Closure {
	id: string;
	title: string;
	date: string;
	startTime: string | null;
	endTime: string | null;
	zone: string | null;
	table: { displayNumber: string } | null;
}

/**
 * The time picker cannot show 24:00, so «until 00:00» after a start time means «until the end of the day».
 * Without a start time both stay empty (= the whole day).
 */
function closingTime(start: string, end: string): string | null {
	if (!end) return null;
	return start && end === '00:00' ? '24:00' : end;
}

function scopeText(closure: Closure): string {
	const parts = [closure.zone ? ZONE_FA[closure.zone] : '', closure.table ? `میز ${faDigits(closure.table.displayNumber)}` : ''].filter(Boolean);
	return parts.length ? parts.join(' · ') : 'کل کافه';
}

/** Days off and blocked hours: the whole café, one hall, or one table. */
export function Closures({ tables }: { tables: MapTable[] }) {
	const [closures, setClosures] = useState<Closure[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<NoticeState>(null);
	const [title, setTitle] = useState('');
	const [date, setDate] = useState('');
	const [start, setStart] = useState('');
	const [end, setEnd] = useState('');
	const [zone, setZone] = useState('');
	const [tableId, setTableId] = useState('');
	const [busy, setBusy] = useState(false);
	const [reloadKey, setReloadKey] = useState(0);

	useEffect(() => {
		let current = true;
		adminApi<{ closures: Closure[] }>('/api/admin/closures')
			.then((r) => {
				if (!current) return;
				setClosures(r.closures);
				setError(null);
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [reloadKey]);

	if (error && !closures) return <ErrorNotice message={error} />;
	if (!closures) return <Skeleton height={180} />;

	const add = async () => {
		if (!title.trim()) return setNotice({ type: 'danger', text: 'عنوان تعطیلی را بنویس.' });
		if (!date) return setNotice({ type: 'danger', text: 'روز، ماه و سال تعطیلی را انتخاب کن.' });
		setBusy(true);
		try {
			const { affected } = await adminApi<{ affected?: AffectedReservation[] }>('/api/admin/closures', {
				method: 'POST',
				body: { title, date, startTime: start || null, endTime: closingTime(start, end), zone: zone || null, tableId: tableId || null },
			});
			setTitle('');
			setDate('');
			setStart('');
			setEnd('');
			setZone('');
			setTableId('');
			setNotice(affectedNotice('تعطیلی ثبت شد.', affected));
			setReloadKey((k) => k + 1);
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		} finally {
			setBusy(false);
		}
	};

	const remove = async (closure: Closure) => {
		try {
			await adminApi(`/api/admin/closures/${closure.id}`, { method: 'DELETE' });
			setNotice({ type: 'ok', text: `«${closure.title}» حذف شد.` });
			setReloadKey((k) => k + 1);
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		}
	};

	const today = tehranToday();

	return (
		<>
			<Notice id="closuresNotice" notice={notice} reveal />
			<div className="form-grid menu-inline-form">
				<div className="row">
					<div className="field">
						<label htmlFor="cTitle">عنوان تعطیلی</label>
						<input id="cTitle" placeholder="مثلاً تعطیلی رسمی" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
					</div>
					<JalaliDateField id="cDate" label="تاریخ" value={date} onChange={setDate} />
				</div>
				<div className="row">
					<div className="field">
						<label htmlFor="cStart">از ساعت (خالی = کل روز)</label>
						<input id="cStart" type="time" step="900" value={start} onChange={(e) => setStart(e.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="cEnd">تا ساعت (۰۰:۰۰ = پایان روز)</label>
						<input id="cEnd" type="time" step="900" value={end} onChange={(e) => setEnd(e.target.value)} />
					</div>
				</div>
				<div className="row">
					<div className="field">
						<label htmlFor="cZone">سالن</label>
						<select id="cZone" value={zone} onChange={(e) => setZone(e.target.value)}>
							<option value="">کل کافه</option>
							{Object.entries(ZONE_FA).map(([key, label]) => (
								<option key={key} value={key}>
									{label}
								</option>
							))}
						</select>
					</div>
					<div className="field">
						<label htmlFor="cTable">میز خاص</label>
						<select id="cTable" value={tableId} onChange={(e) => setTableId(e.target.value)}>
							<option value="">بدون میز خاص</option>
							{tables.map((table) => (
								<option key={table.id} value={table.id}>
									{`میز ${faDigits(table.displayNumber)}`}
								</option>
							))}
						</select>
					</div>
				</div>
				<button id="addClosure" className="primary-btn" disabled={busy} onClick={add}>
					{ICONS.plus}
					<span>افزودن تعطیلی / بلاک</span>
				</button>
			</div>
			<div className="table-scroll">
				<table className="table-list">
					<thead>
						<tr>
							<th>عنوان</th>
							<th>تاریخ</th>
							<th>بازه</th>
							<th>سالن/میز</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{closures.length ? (
							closures.map((closure) => {
								// the stored date is midnight in Tehran: read it in Tehran, whatever the device's time zone
								const day = tehranDayOf(closure.date);
								return (
									<tr key={closure.id} style={day < today ? { opacity: 0.55 } : undefined}>
										<td>{closure.title}</td>
										<td>{jalaliLabel(day)}</td>
										<td>{closure.startTime ? `${faDigits(closure.startTime)} تا ${faDigits(closure.endTime || '?')}` : 'کل روز'}</td>
										<td>{scopeText(closure)}</td>
										<td>
											<button className="danger-btn" aria-label={`حذف «${closure.title}»`} onClick={() => remove(closure)}>
												{ICONS.trash}
											</button>
										</td>
									</tr>
								);
							})
						) : (
							<tr>
								<td colSpan={5} className="muted" style={{ textAlign: 'center' }}>
									تعطیلی ثبت نشده
								</td>
							</tr>
						)}
					</tbody>
				</table>
			</div>
		</>
	);
}
