import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { latinDigits } from '../../shared/format';
import { adminApi } from '../common/adminApi';
import { affectedNotice, type AffectedReservation } from '../common/AffectedReservations';
import { ErrorNotice, Notice, Skeleton, type NoticeState } from '../common/ui';

interface WorkingHour {
	dayOfWeek: number;
	opensAt: string;
	closesAt: string;
	isClosed: boolean;
}

/** Indexed by dayOfWeek (0 = Sunday, like Date.getDay()). */
const DAY_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
/** The Persian week starts on Saturday (before, the list started on Sunday and ended with Saturday). */
const weekOrder = (day: number) => (day + 1) % 7;

const sameHours = (a: WorkingHour, b: WorkingHour | undefined) =>
	Boolean(b) && a.opensAt === b!.opensAt && a.closesAt === b!.closesAt && a.isClosed === b!.isClosed;

/**
 * Opening hours per weekday, each day saved on its own. Closing time goes up to 24:00 (midnight); past-midnight
 * hours are not supported. One line per day on a computer, a small card per day on a phone (before: a five-column
 * table that a phone had to scroll sideways, with «ذخیره» off screen).
 */
export function Hours() {
	const [rows, setRows] = useState<WorkingHour[] | null>(null);
	// what the server has, to mark a day edited but not saved yet
	const [saved, setSaved] = useState<Map<number, WorkingHour>>(new Map());
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<NoticeState>(null);
	const [savingDay, setSavingDay] = useState<number | null>(null);

	useEffect(() => {
		let current = true;
		adminApi<{ workingHours: WorkingHour[] }>('/api/admin/working-hours')
			.then((r) => {
				if (!current) return;
				setRows([...r.workingHours].sort((a, b) => weekOrder(a.dayOfWeek) - weekOrder(b.dayOfWeek)));
				setSaved(new Map(r.workingHours.map((w) => [w.dayOfWeek, w])));
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, []);

	if (error) return <ErrorNotice message={error} />;
	if (!rows) return <Skeleton height={180} />;

	const edit = (day: number, patch: Partial<WorkingHour>) => setRows((list) => (list ?? []).map((r) => (r.dayOfWeek === day ? { ...r, ...patch } : r)));

	const save = async (row: WorkingHour) => {
		setSavingDay(row.dayOfWeek);
		try {
			const { workingHour, affected } = await adminApi<{ workingHour: WorkingHour; affected?: AffectedReservation[] }>(
				`/api/admin/working-hours/${row.dayOfWeek}`,
				{
					method: 'PATCH',
					body: { opensAt: latinDigits(row.opensAt).trim(), closesAt: latinDigits(row.closesAt).trim(), isClosed: row.isClosed },
				},
			);
			edit(row.dayOfWeek, workingHour);
			setSaved((map) => new Map(map).set(row.dayOfWeek, workingHour));
			// bookings already made for this weekday that the new hours leave out are listed
			setNotice(affectedNotice(`ساعت کاری ${DAY_FA[row.dayOfWeek]} ذخیره شد.`, affected));
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		} finally {
			setSavingDay(null);
		}
	};

	return (
		<>
			<Notice id="hoursNotice" notice={notice} reveal />
			<div className="hours-list">
				{rows.map((row) => {
					const day = DAY_FA[row.dayOfWeek];
					const dirty = !sameHours(row, saved.get(row.dayOfWeek));
					return (
						<div className={`hours-day${row.isClosed ? ' is-closed' : ''}`} key={row.dayOfWeek} role="group" aria-label={day} data-day={row.dayOfWeek}>
							<strong className="hours-day__name">{day}</strong>
							<label className="hours-day__time hours-day__open">
								<span>از</span>
								<input
									value={row.opensAt}
									dir="ltr"
									inputMode="numeric"
									maxLength={5}
									aria-label={`ساعت باز شدن ${day}`}
									onChange={(e) => edit(row.dayOfWeek, { opensAt: e.target.value })}
								/>
							</label>
							<label className="hours-day__time hours-day__close">
								<span>تا</span>
								<input
									value={row.closesAt}
									dir="ltr"
									inputMode="numeric"
									maxLength={5}
									aria-label={`ساعت بسته شدن ${day} (نیمه‌شب: 24:00)`}
									onChange={(e) => edit(row.dayOfWeek, { closesAt: e.target.value })}
								/>
							</label>
							<label className="checkbox-row hours-day__closed">
								<input type="checkbox" checked={row.isClosed} aria-label={`${day} تعطیل است`} onChange={(e) => edit(row.dayOfWeek, { isClosed: e.target.checked })} />
								<span>تعطیل</span>
							</label>
							{/* an edited day that is not saved yet stands out, so it is not left unsaved by mistake */}
							<button
								type="button"
								className={`${dirty ? 'primary-btn' : 'secondary-btn'} hours-day__save`}
								disabled={savingDay === row.dayOfWeek}
								aria-label={dirty ? `ذخیره ${day} (تغییر ذخیره نشده)` : `ذخیره ${day}`}
								onClick={() => save(row)}
							>
								{dirty ? 'ذخیره تغییر' : 'ذخیره'}
							</button>
						</div>
					);
				})}
			</div>
		</>
	);
}
