import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import type { MapTable } from '../../reserve/map/types';
import { adminApi } from '../common/adminApi';
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
		setBusy(true);
		try {
			await adminApi('/api/admin/closures', {
				method: 'POST',
				body: { title, date, startTime: start || null, endTime: closingTime(start, end), zone: zone || null, tableId: tableId || null },
			});
			setTitle('');
			setDate('');
			setStart('');
			setEnd('');
			setZone('');
			setTableId('');
			setNotice({ type: 'ok', text: 'تعطیلی ثبت شد.' });
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
			setNotice(null);
			setReloadKey((k) => k + 1);
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		}
	};

	return (
		<>
			<Notice id="closuresNotice" notice={notice} />
			<div className="form-grid" style={{ marginBottom: '20px' }}>
				<div className="row">
					<div className="field">
						<label>عنوان تعطیلی</label>
						<input id="cTitle" placeholder="مثلاً تعطیلی رسمی" value={title} onChange={(e) => setTitle(e.target.value)} />
					</div>
					<div className="field">
						<label>تاریخ</label>
						<input id="cDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
					</div>
				</div>
				<div className="row">
					<div className="field">
						<label>از ساعت (اختیاری)</label>
						<input id="cStart" type="time" step="900" value={start} onChange={(e) => setStart(e.target.value)} />
					</div>
					<div className="field">
						<label>تا ساعت (اختیاری)</label>
						<input id="cEnd" type="time" step="900" value={end} onChange={(e) => setEnd(e.target.value)} />
					</div>
				</div>
				<div className="row">
					<div className="field">
						<label>سالن</label>
						<select id="cZone" value={zone} onChange={(e) => setZone(e.target.value)}>
							<option value="">کل کافه</option>
							<option value="WINDOW">سالن پنجره</option>
							<option value="CENTER">سالن وسط</option>
							<option value="ROOF">روف گاردن</option>
						</select>
					</div>
					<div className="field">
						<label>میز خاص</label>
						<select id="cTable" value={tableId} onChange={(e) => setTableId(e.target.value)}>
							<option value="">بدون میز خاص</option>
							{tables.map((table) => (
								<option key={table.id} value={table.id}>
									{`میز ${table.displayNumber}`}
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
							closures.map((closure) => (
								<tr key={closure.id}>
									<td>{closure.title}</td>
									<td>{new Date(closure.date).toLocaleDateString('fa-IR')}</td>
									<td>{closure.startTime ? `${closure.startTime} تا ${closure.endTime || '?'}` : 'کل روز'}</td>
									<td>{`${(closure.zone && ZONE_FA[closure.zone]) || ''} ${closure.table ? `میز ${closure.table.displayNumber}` : ''}`}</td>
									<td>
										<button className="danger-btn" aria-label={`حذف «${closure.title}»`} onClick={() => remove(closure)}>
											{ICONS.trash}
										</button>
									</td>
								</tr>
							))
						) : (
							<tr>
								<td colSpan={5} style={{ textAlign: 'center', color: 'var(--deep-taupe)' }}>
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
