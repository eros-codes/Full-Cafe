import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../shared/api';
import { FloorMap, type FloorMapHandle } from '../../reserve/map/FloorMap';
import type { MapTable, ZoneKey } from '../../reserve/map/types';
import { adminApi } from '../common/adminApi';
import { SHAPE_FA, ZONE_FA, fa } from '../common/ui';

export type TableDialogTarget = { mode: 'create'; zone: ZoneKey } | { mode: 'edit'; table: MapTable } | null;

interface Props {
	tables: MapTable[];
	canEditMap: boolean;
	canToggleTables: boolean;
	reload: () => Promise<void>;
	/** The edit dialog lives at the end of the page (see AdminApp), like the original overlay. */
	openDialog: (target: TableDialogTarget) => void;
}

/** The floor-map editor (developer only) and the table list (activate / deactivate). */
export function Tables({ tables, canEditMap, canToggleTables, reload, openDialog }: Props) {
	const mapRef = useRef<FloorMapHandle>(null);
	const [mapNotice, setMapNotice] = useState<{ type: string; text: string } | null>(null);
	const [listError, setListError] = useState<string | null>(null);

	useEffect(() => {
		if (!mapNotice || mapNotice.type === 'danger') return;
		const timer = window.setTimeout(() => setMapNotice(null), 2200);
		return () => window.clearTimeout(timer);
	}, [mapNotice]);

	const moveTable = async (table: MapTable, position: { x: number; y: number }, live: boolean) => {
		if (live || !canEditMap) return;
		try {
			await adminApi(`/api/admin/tables/${table.id}`, { method: 'PATCH', body: position });
			setMapNotice({ type: 'ok', text: 'جای میز ذخیره شد.' });
		} catch (error) {
			setMapNotice({ type: 'danger', text: errorText(error) });
			await reload();
		}
	};

	const toggle = async (table: MapTable) => {
		try {
			await adminApi(`/api/admin/tables/${table.id}`, { method: 'PATCH', body: { isActive: !table.isActive } });
			setListError(null);
			await reload();
		} catch (error) {
			setListError(errorText(error));
		}
	};

	return (
		<>
			<div id="adminMapEditor" className="admin-map-editor">
				<section className="admin-map-canvas">
					<FloorMap
						ref={mapRef}
						tables={tables}
						editable={canEditMap}
						onTableClick={(table) => canEditMap && openDialog({ mode: 'edit', table })}
						onTableMove={moveTable}
						svgProps={{ 'data-editor-map': '', 'aria-label': 'ویرایش نقشه میزهای کافه' } as React.SVGProps<SVGSVGElement>}
						wrapClassName="admin-map-wrap"
						loadingText="در حال آماده‌سازی ویرایشگر..."
					/>
					<p className="editor-help">
						{canEditMap
							? 'روی میز دابل‌کلیک کن تا ویرایش/حذفش کنی؛ برای جابه‌جایی بگیر و بکش — همون لحظه‌ی رهاکردن ذخیره می‌شه.'
							: 'نقشه فقط در حالت مشاهده است؛ حساب شما اجازه‌ی تغییر میزها را ندارد.'}
					</p>
					<div data-editor-notice="" className={mapNotice ? `notice ${mapNotice.type}` : undefined}>
						{mapNotice?.text}
					</div>
				</section>
			</div>
			<div className="admin-table-list-head">
				<h4>فهرست میزها</h4>
				<span id="tableCount">{`${fa(tables.length)} میز`}</span>
				<button type="button" id="addTableBtn" className="primary-btn" hidden={!canEditMap} onClick={() => canEditMap && openDialog({ mode: 'create', zone: 'WINDOW' })}>
					+ افزودن میز
				</button>
			</div>
			<div id="tableBox">
				<div id="tableListNotice" className={listError ? 'notice danger' : undefined}>
					{listError}
				</div>
				<div className="table-scroll">
					<table className="table-list">
						<thead>
							<tr>
								<th>کد</th>
								<th>شماره</th>
								<th>سالن</th>
								<th>شکل</th>
								<th>ظرفیت</th>
								<th>حداقل/حداکثر</th>
								<th>وضعیت</th>
								<th>عملیات</th>
							</tr>
						</thead>
						<tbody>
							{tables.map((table) => (
								<tr key={table.id}>
									<td>{table.code}</td>
									<td>{table.displayNumber}</td>
									<td>{ZONE_FA[table.zone] || table.zone}</td>
									<td>{SHAPE_FA[table.shape] || table.shape}</td>
									<td>{fa(table.capacity)}</td>
									<td>{`${fa(table.minGuests)} / ${fa(table.maxGuests)}`}</td>
									<td>
										<span className={`status ${table.isActive ? 'CONFIRMED' : 'CANCELLED'}`}>{table.isActive ? 'فعال' : 'غیرفعال'}</span>
									</td>
									<td className="table-actions-cell">
										{canEditMap && (
											<button
												type="button"
												className="secondary-btn"
												onClick={() => {
													openDialog({ mode: 'edit', table });
													document.getElementById('adminMapEditor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
												}}
											>
												ویرایش
											</button>
										)}
										{canToggleTables && (
											<button type="button" className="secondary-btn" onClick={() => toggle(table)}>
												{table.isActive ? 'غیرفعال' : 'فعال'}
											</button>
										)}
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			</div>
		</>
	);
}
