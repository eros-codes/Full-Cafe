import { Fragment, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type SVGProps } from 'react';
import { useLatest } from '../../shared/useLatest';
import { MapTableNode, tableStateClass } from './MapTable';
import { MapViewport, rounded } from './viewport';
import type { MapConfig, MapTable } from './types';

// The interactive floor map shared by the reservation page and the admin map editor:
// zone tabs, the SVG (painted base + tables), a loading overlay and the +/−/⌂ controls.

const BASE_URL = '/maps/roof-base.svg';
const CONFIG_URL = '/maps/roof-map.json';

interface LoadedMap {
	baseMarkup: string;
	config: MapConfig;
}

let loading: Promise<LoadedMap> | null = null;

/** The painted floor plan and its zones, fetched once per page. */
function loadMap(): Promise<LoadedMap> {
	loading ??= Promise.all([
		fetch(BASE_URL).then((response) => {
			if (!response.ok) throw new Error('فایل پایه نقشه بارگذاری نشد.');
			return response.text();
		}),
		fetch(CONFIG_URL).then((response) => {
			if (!response.ok) throw new Error('تنظیمات نقشه بارگذاری نشد.');
			return response.json() as Promise<MapConfig>;
		}),
	]).then(([svgText, config]) => {
		const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
		const source = parsed.documentElement;
		if (source.nodeName.toLowerCase() === 'parsererror' || parsed.querySelector('parsererror')) {
			throw new Error('ساختار فایل SVG نقشه معتبر نیست.');
		}
		// only the drawing inside the file's <svg> is used, like before
		return { baseMarkup: source.innerHTML, config };
	});
	loading.catch(() => {
		loading = null; // allow a retry on the next mount
	});
	return loading;
}

export interface FloorMapHandle {
	focusZone: (zone: string) => void;
}

interface Props {
	tables: MapTable[];
	selectedIds?: readonly string[];
	/** In "range" mode each free table shows the earliest start time above it. */
	mode?: 'exact' | 'range';
	/** Admin editor: double-click opens a table, tables can be dragged. */
	editable?: boolean;
	onTableClick?: (table: MapTable) => void;
	/** Called while dragging (live = true) and once on release (live = false) when the position changed. */
	onTableMove?: (table: MapTable, position: { x: number; y: number }, live: boolean) => void;
	onReady?: () => void;
	onError?: (error: Error) => void;
	svgProps?: SVGProps<SVGSVGElement>;
	wrapId?: string;
	wrapClassName?: string;
	zoneTabsId?: string;
	loadingId?: string;
	loadingText: string;
}

