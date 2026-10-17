import { useEffect, useState, type FormEvent } from 'react';
import { errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash, type MenuTypeRow } from './menu-common';

const NAME_MAX = 40;

const fetchMenuTypes = () => adminApi<{ menuTypes: MenuTypeRow[] }>('/api/admin/menu-types').then((r) => r.menuTypes);

/**
 * The menu's main types — the tabs at the top of the menu page (café, breakfast, restaurant, hookah, …).
 * Manager only. The order here is the order of the tabs. Reloaded on every visit.
 */
export function MenuTypes({ visit }: { visit: number }) {
	const [rows, setRows] = useState<MenuTypeRow[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState<MenuTypeRow | null>(null);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		setRows(null);
		setError(null);
		fetchMenuTypes()
			.then((list) => current && setRows(list))
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit]);

	if (error && !rows) return <div id="menuTypesBox"><ErrorNotice message={error} /></div>;
	if (!rows) return <div id="menuTypesBox"><Skeleton height={180} /></div>;

	/** Runs one change, then reads the list again (the counts and order come from the server). */
	const run = async (action: () => Promise<unknown>, success: string) => {
		setBusy(true);
		try {
			await action();
			show(success, 'ok');
		} catch (err) {
			show(errorText(err));
		}
		try {
			setRows(await fetchMenuTypes());
		} catch (err) {
			show(errorText(err));
		} finally {
			setBusy(false);
		}
	};

	const create = async (event: FormEvent) => {
		event.preventDefault();
		const clean = name.trim();
		if (!clean) return show('نام دسته‌ی اصلی را وارد کن.');
		await run(async () => {
			await adminApi('/api/admin/menu-types', { method: 'POST', body: { name: clean } });
			setName('');
		}, `«${clean}» اضافه شد؛ حالا از بخش «دسته‌بندی منو» برایش دسته بساز.`);
	};

	const move = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= rows.length) return;
		const next = rows.slice();
		[next[index], next[target]] = [next[target], next[index]];
		// جابه‌جایی همان لحظه دیده می‌شود؛ اگر ذخیره نشد، فهرست دوباره از سرور خوانده می‌شود
		setRows(next);
		void run(() => adminApi('/api/admin/menu-types/order', { method: 'PUT', body: { ids: next.map((t) => t.id) } }), 'ترتیب تب‌ها ذخیره شد.');
	};

	const toggle = (row: MenuTypeRow) =>
		run(
			() => adminApi(`/api/admin/menu-types/${row.id}`, { method: 'PATCH', body: { isActive: !row.isActive } }),
			row.isActive ? `«${row.name}» از منوی سایت مخفی شد.` : `«${row.name}» در منوی سایت نمایش داده می‌شود.`,
		);

	const remove = (row: MenuTypeRow) => {
		const count = row._count?.categories ?? 0;
		// سرور هم دسته‌ی اصلیِ دارای دسته‌بندی را حذف نمی‌کند؛ این‌جا فقط زودتر و واضح‌تر گفته می‌شود
		if (count) {
			show(`«${row.name}» ${fa(count)} دسته‌بندی دارد؛ اول آن‌ها را از بخش «دسته‌بندی منو» به دسته‌ی اصلی دیگری منتقل یا حذف کن.`);
			return;
		}
		if (!window.confirm(`دسته‌ی اصلی «${row.name}» حذف شود؟`)) return;
		void run(() => adminApi(`/api/admin/menu-types/${row.id}`, { method: 'DELETE' }), 'دسته‌ی اصلی حذف شد.');
	};

	return (
		<div id="menuTypesBox">
			<MenuFlash flash={flash} />
			<form className="card card-pad menu-inline-form" noValidate onSubmit={create}>
				<h4>افزودن دسته‌ی اصلی</h4>
				<div className="row">
					<div className="field">
						<label htmlFor="mtName">نام</label>
						<input id="mtName" name="name" maxLength={NAME_MAX} placeholder="مثلاً قلیان" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
				</div>
				<button type="submit" className="primary-btn" disabled={busy}>
					{ICONS.plus}
					<span>افزودن دسته‌ی اصلی</span>
				</button>
			</form>
			{rows.length ? (
				<div className="table-scroll">
					<table className="table-list">
						<thead>
							<tr>
								<th>ترتیب</th>
								<th>نام</th>
								<th>دسته‌بندی‌ها</th>
								<th>وضعیت</th>
								<th>عملیات</th>
							</tr>
						</thead>
						<tbody>
							{rows.map((row, index) => (
								<tr key={row.id}>
									<td>
										<div className="menu-order-btns">
											<button type="button" className="menu-order-btn" aria-label={`«${row.name}» یکی بالاتر`} disabled={busy || index === 0} onClick={() => move(index, -1)}>
												{ICONS.up}
											</button>
											<button
												type="button"
												className="menu-order-btn"
												aria-label={`«${row.name}» یکی پایین‌تر`}
												disabled={busy || index === rows.length - 1}
												onClick={() => move(index, 1)}
											>
												{ICONS.down}
											</button>
										</div>
									</td>
									<td>
										<strong>{row.name}</strong>
									</td>
									<td>{fa(row._count?.categories)}</td>
									<td>
										<span className={`status ${row.isActive ? 'CONFIRMED' : 'CANCELLED'}`}>{row.isActive ? 'نمایش در منو' : 'مخفی'}</span>
									</td>
									<td className="table-actions-cell">
										<button type="button" className="secondary-btn" disabled={busy} onClick={() => setEditing(row)}>
											تغییر نام
										</button>
										<button type="button" className="secondary-btn" disabled={busy} onClick={() => toggle(row)}>
											{row.isActive ? 'مخفی کن' : 'نمایش بده'}
										</button>
										<button type="button" className="danger-btn" disabled={busy} onClick={() => remove(row)}>
											حذف
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<EmptyState title="هنوز دسته‌ی اصلی‌ای نیست" text="با فرم بالا اولین تب منو (مثلاً کافه) را بساز." />
			)}
			{editing && (
				<RenameForm
					row={editing}
					onClose={() => setEditing(null)}
					onSaved={() => {
						show('نام دسته‌ی اصلی تغییر کرد.', 'ok');
						fetchMenuTypes()
							.then(setRows)
							.catch((err) => show(errorText(err)));
					}}
				/>
			)}
		</div>
	);
}

function RenameForm({ row, onClose, onSaved }: { row: MenuTypeRow; onClose: () => void; onSaved: () => void }) {
	const [name, setName] = useState(row.name);
	return (
		<MenuModal
			title="تغییر نام دسته‌ی اصلی"
			onClose={onClose}
			onSubmit={async () => {
				if (!name.trim()) throw new Error('نام دسته‌ی اصلی الزامی است.');
				await adminApi(`/api/admin/menu-types/${row.id}`, { method: 'PATCH', body: { name: name.trim() } });
				onSaved();
			}}
		>
			<div className="field">
				<label htmlFor="emtName">نام</label>
				<input id="emtName" name="name" maxLength={NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
			</div>
		</MenuModal>
	);
}
