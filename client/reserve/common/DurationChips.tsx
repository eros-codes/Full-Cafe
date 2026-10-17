import { faNumber } from '../../shared/format';

/** «۱ ساعت» … «۴ ساعت» in half-hour steps. */
export function DurationChips({ value, onChange, id }: { value: number; onChange: (minutes: number) => void; id?: string }) {
	const options: number[] = [];
	for (let minutes = 60; minutes <= 240; minutes += 30) options.push(minutes);
	return (
		<div id={id} className="chip-row">
			{options.map((minutes) => (
				<button key={minutes} type="button" className={`chip${minutes === value ? ' active' : ''}`} onClick={() => onChange(minutes)}>
					{`${faNumber(minutes / 60)} ساعت`}
				</button>
			))}
		</div>
	);
}
