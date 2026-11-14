import { faDigits, faNumber } from '../../shared/format';
import { jalaliLabel, tehranDayOf } from '../../shared/jalali';
import type { NoticeState } from './ui';

/** A booking a new closure or new working hours fall on (src/services/schedule-impact.service.ts). */
export interface AffectedReservation {
	id: string;
	trackingCode: string;
	customerName: string;
	customerPhone: string;
	startAt: string;
	endAt: string;
	tables: string[];
}

const clock = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Tehran', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

function when(r: AffectedReservation): string {
	const day = tehranDayOf(r.startAt);
	// a booking that ends at midnight ends «24:00» of its own day, not «00:00»
	const end = tehranDayOf(r.endAt) === day ? clock.format(new Date(r.endAt)) : '24:00';
	return `${jalaliLabel(day)}، ${faDigits(clock.format(new Date(r.startAt)))} تا ${faDigits(end)}`;
}

/**
 * What the panel says after a closure or new hours are saved: just `done`, or — when bookings fall inside — a warning
 * with each booking, so the staff can call the customers (cancel and refund from «رزروها»).
 */
export function affectedNotice(done: string, affected: AffectedReservation[] | undefined): NoticeState {
	if (!affected?.length) return { type: 'ok', text: done };
	return {
		type: 'warn',
		text: (
			<>
				{`${done} ${faNumber(affected.length)} رزرو قطعی در این بازه هست؛ با مشتری‌ها تماس بگیر (لغو و بازگرداندن پول از بخش «رزروها»):`}
				<ul className="affected-list">
					{affected.map((r) => (
						<li key={r.id}>
							<bdi>{r.trackingCode}</bdi>
							{` · ${r.customerName} · `}
							<bdi>{r.customerPhone}</bdi>
							{` · ${when(r)}${r.tables.length ? ` · میز ${r.tables.map(faDigits).join('، ')}` : ''}`}
						</li>
					))}
				</ul>
			</>
		),
	};
}