export const FloorMap = forwardRef<FloorMapHandle, Props>(function FloorMap(
	{ tables, selectedIds = [], mode = 'exact', editable = false, onTableClick, onTableMove, onReady, onError, svgProps, wrapId, wrapClassName, zoneTabsId, loadingId, loadingText },
	ref,
) {
	const svgRef = useRef<SVGSVGElement>(null);
	const viewportRef = useRef<MapViewport | null>(null);
	const [map, setMap] = useState<LoadedMap | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [activeZone, setActiveZone] = useState('ALL');
	const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
	const callbacks = useLatest({ onReady, onError, onTableClick, onTableMove });

	useEffect(() => {
		let cancelled = false;
		loadMap()
			.then((loaded) => !cancelled && setMap(loaded))
			.catch((err: Error) => {
				if (cancelled) return;
				setError(err.message);
				callbacks.current.onError?.(err);
			});
		return () => {
			cancelled = true;
		};
	}, [callbacks]);

	// once the base drawing is in the DOM, the viewport takes over the viewBox
	useEffect(() => {
		const svg = svgRef.current;
		if (!map || !svg) return;
		const viewport = new MapViewport(svg, map.config, setActiveZone);
		viewport.start();
		viewportRef.current = viewport;
		callbacks.current.onReady?.();
		return () => {
			viewport.destroy();
			viewportRef.current = null;
		};
	}, [map, callbacks]);

	useImperativeHandle(ref, () => ({ focusZone: (zone: string) => viewportRef.current?.focusZone(zone) }), []);

	const visibleTables = useMemo(
		() => (map ? tables.filter((table) => !map.config.ignoredTableCodes?.includes(table.code)) : []),
		[tables, map],
	);

	// The original map rebuilt every table whenever new tables arrived (each search result), which
	// replays their entry animation — staggered the first time only. A new key per batch does the same.
	const batch = useRef({ tables: null as MapTable[] | null, mode, count: 0 });
	if (batch.current.tables !== visibleTables || batch.current.mode !== mode) {
		batch.current = { tables: visibleTables, mode, count: batch.current.count + (visibleTables.length ? 1 : 0) };
	}
	const firstBatch = batch.current.count <= 1;

	// ─── dragging (admin editor) ───────────────────────────────────────────────
	const dragState = useRef<{
		pointerId: number;
		table: MapTable;
		start: { x: number; y: number };
		original: { x: number; y: number };
		last: { x: number; y: number };
	} | null>(null);

	const startDrag = useCallback(
		(table: MapTable) => (event: React.PointerEvent<SVGGElement>) => {
			if (event.button !== 0 || !viewportRef.current) return;
			event.preventDefault();
			event.stopPropagation();
			const start = viewportRef.current.clientToSvg(event.clientX, event.clientY);
			const original = { x: Number(table.x), y: Number(table.y) };
			dragState.current = { pointerId: event.pointerId, table, start, original, last: original };
			event.currentTarget.setPointerCapture(event.pointerId);
			const target = event.currentTarget;
			const onMove = (moveEvent: PointerEvent) => {
				const state = dragState.current;
				if (!state || state.pointerId !== moveEvent.pointerId || !viewportRef.current) return;
				const point = viewportRef.current.clientToSvg(moveEvent.clientX, moveEvent.clientY);
				const position = { x: rounded(state.original.x + point.x - state.start.x), y: rounded(state.original.y + point.y - state.start.y) };
				state.last = position;
				setDrag({ id: state.table.id, ...position });
				callbacks.current.onTableMove?.(state.table, position, true);
			};
			const onUp = (upEvent: PointerEvent) => {
				const state = dragState.current;
				if (!state || state.pointerId !== upEvent.pointerId) return;
				target.removeEventListener('pointermove', onMove);
				target.removeEventListener('pointerup', onUp);
				target.removeEventListener('pointercancel', onUp);
				if (target.hasPointerCapture(upEvent.pointerId)) target.releasePointerCapture(upEvent.pointerId);
				dragState.current = null;
				const changed = state.last.x !== state.original.x || state.last.y !== state.original.y;
				// a moved table stays where it was dropped until the parent sends the saved position
				setDrag(changed ? { id: state.table.id, ...state.last } : null);
				if (changed) callbacks.current.onTableMove?.(state.table, state.last, false);
			};
			target.addEventListener('pointermove', onMove);
			target.addEventListener('pointerup', onUp);
			target.addEventListener('pointercancel', onUp);
		},
		[callbacks],
	);

	// the parent's new table data replaces the dragged preview position
	useEffect(() => {
		setDrag((current) => (current && !dragState.current ? null : current));
	}, [tables]);

	const drawnTables = drag ? visibleTables.map((t) => (t.id === drag.id ? { ...t, x: drag.x, y: drag.y } : t)) : visibleTables;

	return (
		<>
			<div className="map-zone-tabs" id={zoneTabsId} aria-label="انتخاب سالن">
				{map &&
					Object.entries(map.config.zones || {}).map(([key, zone]) => (
						<button
							type="button"
							key={key}
							data-map-zone={key}
							className={key === activeZone ? 'active' : ''}
							aria-pressed={key === activeZone}
							onClick={() => viewportRef.current?.focusZone(key)}
						>
							{zone.label || key}
						</button>
					))}
			</div>
			<div className={`map-wrap${wrapClassName ? ` ${wrapClassName}` : ''}`} id={wrapId}>
				<svg viewBox="0 0 1800 900" role="img" {...svgProps} ref={svgRef} className={map ? 'roof-floor-map' : undefined}>
					{map && (
						<>
							<g dangerouslySetInnerHTML={{ __html: map.baseMarkup }} />
							<g id="combo-layer">
								<ComboConnectors tables={drawnTables} selectedIds={selectedIds} />
							</g>
							<g id="table-layer" key={batch.current.count}>
								{drawnTables.map((table, index) => (
									<MapTableNode
										key={table.id}
										table={table}
										stateClass={tableStateClass(table, selectedIds, editable)}
										delayMs={firstBatch ? Math.min(index * 18, 420) : 0}
										showTime={mode === 'range' && Boolean(table.availability?.available)}
										editable={editable}
										dragging={drag?.id === table.id && dragState.current !== null}
										onPointerDown={editable ? startDrag(table) : undefined}
										onActivate={(event) => {
											event.stopPropagation();
											callbacks.current.onTableClick?.(table);
										}}
									/>
								))}
							</g>
							<g id="editor-layer" />
						</>
					)}
				</svg>
				<div className="map-loading" id={loadingId} hidden={Boolean(map) && !error}>
					<span></span>
					<b>{error ? `بارگذاری نقشه با خطا مواجه شد: ${error}` : loadingText}</b>
				</div>
				<div className="map-controls" aria-label="کنترل نقشه">
					<button type="button" aria-label="بزرگ‌نمایی" onClick={() => viewportRef.current?.zoomBy(1.22)}>
						+
					</button>
					<button type="button" aria-label="کوچک‌نمایی" onClick={() => viewportRef.current?.zoomBy(1 / 1.22)}>
						−
					</button>
					<button type="button" aria-label="نمایش کامل نقشه" onClick={() => viewportRef.current?.reset()}>
						⌂
					</button>
				</div>
			</div>
		</>
	);
});

