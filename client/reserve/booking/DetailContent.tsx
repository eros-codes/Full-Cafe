import { ICONS } from '../../shared/icons';

export type Detail =
	| { kind: 'skeleton' }
	| { kind: 'card'; title: string; lines: string[]; action?: boolean }
	| { kind: 'suggestions'; items: { startTime: string; endTime: string }[] };

export const card = (title: string, ...lines: string[]): Detail => ({ kind: 'card', title, lines });

export function DetailContent({ detail, onReserve, onSuggestion }: { detail: Detail; onReserve: () => void; onSuggestion: (startTime: string) => void }) {
	if (detail.kind === 'skeleton') {
		return (
			<>
				<div className="skeleton" style={{ height: '15px', width: '55%', marginBottom: '10px' }}></div>
				<div className="skeleton" style={{ height: '11px', width: '85%' }}></div>
			</>
		);
	}
	if (detail.kind === 'suggestions') {
		return (
			<>
				<h4>ساعت‌های نزدیک آزاد</h4>
				<p>یکی رو انتخاب کن تا همون لحظه بررسی بشه.</p>
				<div className="chip-row" id="suggestionRow">
					{detail.items.map((item) => (
						<button key={item.startTime} type="button" className="chip" onClick={() => onSuggestion(item.startTime)}>
							{`${item.startTime} تا ${item.endTime}`}
						</button>
					))}
				</div>
			</>
		);
	}
	return (
		<>
			<h4>{detail.title}</h4>
			{detail.lines.map((line, i) => (
				<p key={i}>{line}</p>
			))}
			{detail.action && (
				<button className="primary-btn" id="openReserve" style={{ marginTop: '10px' }} onClick={onReserve}>
					{ICONS.check}
					<span>ادامه رزرو</span>
				</button>
			)}
		</>
	);
}
