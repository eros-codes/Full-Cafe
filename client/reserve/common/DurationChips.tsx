import { faNumber } from '../../shared/format';
import { durationOptions } from './durations';

export { fitDuration } from './durations';

/** «۴۵ دقیقه», «۱ ساعت», «۱٫۵ ساعت». */
function durationLabel(minutes: number): string {
	return minutes % 30 === 0 ? `${faNumber(minutes / 60)} ساعت` : `${faNumber(minutes)} دقیقه`;
}

/** The booking lengths the café allows (`min`…`max` minutes, from its settings). */
export function DurationChips({ value, onChange, id, min, max }: { value: number; onChange: (minutes: number) => void; id?: string; min?: number; max?: number }) {
	return (
		<div id={id} className="chip-row">
			{durationOptions(min, max).map((minutes) => (
				<button key={minutes} type="button" className={`chip${minutes === value ? ' active' : ''}`} onClick={() => onChange(minutes)}>
					{durationLabel(minutes)}
				</button>
			))}
		</div>
	);
}
