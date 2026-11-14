import { useEffect, useRef, useState } from 'react';
import { faNumber } from '../../shared/format';
import {
	JALALI_MONTHS,
	daysBetween,
	daysInJalaliMonth,
	isoToJalali,
	jalaliLabel,
	jalaliToIso,
	tehranToday,
	type JalaliDate,
} from '../../shared/jalali';

interface Props {
	/** Prefix of the three selects' ids (`${id}-day`, `${id}-month`, `${id}-year`). */
	id: string;
	label: string;
	/** "YYYY-MM-DD" (Gregorian, what the API takes), or '' while no full date is chosen. */
	value: string;
	onChange: (iso: string) => void;
}

const relative = (iso: string) => {
	const days = daysBetween(tehranToday(), iso);
	if (days === 0) return 'امروز';
	if (days === 1) return 'فردا';
	if (days === -1) return 'دیروز';
	return days > 0 ? `${faNumber(days)} روز دیگر` : `${faNumber(-days)} روز پیش`;
};

/**
 * A Persian date as three selects (day · month · year), with the weekday read back under it. Before, these forms
 * had the browser's date picker, which is Gregorian only: the staff had to work out that «۱۵ آبان» is 6 November.
 */
export function JalaliDateField({ id, label, value, onChange }: Props) {
	const [parts, setParts] = useState<Partial<JalaliDate>>(() => isoToJalali(value) ?? {});
	// the last date this field reported, so a new value from outside (a form reset) is told apart from its own
	const reported = useRef(value);

	useEffect(() => {
		if (value === reported.current) return;
		reported.current = value;
		setParts(isoToJalali(value) ?? {});
	}, [value]);

	const thisYear = isoToJalali(tehranToday())?.year ?? 1405;
	const years = [...new Set([thisYear, thisYear + 1, ...(parts.year ? [parts.year] : [])])].sort((a, b) => a - b);
	const maxDay = parts.year && parts.month ? daysInJalaliMonth(parts.year, parts.month) : 31;

	const update = (patch: Partial<JalaliDate>) => {
		const next = { ...parts, ...patch };
		// 31 Farvardin → Mehr becomes 30 Mehr instead of an impossible date
		if (next.year && next.month && next.day) next.day = Math.min(next.day, daysInJalaliMonth(next.year, next.month));
		setParts(next);
		const iso = next.year && next.month && next.day ? (jalaliToIso(next as JalaliDate) ?? '') : '';
		reported.current = iso;
		onChange(iso);
	};
	const pick = (key: keyof JalaliDate) => (event: React.ChangeEvent<HTMLSelectElement>) =>
		update({ [key]: event.target.value ? Number(event.target.value) : undefined });

	return (
		<div className="field">
			<label htmlFor={`${id}-day`}>{label}</label>
			<div className="jalali-date" role="group" aria-label={label}>
				<select id={`${id}-day`} aria-label="روز" value={parts.day ?? ''} onChange={pick('day')}>
					<option value="">روز</option>
					{Array.from({ length: maxDay }, (_, i) => (
						<option key={i + 1} value={i + 1}>
							{faNumber(i + 1)}
						</option>
					))}
				</select>
				<select id={`${id}-month`} aria-label="ماه" value={parts.month ?? ''} onChange={pick('month')}>
					<option value="">ماه</option>
					{JALALI_MONTHS.map((name, i) => (
						<option key={name} value={i + 1}>
							{name}
						</option>
					))}
				</select>
				<select id={`${id}-year`} aria-label="سال" value={parts.year ?? ''} onChange={pick('year')}>
					<option value="">سال</option>
					{years.map((year) => (
						<option key={year} value={year}>
							{year.toLocaleString('fa-IR', { useGrouping: false })}
						</option>
					))}
				</select>
			</div>
			<p className="jalali-date__readout" aria-live="polite">
				{value ? `${jalaliLabel(value)} · ${relative(value)}` : ' '}
			</p>
		</div>
	);
}
