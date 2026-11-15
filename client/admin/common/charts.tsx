import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react';
import { faNumber } from '../../shared/format';
import { useEntering } from './motion';

// The dashboard's and reports' charts, drawn in SVG at the card's real width (no chart library).
//
//   · one measure per chart (never two scales on one chart): revenue, bookings and visits are separate charts
//   · time runs from right (oldest) to left (today), the way the page reads
//   · a tooltip on hover, tap or the arrow keys; a table of the same numbers for screen readers
//   · thin marks, rounded bar ends on the baseline, quiet grid lines, text in the text colours
//   · the first time a chart appears its bars grow from the baseline one after another and its line draws itself

export interface ChartPoint {
	/** Unique key (the date). */
	key: string;
	/** Short label under the axis («ش ۲۴»). */
	label: string;
	/** The full label in the tooltip and the table («شنبه ۲۴ آبان»). */
	full: string;
	value: number;
}

/** The width of an element, followed as it changes (sidebar opened, phone turned). */
function useWidth<T extends HTMLElement>(): [RefObject<T | null>, number] {
	const ref = useRef<T>(null);
	const [width, setWidth] = useState(0);
	useEffect(() => {
		const element = ref.current;
		if (!element) return;
		setWidth(element.clientWidth);
		const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
		observer.observe(element);
		return () => observer.disconnect();
	}, []);
	return [ref, width];
}

/** A round top for the axis: 0 · 1 · 2 · 2.5 · 5 × 10ⁿ. */
function niceMax(value: number): number {
	if (value <= 0) return 1;
	const power = 10 ** Math.floor(Math.log10(value));
	for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * power) return step * power;
	return 10 * power;
}

/** Large amounts on the axis: in thousands or millions (the unit is said in the card's subtitle). */
export function amountScale(max: number): { divisor: number; unit: string } {
	return max >= 10_000_000 ? { divisor: 1_000_000, unit: 'میلیون تومان' } : { divisor: 1_000, unit: 'هزار تومان' };
}

const PAD_TOP = 14;
const PAD_BOTTOM = 30;
const AXIS_W = 46;

interface Frame {
	width: number;
	height: number;
	x0: number;
	x1: number;
	y0: number;
	y1: number;
	step: number;
	top: number;
	/** The middle of point i (0 = the oldest, at the right). */
	cx: (i: number) => number;
	y: (value: number) => number;
}

function frame(width: number, height: number, count: number, max: number): Frame {
	const x0 = 4;
	const x1 = width - AXIS_W;
	const y0 = PAD_TOP;
	const y1 = height - PAD_BOTTOM;
	const step = (x1 - x0) / Math.max(count, 1);
	const top = niceMax(max);
	return {
		width,
		height,
		x0,
		x1,
		y0,
		y1,
		step,
		top,
		cx: (i) => x1 - (i + 0.5) * step,
		y: (value) => y1 - (value / top) * (y1 - y0),
	};
}

function Axis({ f, axisFormat, points, active }: { f: Frame; axisFormat: (n: number) => string; points: ChartPoint[]; active: number | null }) {
	const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * f.top);
	// labels far enough apart not to touch; today's always shown
	const every = Math.max(1, Math.ceil(40 / f.step));
	const last = points.length - 1;
	return (
		<g>
			{ticks.map((t, i) => (
				<g key={i}>
					<line x1={f.x0} x2={f.x1} y1={f.y(t)} y2={f.y(t)} className={i === 0 ? 'chart-base' : 'chart-grid'} />
					<text x={f.width - 2} y={f.y(t)} className="chart-tick" textAnchor="end" dominantBaseline="middle">
						{axisFormat(t)}
					</text>
				</g>
			))}
			{points.map((p, i) =>
				(last - i) % every === 0 || i === active ? (
					<text key={p.key} x={f.cx(i)} y={f.height - 8} className={`chart-xlabel${i === active ? ' is-active' : ''}`} textAnchor="middle">
						{p.label}
					</text>
				) : null,
			)}
		</g>
	);
}

