import { memo } from 'react';
import { rounded } from './viewport';
import type { ChairPosition, MapTable } from './types';

// One table on the floor map, drawn exactly like the original renderer:
//   anchor (position, state class) › lift (hover / shadow) › [shadow+side layer, spin (rotated top + chairs), number badge, time bubble]

export type TableState = 'is-selected' | 'is-unavailable' | 'is-neutral' | 'is-perfect' | 'is-soft';

export function tableStateClass(table: MapTable, selectedIds: readonly string[], editorMode: boolean): TableState {
	if (selectedIds.includes(table.id)) return 'is-selected';
	if (editorMode) return table.isActive ? 'is-neutral' : 'is-unavailable';
	// هنوز بررسی نشده (شرایط جستجو عوض شده) — نه آزاد، نه رزروشده
	if (!table.availability) return 'is-neutral';
	if (!table.availability.available) return 'is-unavailable';
	return table.availability.matchType === 'perfect' ? 'is-perfect' : 'is-soft';
}

function Chair({ chair }: { chair: ChairPosition }) {
	if (chair.type === 'shared') {
		return (
			<g className="roof-chair roof-chair--shared" transform={`translate(${rounded(chair.x)} ${rounded(chair.y)}) rotate(${rounded(chair.angle || 0)})`}>
				<circle className="shared-seat-dot" cx="0" cy="0" r="6" />
				<title>صندلی مشترک با مبل — روی مبل پس‌زمینه می‌شینه</title>
			</g>
		);
	}
	return (
		<g className="roof-chair" transform={`translate(${rounded(chair.x)} ${rounded(chair.y)}) rotate(${rounded(chair.angle || 0)}) scale(${chair.scale || 1})`}>
			<ellipse className="chair-shadow" cx="0" cy="6" rx="13" ry="9" />
			<rect className="chair-base" x="-12" y="-9" width="24" height="19" rx="8" />
			<path className="chair-back" d="M-11-7Q0-16 11-7L9-2Q0-9-9-2Z" />
			<path className="chair-seam" d="M-7 3Q0 7 7 3" />
		</g>
	);
}

/**
 * سایه و دیواره‌ی کناری با میز می‌چرخن (تا گوشه‌هاشون هم‌راستا بمونه)، ولی افتادگی‌شون همیشه رو به پایینه:
 * هر شکل داخل rotate(زاویه) و آن داخل یک translate ثابت.
 */
function ShadowBase({ table }: { table: MapTable }) {
	const angle = rounded(table.rotation || 0);
	const w = Number(table.width);
	const h = Number(table.height);
	const isRound = table.shape === 'ROUND';
	const radius = table.shape === 'SQUARE' ? 6 : 11;
	return (
		<g className="roof-table-shadow-layer">
			<g transform={`translate(0 12) rotate(${angle})`}>
				{isRound ? (
					<ellipse className="table-shadow" cx="0" cy="0" rx={w / 2 + 5} ry={h / 2 + 4} />
				) : (
					<rect className="table-shadow" x={-w / 2 - 5} y={-h / 2 - 5} width={w + 10} height={h + 10} rx={radius + 4} />
				)}
			</g>
			<g transform={`translate(0 8) rotate(${angle})`}>
				{isRound ? (
					<ellipse className="table-side" cx="0" cy="0" rx={w / 2} ry={h / 2} />
				) : (
					<rect className="table-side" x={-w / 2} y={-h / 2} width={w} height={h} rx={radius} />
				)}
			</g>
		</g>
	);
}

function TableTop({ table }: { table: MapTable }) {
	const w = Number(table.width);
	const h = Number(table.height);
	const isRound = table.shape === 'ROUND';
	const radius = table.shape === 'SQUARE' ? 6 : 11;
	return (
		<g className="roof-table-body">
			{isRound ? (
				<ellipse className="table-top" cx="0" cy="0" rx={w / 2} ry={h / 2} />
			) : (
				<rect className="table-top" x={-w / 2} y={-h / 2} width={w} height={h} rx={radius} />
			)}
			{isRound ? (
				<ellipse className="table-highlight" cx={-w * 0.08} cy={-h * 0.08} rx={w * 0.31} ry={h * 0.2} />
			) : (
				<path className="table-highlight" d={`M${-w / 2 + 9} ${-h / 2 + 9}H${w / 2 - 9}`} />
			)}
		</g>
	);
}

/** «از ۱۵:۰۰» above the table (below it for the first row, where there is no room above). */
function TimeBubble({ text, table }: { text: string; table: MapTable }) {
	const halfH = 30;
	const arrow = 20;
	const w = Math.max(150, text.length * 16 + 44);
	const offset = Number(table.height) / 2 + 34 + halfH + arrow;
	const below = Number(table.y) - (offset + halfH) < 0;
	const y = below ? offset : -offset;
	const arrowPath = below ? `M-14 ${-halfH + 2}L0 ${-halfH - arrow}L14 ${-halfH + 2}Z` : `M-14 ${halfH - 2}L0 ${halfH + arrow}L14 ${halfH - 2}Z`;
	return (
		<g className="map-time-bubble" transform={`translate(0 ${y})`}>
			<rect x={-w / 2} y={-halfH} width={w} height={halfH * 2} rx="12" />
			<path d={arrowPath} />
			<text x="0" y="2" textAnchor="middle" dominantBaseline="middle">
				{text}
			</text>
		</g>
	);
}

interface Props {
	table: MapTable;
	stateClass: TableState;
	/** Stagger of the entry animation (only on the first draw). */
	delayMs: number;
	showTime: boolean;
	editable: boolean;
	dragging: boolean;
	onPointerDown?: (event: React.PointerEvent<SVGGElement>) => void;
	onActivate: (event: React.SyntheticEvent) => void;
}

export const MapTableNode = memo(function MapTableNode({ table, stateClass, delayMs, showTime, editable, dragging, onPointerDown, onActivate }: Props) {
	return (
		<g
			className={`roof-table-anchor ${stateClass}${editable ? ' is-editable' : ''}${dragging ? ' is-dragging' : ''}`}
			transform={`translate(${rounded(table.x)} ${rounded(table.y)})`}
			data-table-id={table.id}
			data-table-code={table.code}
			tabIndex={0}
			role="button"
			aria-label={`میز ${table.displayNumber}، ظرفیت ${table.capacity} نفر`}
			style={{ '--table-delay': `${delayMs}ms` } as React.CSSProperties}
			onClick={editable ? undefined : onActivate}
			onDoubleClick={editable ? onActivate : undefined}
			onKeyDown={(event) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					onActivate(event);
				}
			}}
			onPointerDown={onPointerDown}
		>
			<g className="roof-table-lift">
				<ShadowBase table={table} />
				<g className="roof-table-spin" transform={`rotate(${rounded(table.rotation || 0)})`}>
					{Array.isArray(table.chairs) && table.chairs.map((chair, i) => <Chair key={i} chair={chair} />)}
					<TableTop table={table} />
				</g>
				<g className="table-number-badge">
					<circle className="table-number-bg" cx="0" cy="0" r="15" />
					<text className="table-number" x="0" y="1" textAnchor="middle" dominantBaseline="middle">
						{table.displayNumber}
					</text>
				</g>
				{showTime && table.availability?.startTime ? <TimeBubble text={`از ${table.availability.startTime}`} table={table} /> : null}
			</g>
		</g>
	);
});
