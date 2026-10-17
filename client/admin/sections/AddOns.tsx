import { useEffect, useState, type FormEvent } from 'react';
import { errorText } from '../../shared/api';
import { toman } from '../../shared/format';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash, type AddOnRow } from './menu-common';

const NAME_MAX = 80;

const fetchAddOns = () => adminApi<{ addOns: AddOnRow[] }>('/api/admin/addons').then((r) => r.addOns);

const addOnPriceLabel = (price: number) => (price > 0 ? toman(price) : 'رایگان');

/** «12000» → 12000; empty, negative or fractional → null. Zero is allowed (e.g. "no onion"). */
function readPrice(value: string): number | null {
	if (value.trim() === '') return null;
	const n = Number(value);
	return Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * The shared add-on library (extra shot, oat milk, …). Each add-on is made once and attached to any number of
 * products from the product form. Inactive add-ons stay attached but are hidden on the menu. Reloaded on every visit.
 */
export function AddOns({ visit }: { visit: number }) {
	const [rows, setRows] = useState<AddOnRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [price, setPrice] = useState('');
	const [busyId, setBusyId] = useState<number | 'new' | null>(null);
	const [editing, setEditing] = useState<AddOnRow | null>(null);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		setRows(null);
		setError(null);
		fetchAddOns()
			.then((list) => current && setRows(list))
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit]);

	if (error && !rows) return <div id="addOnsBox"><ErrorNotice message={error} /></div>;
	if (!rows) return <div id="addOnsBox"><Skeleton height={180} /></div>;

	const refresh = () =>
		fetchAddOns()
			.then(setRows)
			.catch((err) => show(errorText(err)));

	const run = async (id: number | 'new', action: () => Promise<unknown>, success: string) => {
		setBusyId(id);
		try {
			await action();
			show(success, 'ok');
			await refresh();
		} catch (err) {
			show(errorText(err));
		} finally {
			setBusyId(null);
		}
	};

	const create = async (event: FormEvent) => {
		event.preventDefault();
		const clean = name.trim();
		const amount = readPrice(price);
		if (!clean) return show('نام افزودنی را وارد کن.');
		if (amount === null) return show('قیمت باید عدد صحیح صفر یا مثبت باشد (صفر = رایگان).');
		await run(
			'new',
			async () => {
				await adminApi('/api/admin/addons', { method: 'POST', body: { name: clean, price: amount } });
				setName('');
				setPrice('');
			},
			`«${clean}» اضافه شد؛ از فرم هر محصول می‌توانی وصلش کنی.`,
		);
	};

	const toggle = (row: AddOnRow) =>
		run(
			row.id,
			() => adminApi(`/api/admin/addons/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } }),
			row.isActive ? `«${row.name}» غیرفعال شد و در منو دیده نمی‌شود.` : `«${row.name}» فعال شد.`,
		);

	const remove = (row: AddOnRow) => {
		const count = row._count?.products ?? 0;
		const question = count
			? `«${row.name}» به ${fa(count)} محصول وصل است و با حذف، از همه‌ی آن‌ها هم برداشته می‌شود. ادامه می‌دهی؟`
			: `افزودنی «${row.name}» حذف شود؟`;
		if (!window.confirm(question)) return;
		void run(row.id, () => adminApi(`/api/admin/addons/${row.id}${count ? '?force=1' : ''}`, { method: 'DELETE' }), 'افزودنی حذف شد.');
	};

	return (
		<div id="addOnsBox">
			<MenuFlash flash={flash} />
			<form className="card card-pad menu-inline-form" noValidate onSubmit={create}>
				<h4>افزودن افزودنی</h4>
				<div className="row">
					<div className="field">
						<label htmlFor="aoName">نام افزودنی</label>
						<input id="aoName" name="name" maxLength={NAME_MAX} placeholder="مثلاً شات اسپرسو اضافه" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="aoPrice">قیمت اضافه (تومان · صفر = رایگان)</label>
						<input id="aoPrice" name="price" type="number" inputMode="numeric" min="0" step="1000" dir="ltr" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
					</div>
				</div>
				<button type="submit" className="primary-btn" disabled={busyId === 'new'}>
					{ICONS.plus}
					<span>افزودن</span>
				</button>
			</form>
			{rows.length ? (
				<div className="table-scroll">
					<table className="table-list">
						<thead>
							<tr>
								<th>نام</th>
								<th>قیمت اضافه</th>
								<th>محصولات</th>
								<th>وضعیت</th>
								<th>عملیات</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row) => (
								<tr key={row.id}>
									<td>
										<strong>{row.name}</strong>
									</td>
									<td className="menu-nowrap">{addOnPriceLabel(row.price)}</td>
									<td>{fa(row._count?.products)}</td>
									<td>
										<span className={`status ${row.isActive ? 'CONFIRMED' : 'CANCELLED'}`}>{row.isActive ? 'فعال' : 'غیرفعال'}</span>
									</td>
									<td className="table-actions-cell">
										<button type="button" className="secondary-btn" disabled={busyId === row.id} onClick={() => setEditing(row)}>
											ویرایش
										</button>
										<button type="button" className="secondary-btn" disabled={busyId === row.id} onClick={() => toggle(row)}>
											{row.isActive ? 'غیرفعال' : 'فعال'}
										</button>
										<button type="button" className="danger-btn" disabled={busyId === row.id} onClick={() => remove(row)}>
											حذف
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<EmptyState title="هنوز افزودنی‌ای نیست" text="با فرم بالا اولین افزودنی (مثلاً شیر گیاهی) را بساز." />
			)}
			{editing && (
				<AddOnForm
					row={editing}
					onClose={() => setEditing(null)}
					onSaved={() => {
						show('افزودنی ویرایش شد.', 'ok');
						void refresh();
					}}
				/>
			)}
		</div>
	);
}

function AddOnForm({ row, onClose, onSaved }: { row: AddOnRow; onClose: () => void; onSaved: () => void }) {
	const [name, setName] = useState(row.name);
	const [price, setPrice] = useState(String(row.price));
	return (
		<MenuModal
			title="ویرایش افزودنی"
			onClose={onClose}
			onSubmit={async () => {
				const amount = readPrice(price);
				if (!name.trim()) throw new Error('نام افزودنی الزامی است.');
				if (amount === null) throw new Error('قیمت باید عدد صحیح صفر یا مثبت باشد (صفر = رایگان).');
				await adminApi(`/api/admin/addons/${row.id}`, { method: 'PATCH', body: { name: name.trim(), price: amount } });
				onSaved();
			}}
		>
			<div className="field">
				<label htmlFor="eaoName">نام افزودنی</label>
				<input id="eaoName" name="name" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
			</div>
			<div className="field">
				<label htmlFor="eaoPrice">قیمت اضافه (تومان · صفر = رایگان)</label>
				<input id="eaoPrice" name="price" type="number" inputMode="numeric" min="0" step="1000" dir="ltr" placeholder="0" value={price} onChange={(e) => setPrice(e.target.value)} />
			</div>
		</MenuModal>
	);
}