/** The point under the pointer or chosen with the arrow keys, and the tooltip's place. */
function useActive(count: number, f: Frame | null) {
	const [active, setActive] = useState<number | null>(null);
	const onPointerMove = (event: PointerEvent<SVGSVGElement>) => {
		if (!f) return;
		const box = event.currentTarget.getBoundingClientRect();
		const x = event.clientX - box.left;
		const i = Math.floor((f.x1 - x) / f.step);
		setActive(i >= 0 && i < count ? i : null);
	};
	const onKeyDown = (event: KeyboardEvent<SVGSVGElement>) => {
		// right-to-left: ← is the next (newer) day, → the previous one
		if (event.key === 'ArrowLeft') setActive((a) => Math.min(count - 1, a === null ? count - 1 : a + 1));
		else if (event.key === 'ArrowRight') setActive((a) => Math.max(0, a === null ? count - 1 : a - 1));
		else if (event.key === 'Escape') setActive(null);
		else return;
		event.preventDefault();
	};
	return {
		active,
		handlers: {
			onPointerMove,
			onPointerDown: onPointerMove,
			onPointerLeave: () => setActive(null),
			onKeyDown,
			onFocus: () => setActive((a) => a ?? count - 1),
			onBlur: () => setActive(null),
		},
	};
}

function Tooltip({ x, y, width, title, value }: { x: number; y: number; width: number; title: string; value: string }) {
	// kept inside the card: flipped to the other side near an edge
	const left = Math.min(Math.max(x, 70), width - 70);
	return (
		<div className="chart-tip" style={{ left: `${left}px`, top: `${y}px` }} role="presentation">
			<span>{title}</span>
			<strong>{value}</strong>
		</div>
	);
}

function DataTable({ caption, points, format }: { caption: string; points: ChartPoint[]; format: (n: number) => string }) {
	return (
		<table className="sr-only">
			<caption>{caption}</caption>
			<tbody>
				{points.map((p) => (
					<tr key={p.key}>
						<th scope="row">{p.full}</th>
						<td>{format(p.value)}</td>
					</tr>
				))}
			</tbody>
		</table>
	);
}

interface SeriesChartProps {
	/** What the chart shows, for screen readers («درآمد ۱۴ روز اخیر»). */
	label: string;
	points: ChartPoint[];
	/** A value in the tooltip and the table. */
	format: (n: number) => string;
	/** A value on the axis (shorter). */
	axisFormat?: (n: number) => string;
	height?: number;
	/** var(--chart-1) or var(--chart-2). */
	color?: string;
	/** Shown over the chart when every value is zero. */
	emptyText?: string;
}

function ChartFrame({ children, empty, emptyText }: { children: ReactNode; empty: boolean; emptyText?: string }) {
	return (
		<>
			{children}
			{empty && emptyText && <p className="chart-empty">{emptyText}</p>}
		</>
	);
}

/** One bar per day. */
export function BarChart({ label, points, format, axisFormat = (n) => faNumber(n), height = 220, color = 'var(--chart-1)', emptyText }: SeriesChartProps) {
	const [ref, width] = useWidth<HTMLDivElement>();
	const max = Math.max(0, ...points.map((p) => p.value));
	const f = width > 0 ? frame(width, height, points.length, max) : null;
	const { active, handlers } = useActive(points.length, f);
	const id = useId();
	const entering = useEntering(f !== null);

	return (
		<div className={`chart${entering ? ' is-entering' : ''}`} ref={ref} style={{ height: `${height}px`, ['--series' as string]: color }}>
			{f && (
				<ChartFrame empty={max === 0} emptyText={emptyText}>
					<svg
						width={f.width}
						height={f.height}
						role="img"
						aria-labelledby={id}
						tabIndex={0}
						className={active !== null ? 'has-active' : undefined}
						{...handlers}
					>
						<title id={id}>{`${label}. با کلیدهای جهت روزها را مرور کنید.`}</title>
						<Axis f={f} axisFormat={axisFormat} points={points} active={active} />
						{points.map((p, i) => {
							const w = Math.max(4, Math.min(f.step * 0.56, 30));
							const x = f.cx(i) - w / 2;
							const yTop = f.y(p.value);
							const h = f.y1 - yTop;
							// the order they grow in: the oldest (right) first
							const delay = { ['--i' as string]: i } as CSSProperties;
							if (h < 0.5) return <rect key={p.key} x={x} y={f.y1 - 2} width={w} height={2} rx={1} className="chart-bar is-zero" style={delay} />;
							const r = Math.min(4, w / 2, h);
							const d = `M${x},${f.y1}V${yTop + r}Q${x},${yTop} ${x + r},${yTop}H${x + w - r}Q${x + w},${yTop} ${x + w},${yTop + r}V${f.y1}Z`;
							return <path key={p.key} d={d} className={`chart-bar${i === active ? ' is-active' : ''}`} style={delay} />;
						})}
					</svg>
					{active !== null && (
						<Tooltip x={f.cx(active)} y={f.y(points[active].value) - 10} width={f.width} title={points[active].full} value={format(points[active].value)} />
					)}
				</ChartFrame>
			)}
			<DataTable caption={label} points={points} format={format} />
		</div>
	);
}