/** Curved links (with a «+» badge) between the selected tables of a combination. */
function ComboConnectors({ tables, selectedIds }: { tables: MapTable[]; selectedIds: readonly string[] }) {
	if (selectedIds.length < 2) return null;
	const selected = selectedIds.map((id) => tables.find((table) => table.id === id)).filter((t): t is MapTable => Boolean(t));
	if (selected.length < 2) return null;

	const ids = new Set(selected.map((t) => t.id));
	const edges: [MapTable, MapTable][] = [];
	// فقط بین میزهایی خط کشیده می‌شه که واقعاً به هم وصل‌ان
	for (const table of selected) {
		for (const otherId of table.connectableTableIds || []) {
			if (!ids.has(otherId) || String(table.id) > String(otherId)) continue;
			const other = selected.find((t) => t.id === otherId);
			if (other) edges.push([table, other]);
		}
	}
	// اگر اطلاعات اتصال در دسترس نبود، میزها به‌ترتیب افقی به هم وصل می‌شن
	if (!edges.length) {
		const ordered = [...selected].sort((p, q) => Number(p.x) - Number(q.x));
		for (let i = 0; i < ordered.length - 1; i += 1) edges.push([ordered[i], ordered[i + 1]]);
	}
	return (
		<>
			{edges.map(([a, b]) => {
				const midX = (Number(a.x) + Number(b.x)) / 2;
				const midY = Math.min(Number(a.y), Number(b.y)) - 45;
				return (
					<Fragment key={`${a.id}-${b.id}`}>
						<path className="combo-connector" d={`M${a.x} ${a.y}Q${midX} ${midY} ${b.x} ${b.y}`} />
						<g className="combo-badge" transform={`translate(${midX} ${midY - 3})`}>
							<circle r="16" />
							<text x="0" y="1" textAnchor="middle" dominantBaseline="middle">
								+
							</text>
						</g>
					</Fragment>
				);
			})}
		</>
	);
}
