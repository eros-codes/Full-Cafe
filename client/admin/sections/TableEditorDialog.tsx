import { useEffect, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { errorText } from '../../shared/api';
import type { ChairPosition, MapTable, ZoneKey, TableShape } from '../../reserve/map/types';
import { adminApi } from '../common/adminApi';
import { SHAPE_FA, ZONE_FA } from '../common/ui';

// Create / edit one table: zone, shape, numbers, rotation, the chair layout (drag chairs on the small
// canvas) and which tables it can be joined with. The table's place on the floor is set by dragging it
// on the main map instead.

const CHAIR_TYPE_FA = { normal: 'صندلی معمولی', shared: 'مشترک با مبل / نیمکت' };
const DIAL_R = 40;

interface Chair extends ChairPosition {
	id: string;
	type: 'normal' | 'shared';
}

interface Connection {
	id: string;
	tableAId: string;
	tableBId: string;
}

let nextChairId = 1;

const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;

// زاویه با قرارداد ساعت: صفر درجه = بالا، مثبت = جهت عقربه‌ها
function angleToPoint(angle: number, radius: number) {
	const rad = (angle * Math.PI) / 180;
	return { x: 50 + radius * Math.sin(rad), y: 50 - radius * Math.cos(rad) };
}

function pointToAngle(x: number, y: number) {
	return normalizeAngle((Math.atan2(x - 50, -(y - 50)) * 180) / Math.PI);
}

function shapeDims(shape: string) {
	return shape === 'RECTANGLE' ? { width: 96, height: 60 } : { width: 70, height: 70 };
}

function defaultChair(index: number, total: number): Chair {
	const angle = (index / Math.max(total, 1)) * Math.PI * 2 - Math.PI / 2;
	return {
		id: `c${nextChairId++}`,
		x: Math.round(Math.cos(angle) * 60),
		y: Math.round(Math.sin(angle) * 60),
		angle: Math.round((angle * 180) / Math.PI + 90),
		type: 'normal',
	};
}

/** A small clock-face joystick for an angle; the hand follows the pointer. */
function RotationDial({ angle, onChange }: { angle: number; onChange: (angle: number) => void }) {
	const ref = useRef<SVGSVGElement>(null);
	const dragging = useRef(false);
	const hand = angleToPoint(angle, DIAL_R);
	const setFromClient = (clientX: number, clientY: number) => {
		const rect = ref.current?.getBoundingClientRect();
		if (!rect) return;
		onChange(Math.round(pointToAngle(((clientX - rect.left) / rect.width) * 100, ((clientY - rect.top) / rect.height) * 100)));
	};
	const ticks = [];
	for (let a = 0; a < 360; a += 45) {
		const inner = angleToPoint(a, DIAL_R - 5);
		const outer = angleToPoint(a, DIAL_R + 5);
		ticks.push(<line key={a} x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="rotation-dial-tick" />);
	}
	return (
		<svg
			ref={ref}
			className="rotation-dial"
			viewBox="0 0 100 100"
			onPointerDown={(event) => {
				dragging.current = true;
				event.currentTarget.setPointerCapture(event.pointerId);
				setFromClient(event.clientX, event.clientY);
			}}
			onPointerMove={(event) => dragging.current && setFromClient(event.clientX, event.clientY)}
			onPointerUp={() => (dragging.current = false)}
			onPointerCancel={() => (dragging.current = false)}
		>
			<circle className="rotation-dial-track" cx="50" cy="50" r={DIAL_R} />
			<g className="rotation-dial-ticks">{ticks}</g>
			<line x1="50" y1="50" x2={hand.x} y2={hand.y} className="rotation-dial-hand" />
			<circle cx={hand.x} cy={hand.y} r="7" className="rotation-dial-handle" />
			<circle cx="50" cy="50" r="3" className="rotation-dial-center" />
		</svg>
	);
}

interface Props {
	/** null = closed. */
	target: { mode: 'create'; zone: ZoneKey } | { mode: 'edit'; table: MapTable } | null;
	allTables: MapTable[];
	onClose: () => void;
	onSaved: (tableId: string | null) => Promise<void> | void;
	onDeleted: () => Promise<void> | void;
}

export function TableEditorDialog({ target, allTables, onClose, onSaved, onDeleted }: Props) {
	return (
		<div
			className={`modal${target ? ' open' : ''}`}
			onClick={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			<div className="modal-content table-editor-dialog">
				{target && <EditorForm key={target.mode === 'edit' ? target.table.id : 'new'} target={target} allTables={allTables} onClose={onClose} onSaved={onSaved} onDeleted={onDeleted} />}
			</div>
		</div>
	);
}

function EditorForm({ target, allTables, onClose, onSaved, onDeleted }: Props & { target: NonNullable<Props['target']> }) {
	const editing = target.mode === 'edit' ? target.table : null;
	const [zone, setZone] = useState<ZoneKey>(editing?.zone ?? (target.mode === 'create' ? target.zone : 'WINDOW'));
	const [shape, setShape] = useState<TableShape>(editing?.shape ?? 'SQUARE');
	const [displayNumber, setDisplayNumber] = useState(editing?.displayNumber ?? '');
	const [isActive, setIsActive] = useState(editing?.isActive !== false);
	const [description, setDescription] = useState(editing?.description ?? '');
	const [minGuests, setMinGuests] = useState(String(editing?.minGuests || 1));
	const [chairs, setChairs] = useState<Chair[]>(() =>
		Array.isArray(editing?.chairs) && editing.chairs.length ? editing.chairs.map((c) => ({ ...c, id: `c${nextChairId++}`, type: c.type === 'shared' ? 'shared' : 'normal' })) : [],
	);
	const [maxGuests, setMaxGuests] = useState(String(editing?.maxGuests || editing?.capacity || 1));
	const [rotation, setRotation] = useState(String(normalizeAngle(editing?.rotation || 0)));
	const [selectedChairId, setSelectedChairId] = useState<string | null>(null);
	const [notice, setNotice] = useState<{ text: string; confirmDelete?: boolean } | null>(null);
	const [saving, setSaving] = useState(false);
	const canvasRef = useRef<SVGSVGElement>(null);
	const dragChairId = useRef<string | null>(null);

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') onClose();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [onClose]);

	const rotationValue = Number(rotation) || 0;
	const dims = shapeDims(shape);
	const selectedChair = chairs.find((c) => c.id === selectedChairId) ?? null;
	const updateChair = (id: string, patch: Partial<Chair>) => setChairs((list) => list.map((c) => (c.id === id ? { ...c, ...patch } : c)));

	const addChair = () => {
		const chair = defaultChair(chairs.length, chairs.length + 1);
		setChairs((list) => [...list, chair]);
		setSelectedChairId(chair.id);
	};

	const removeChair = (id: string) => {
		setChairs((list) => list.filter((c) => c.id !== id));
		if (selectedChairId === id) setSelectedChairId(null);
	};

	/** Pointer position on the small canvas, in the table's own (unrotated) coordinates. */
	const canvasPoint = (clientX: number, clientY: number) => {
		const svg = canvasRef.current;
		if (!svg) return { x: 0, y: 0 };
		const rect = svg.getBoundingClientRect();
		const vb = svg.viewBox.baseVal;
		const x = Math.round(vb.x + ((clientX - rect.left) / rect.width) * vb.width);
		const y = Math.round(vb.y + ((clientY - rect.top) / rect.height) * vb.height);
		const rad = (-rotationValue * Math.PI) / 180;
		return { x: Math.round(x * Math.cos(rad) - y * Math.sin(rad)), y: Math.round(x * Math.sin(rad) + y * Math.cos(rad)) };
	};

	const save = async (event: FormEvent) => {
		event.preventDefault();
		if (!chairs.length) return setNotice({ text: 'حداقل یک صندلی لازمه.' });
		if (editing && !displayNumber.trim()) return setNotice({ text: 'شماره‌ی نمایشی میز نمی‌تونه خالی باشه.' });
		const body = {
			zone,
			shape,
			// خالی بذاری، سرور از روی کد میز شماره می‌سازه
			displayNumber: displayNumber.trim() || undefined,
			isActive,
			description: description.trim() || null,
			minGuests: Number(minGuests) || 1,
			maxGuests: Number(maxGuests) || chairs.length,
			rotation: rotationValue,
			capacity: chairs.length,
			chairs: chairs.map(({ id: _id, ...rest }) => rest),
		};
		if (!Number.isInteger(body.minGuests) || body.minGuests < 1 || !Number.isInteger(body.maxGuests) || body.maxGuests < 1) {
			return setNotice({ text: 'حداقل و حداکثر نفرات باید عددی صحیح و بزرگ‌تر از صفر باشن.' });
		}
		if (body.minGuests > body.maxGuests) return setNotice({ text: 'حداقل نفرات نمی‌تونه از حداکثر بیشتر باشه.' });
		if (body.maxGuests > body.capacity) return setNotice({ text: `حداکثر نفرات نمی‌تونه از تعداد صندلی‌ها (${body.capacity}) بیشتر باشه.` });
		setSaving(true);
		try {
			if (!editing) {
				// برای اینکه میزهای جدید روی هم نیفتن، هر بار کمی جابه‌جا ساخته می‌شن
				const offset = (allTables.length % 6) * 70;
				const { table } = await adminApi<{ table: MapTable }>('/api/admin/tables', {
					method: 'POST',
					body: { ...body, x: 300 + offset, y: 300 + offset, ...shapeDims(body.shape) },
				});
				await onSaved(table?.id ?? null);
			} else {
				// اگر شکل عوض شده، ابعاد هم باید با شکل جدید هماهنگ بشه
				const shapeChanged = editing.shape !== body.shape;
				await adminApi(`/api/admin/tables/${editing.id}`, { method: 'PATCH', body: shapeChanged ? { ...body, ...shapeDims(body.shape) } : body });
				await onSaved(editing.id);
			}
			onClose();
		} catch (error) {
			setNotice({ text: errorText(error) });
		} finally {
			setSaving(false);
		}
	};

	const performDelete = async () => {
		if (!editing) return;
		try {
			await adminApi(`/api/admin/tables/${editing.id}`, { method: 'DELETE' });
			await onDeleted();
			onClose();
		} catch (error) {
			setNotice({ text: errorText(error) });
		}
	};

	const chairDown = (chair: Chair) => (event: ReactPointerEvent<SVGGElement>) => {
		event.stopPropagation();
		setSelectedChairId(chair.id);
		dragChairId.current = chair.id;
		canvasRef.current?.setPointerCapture(event.pointerId);
	};

	return (
		<form className="form-grid" onSubmit={save}>
			<div className="dialog-head">
				<strong>{editing ? `ویرایش میز ${editing.displayNumber || ''}` : 'افزودن میز جدید'}</strong>
				<button type="button" className="ghost-btn" onClick={onClose}>
					بستن
				</button>
			</div>
			<div className="row">
				<div className="field">
					<label>سالن</label>
					<select data-field="zone" value={zone} onChange={(e) => setZone(e.target.value as ZoneKey)}>
						{Object.entries(ZONE_FA).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</div>
				<div className="field">
					<label>شکل میز</label>
					<select data-field="shape" value={shape} onChange={(e) => setShape(e.target.value as TableShape)}>
						{Object.entries(SHAPE_FA).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				</div>
			</div>
			<div className="row">
				<div className="field">
					<label>شماره نمایشی (خالی = خودکار)</label>
					<input data-field="displayNumber" placeholder="خالی = خودکار" value={displayNumber} onChange={(e) => setDisplayNumber(e.target.value)} />
				</div>
				<div className="field">
					<label>وضعیت</label>
					<select data-field="isActive" value={String(isActive)} onChange={(e) => setIsActive(e.target.value === 'true')}>
						<option value="true">فعال</option>
						<option value="false">غیرفعال</option>
					</select>
				</div>
			</div>
			<div className="field">
				<label>توضیح / کپشن</label>
				<textarea data-field="description" rows={2} value={description} onChange={(e) => setDescription(e.target.value)}></textarea>
			</div>
			<div className="row">
				<div className="field">
					<label>حداقل نفر رزرو</label>
					<input data-field="minGuests" type="number" min="1" value={minGuests} onChange={(e) => setMinGuests(e.target.value)} />
				</div>
				<div className="field">
					<label>حداکثر نفر رزرو</label>
					<input data-field="maxGuests" type="number" min="1" value={maxGuests} onChange={(e) => setMaxGuests(e.target.value)} />
				</div>
			</div>
			<div className="field rotation-field">
				<label>چرخش میز</label>
				<div className="rotation-field-row">
					<RotationDial angle={normalizeAngle(rotationValue)} onChange={(angle) => setRotation(String(angle))} />
					<input data-field="rotation" type="number" step="1" value={rotation} onChange={(e) => setRotation(e.target.value)} />
				</div>
			</div>
			<hr className="dialog-divider" />
			<div className="chair-editor">
				<div className="chair-canvas-wrap">
					<svg
						ref={canvasRef}
						viewBox="-120 -120 240 240"
						className="chair-mini-canvas"
						onPointerMove={(event) => {
							const id = dragChairId.current;
							if (!id) return;
							const point = canvasPoint(event.clientX, event.clientY);
							updateChair(id, point);
						}}
						onPointerUp={() => (dragChairId.current = null)}
						onPointerLeave={() => (dragChairId.current = null)}
					>
						<g transform={`rotate(${rotationValue})`} className="chair-rotation-group">
							{shape === 'ROUND' ? (
								<ellipse cx="0" cy="0" rx={dims.width / 2} ry={dims.height / 2} className="mini-table-shape" />
							) : (
								<rect x={-dims.width / 2} y={-dims.height / 2} width={dims.width} height={dims.height} rx={shape === 'SQUARE' ? 8 : 10} className="mini-table-shape" />
							)}
							{chairs.map((chair) => (
								<g
									key={chair.id}
									className={`mini-chair ${chair.type === 'shared' ? 'mini-chair--shared' : ''} ${chair.id === selectedChairId ? 'is-selected' : ''}`}
									transform={`translate(${chair.x} ${chair.y}) rotate(${chair.angle || 0})`}
									data-chair-id={chair.id}
									onPointerDown={chairDown(chair)}
								>
									{chair.type === 'shared' ? (
										<circle r="7" className="shared-dot" />
									) : (
										<>
											<rect x="-11" y="-8" width="22" height="17" rx="7" className="mini-chair-seat" />
											<path d="M-10-6Q0-14 10-6" className="mini-chair-back" />
										</>
									)}
								</g>
							))}
						</g>
					</svg>
				</div>
				<div className="chair-side">
					<p data-capacity-readout="" className="dialog-hint">
						{`تعداد صندلی چیده‌شده: ${chairs.length.toLocaleString('fa-IR')} (این فقط راهنماست؛ حداقل/حداکثر نفر رزرو رو خودت بالا تعیین می‌کنی)`}
					</p>
					<button type="button" className="secondary-btn" onClick={addChair}>
						+ افزودن صندلی
					</button>
					<div data-chair-inspector="">
						{selectedChair ? (
							<>
								<div className="row">
									<div className="field">
										<label>نوع صندلی</label>
										<select data-chair-type="" value={selectedChair.type} onChange={(e) => updateChair(selectedChair.id, { type: e.target.value as Chair['type'] })}>
											{Object.entries(CHAIR_TYPE_FA).map(([value, label]) => (
												<option key={value} value={value}>
													{label}
												</option>
											))}
										</select>
									</div>
									<div className="field rotation-field rotation-field--chair">
										<label>زاویه صندلی</label>
										<div className="rotation-field-row">
											<RotationDial
												angle={normalizeAngle(selectedChair.angle || 0)}
												// به نزدیک‌ترین مضرب ۵ گرد می‌شه تا با گام فیلد عددی یکی باشه
												onChange={(angle) => updateChair(selectedChair.id, { angle: normalizeAngle(Math.round(angle / 5) * 5) })}
											/>
											<input
												type="number"
												step="5"
												value={normalizeAngle(selectedChair.angle || 0)}
												onChange={(e) => updateChair(selectedChair.id, { angle: normalizeAngle(Number(e.target.value) || 0) })}
											/>
										</div>
									</div>
								</div>
								<button type="button" className="danger-btn" onClick={() => removeChair(selectedChair.id)}>
									حذف همین صندلی
								</button>
							</>
						) : (
							<p className="dialog-hint">یه صندلی رو نقشه‌ی کوچیک انتخاب کن، یا از دکمه‌ی زیر یکی اضافه کن.</p>
						)}
					</div>
				</div>
			</div>
			<hr className="dialog-divider" />
			<h5>میزهای قابل اتصال</h5>
			<div data-connections-host="">
				{editing ? <Connections table={editing} /> : <p className="dialog-hint">اتصال میزها بعد از ذخیره‌ی اولیه، از همین دیالوگ قابل تنظیمه.</p>}
			</div>
			<div data-dialog-notice="" className={notice ? 'notice danger' : undefined}>
				{notice?.confirmDelete ? (
					<>
						<span>{`میز ${editing?.displayNumber || ''} برای همیشه حذف بشه؟ این کار برگشت‌پذیر نیست.`}</span>
						<button type="button" className="danger-btn" onClick={performDelete}>
							بله، حذف کن
						</button>
						<button type="button" className="ghost-btn" onClick={() => setNotice(null)}>
							انصراف
						</button>
					</>
				) : (
					notice?.text
				)}
			</div>
			<div className="actions">
				{editing && (
					<button type="button" className="danger-btn" onClick={() => setNotice({ text: '', confirmDelete: true })}>
						حذف میز
					</button>
				)}
				<button type="submit" className="primary-btn" disabled={saving}>
					ذخیره میز
				</button>
			</div>
		</form>
	);
}

/** Tables this one can be joined with (always read fresh from the server). */
function Connections({ table }: { table: MapTable }) {
	const [data, setData] = useState<{ tables: MapTable[]; connections: Connection[] } | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [pick, setPick] = useState('');
	const [version, setVersion] = useState(0);

	useEffect(() => {
		let current = true;
		adminApi<{ tables: MapTable[]; connections: Connection[] }>('/api/admin/tables')
			.then((d) => {
				if (!current) return;
				setData(d);
				setError(null);
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [version]);

	if (!data) return error ? <div className="notice danger">{error}</div> : null;

	const related = data.connections.filter((c) => c.tableAId === table.id || c.tableBId === table.id);
	const connectedIds = new Set(related.map((c) => (c.tableAId === table.id ? c.tableBId : c.tableAId)));
	const others = data.tables.filter((t) => t.id !== table.id && !connectedIds.has(t.id));
	const selectedOther = others.some((t) => t.id === pick) ? pick : (others[0]?.id ?? '');

	const run = async (action: () => Promise<unknown>) => {
		try {
			await action();
			setError(null);
			setVersion((v) => v + 1);
		} catch (err) {
			setError(errorText(err));
		}
	};

	return (
		<>
			{error && <div className="notice danger">{error}</div>}
			<div className="connection-list">
				{related.map((c) => {
					const otherId = c.tableAId === table.id ? c.tableBId : c.tableAId;
					const other = data.tables.find((t) => t.id === otherId);
					return (
						<span className="connection-chip" key={c.id}>
							{`میز ${other?.displayNumber || '?'}`}
							<button type="button" onClick={() => run(() => adminApi(`/api/admin/table-connections/${c.id}`, { method: 'DELETE' }))}>
								×
							</button>
						</span>
					);
				})}
			</div>
			<div className="connection-add">
				<select data-connection-pick="" value={selectedOther} onChange={(e) => setPick(e.target.value)}>
					{others.length ? (
						others.map((t) => (
							<option key={t.id} value={t.id}>
								{`${t.code} · میز ${t.displayNumber}`}
							</option>
						))
					) : (
						<option value="">میز دیگری باقی نمانده</option>
					)}
				</select>
				<button
					type="button"
					className="secondary-btn"
					onClick={() =>
						selectedOther &&
						run(() => adminApi('/api/admin/table-connections', { method: 'POST', body: { tableAId: table.id, tableBId: selectedOther } }))
					}
				>
					افزودن اتصال
				</button>
			</div>
		</>
	);
}