/** A line through the days, with a light area under it. */
export function LineChart({ label, points, format, axisFormat = (n) => faNumber(n), height = 200, color = 'var(--chart-2)', emptyText }: SeriesChartProps) {
	const [ref, width] = useWidth<HTMLDivElement>();
	const max = Math.max(0, ...points.map((p) => p.value));
	const f = width > 0 ? frame(width, height, points.length, max) : null;
	const { active, handlers } = useActive(points.length, f);
	const id = useId();
	const gradient = useId().replace(/:/g, '');
	const entering = useEntering(f !== null);

	let line = '';
	let area = '';
	if (f && points.length) {
		const xy = points.map((p, i) => [f.cx(i), f.y(p.value)] as const);
		line = xy.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join('');
		area = `${line}L${xy[xy.length - 1][0].toFixed(1)},${f.y1}L${xy[0][0].toFixed(1)},${f.y1}Z`;
	}

	return (
		<div className={`chart${entering ? ' is-entering' : ''}`} ref={ref} style={{ height: `${height}px`, ['--series' as string]: color }}>
			{f && (
				<ChartFrame empty={max === 0} emptyText={emptyText}>
					<svg width={f.width} height={f.height} role="img" aria-labelledby={id} tabIndex={0} {...handlers}>
						<title id={id}>{`${label}. با کلیدهای جهت روزها را مرور کنید.`}</title>
						<defs>
							<linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
								<stop offset="0%" stopColor={color} stopOpacity="0.22" />
								<stop offset="100%" stopColor={color} stopOpacity="0" />
							</linearGradient>
						</defs>
						<Axis f={f} axisFormat={axisFormat} points={points} active={active} />
						<path d={area} fill={`url(#${gradient})`} className="chart-area" />
						{/* pathLength 1: the drawing animation does not need the line's real length */}
						<path d={line} className="chart-line" pathLength={1} />
						{active !== null && (
							<>
								<line x1={f.cx(active)} x2={f.cx(active)} y1={f.y0} y2={f.y1} className="chart-cross" />
								<circle cx={f.cx(active)} cy={f.y(points[active].value)} r={5} className="chart-dot" />
							</>
						)}
					</svg>
					{active !== null && (
						<Tooltip x={f.cx(active)} y={f.y(points[active].value) - 12} width={f.width} title={points[active].full} value={format(points[active].value)} />
					)}
				</ChartFrame>
			)}
			<DataTable caption={label} points={points} format={format} />
		</div>
	);
}

export interface RankRow {
	key: string;
	label: string;
	/** Under the label («سالن اصلی»). */
	note?: string;
	value: number;
	/** The value as shown («۱۲ رزرو»). */
	text: string;
}

/** Horizontal bars for a ranked list (the most booked tables, bookings by outcome). */
export function RankBars({ rows, label }: { rows: RankRow[]; label: string }) {
	const max = Math.max(1, ...rows.map((r) => r.value));
	const entering = useEntering(true);
	return (
		<ul className={`rank-bars${entering ? ' is-entering' : ''}`} aria-label={label}>
			{rows.map((r) => (
				<li key={r.key}>
					<div className="rank-head">
						<span className="rank-label">
							{r.label}
							{r.note && <small>{r.note}</small>}
						</span>
						<strong>{r.text}</strong>
					</div>
					<div className="rank-track" aria-hidden="true">
						<span style={{ width: `${Math.max(r.value ? 3 : 0, (r.value / max) * 100)}%`, ['--i' as string]: rows.indexOf(r) } as CSSProperties}></span>
					</div>
				</li>
			))}
		</ul>
	);
}
