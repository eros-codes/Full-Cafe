import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { latinDigits } from '../../shared/format';
import { adminApi } from '../common/adminApi';
import { ErrorNotice, Notice, Skeleton, type NoticeState } from '../common/ui';

interface WorkingHour {
	dayOfWeek: number;
	opensAt: string;
	closesAt: string;
	isClosed: boolean;
}

/** Indexed by dayOfWeek (0 = Sunday, like Date.getDay()). */
const DAY_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

/** Opening hours per weekday. Closing time goes up to 24:00 (midnight); past-midnight hours are not supported. */
export function Hours() {
	const [rows, setRows] = useState<WorkingHour[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<NoticeState>(null);
	const [savingDay, setSavingDay] = useState<number | null>(null);

	useEffect(() => {
		let current = true;
		adminApi<{ workingHours: WorkingHour[] }>('/api/admin/working-hours')
			.then((r) => current && setRows(r.workingHours))
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
			const { workingHour } = await adminApi<{ workingHour: WorkingHour }>(`/api/admin/working-hours/${row.dayOfWeek}`, {
				method: 'PATCH',
				body: { opensAt: latinDigits(row.opensAt).trim(), closesAt: latinDigits(row.closesAt).trim(), isClosed: row.isClosed },
			});
			edit(row.dayOfWeek, workingHour);
			setNotice({ type: 'ok', text: `ساعت کاری ${DAY_FA[row.dayOfWeek]} ذخیره شد.` });
		} catch (err) {
			setNotice({ type: 'danger', text: errorText(err) });
		} finally {
			setSavingDay(null);
		}
	};

	return (
		<>
			<Notice id="hoursNotice" notice={notice} />
			<div className="table-scroll">
				<table className="table-list">
					<thead>
						<tr>
							<th>روز</th>
							<th>از ساعت</th>
							<th>تا ساعت</th>
							<th>تعطیل</th>
							<th></th>
						</tr>
					</thead>
					<tbody>
						{rows.map((row) => (
							<tr key={row.dayOfWeek}>
								<td>{DAY_FA[row.dayOfWeek]}</td>
								<td>
									<input
										value={row.opensAt}
										aria-label={`ساعت باز شدن ${DAY_FA[row.dayOfWeek]}`}
										style={{ maxWidth: '100px' }}
										onChange={(e) => edit(row.dayOfWeek, { opensAt: e.target.value })}
									/>
								</td>
								<td>
									<input
										value={row.closesAt}
										aria-label={`ساعت بسته شدن ${DAY_FA[row.dayOfWeek]} (نیمه‌شب: 24:00)`}
										style={{ maxWidth: '100px' }}
										onChange={(e) => edit(row.dayOfWeek, { closesAt: e.target.value })}
									/>
								</td>
								<td>
									<input
										type="checkbox"
										checked={row.isClosed}
										aria-label={`${DAY_FA[row.dayOfWeek]} تعطیل است`}
										style={{ width: '18px', height: '18px', boxShadow: 'none' }}
										onChange={(e) => edit(row.dayOfWeek, { isClosed: e.target.checked })}
									/>
								</td>
								<td>
									<button className="secondary-btn" disabled={savingDay === row.dayOfWeek} onClick={() => save(row)}>
										ذخیره
									</button>
								</td>
							</tr>
						))}
					</tbody>
				</table>
			</div>
		</>
	);
}
