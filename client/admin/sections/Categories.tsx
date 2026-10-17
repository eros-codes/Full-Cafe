import { useEffect, useState, type FormEvent } from 'react';
import { errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash, type CategoryRow, type MenuTypeRow } from './menu-common';

/** Categories, each under one of the menu's main types (café, restaurant, …). Reloaded on every visit. */
export function Categories({ visit }: { visit: number }) {
	const [categories, setCategories] = useState<CategoryRow[] | null>(null);
	const [menuTypes, setMenuTypes] = useState<MenuTypeRow[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [typeId, setTypeId] = useState('');
	const [adding, setAdding] = useState(false);
	const [editing, setEditing] = useState<CategoryRow | null>(null);
	const [deleting, setDeleting] = useState<number | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		if (reloadKey === 0) setCategories(null);
		Promise.all([adminApi<{ categories: CategoryRow[] }>('/api/admin/categories'), adminApi<{ menuTypes: MenuTypeRow[] }>('/api/admin/menu-types')])
			.then(([c, t]) => {
				if (!current) return;
				setCategories(c.categories);
				setMenuTypes(t.menuTypes);
				setError(null);
				setTypeId((id) => (t.menuTypes.some((m) => String(m.id) === id) ? id : String(t.menuTypes[0]?.id ?? '')));
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit, reloadKey]);

	const reload = () => setReloadKey((k) => k + 1);

	if (error && !categories) return <div id="categoriesBox"><ErrorNotice message={error} /></div>;
	if (!categories) return <div id="categoriesBox"><Skeleton height={180} /></div>;

	const create = async (event: FormEvent) => {
		event.preventDefault();
		if (!name.trim()) return show('نام دسته را وارد کن.');
		setAdding(true);
		try {
			await adminApi('/api/admin/categories', { method: 'POST', body: { name: name.trim(), menuTypeId: Number(typeId) } });
			setName('');
			reload();
			show('دسته اضافه شد.', 'ok');
		} catch (err) {
			show(errorText(err));
		} finally {
			setAdding(false);
		}
	};

	const remove = async (category: CategoryRow) => {
		const count = category._count?.products || 0;
		// حذف دسته‌ی دارای محصول، محصولاتش را هم پاک می‌کند؛ پس صریحاً پرسیده می‌شود
		const question = count
			? `دسته‌ی «${category.name}» ${fa(count)} محصول دارد. با حذف دسته، همه‌ی این محصولات و تصویرهایشان هم برای همیشه حذف می‌شوند. ادامه می‌دهی؟`
			: `دسته‌ی «${category.name}» حذف شود؟`;
		if (!window.confirm(question)) return;
		setDeleting(category.id);
		try {
			await adminApi(`/api/admin/categories/${category.id}${count ? '?withProducts=1' : ''}`, { method: 'DELETE' });
			reload();
			show('دسته حذف شد.', 'ok');
		} catch (err) {
			show(errorText(err));
		} finally {
			setDeleting(null);
		}
	};

	return (
		<div id="categoriesBox">
			<MenuFlash flash={flash} />
			<form className="card card-pad menu-inline-form" noValidate onSubmit={create}>
				<h4>افزودن دسته‌بندی</h4>
				<div className="row">
					<div className="field">
						<label htmlFor="cName">نام دسته</label>
						<input id="cName" name="name" maxLength={80} placeholder="مثلاً نوشیدنی گرم" value={name} onChange={(e) => setName(e.target.value)} />
					</div>
					<div className="field">
						<label htmlFor="cType">منو</label>
						<select id="cType" name="type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
							{menuTypes.map((t) => (
								<option key={t.id} value={t.id}>
									{t.name}
								</option>
							))}
						</select>
					</div>
				</div>
				<button type="submit" className="primary-btn" disabled={adding || !menuTypes.length}>
					{ICONS.plus}
					<span>افزودن دسته</span>
				</button>
			</form>
			{!menuTypes.length && <div className="notice warn">اول از بخش «دسته‌های اصلی منو» یک دسته‌ی اصلی (مثل کافه) بساز.</div>}
			{categories.length ? (
				<div className="table-scroll">
					<table className="table-list">
						<thead>
							<tr>
								<th>نام</th>
								<th>منو</th>
								<th>محصولات</th>
								<th>عملیات</th>
							</tr>
						</thead>
						<tbody>
							{categories.map((c) => (
								<tr key={c.id}>
									<td>
										<strong>{c.name}</strong>
									</td>
									<td>{c.menuType?.name ?? '—'}</td>
									<td>{fa(c._count?.products)}</td>
									<td className="table-actions-cell">
										<button type="button" className="secondary-btn" onClick={() => setEditing(c)}>
											ویرایش
										</button>
										<button type="button" className="danger-btn" disabled={deleting === c.id} onClick={() => remove(c)}>
											حذف
										</button>
									</td>
								</tr>
							))}
						</tbody>
					</table>
				</div>
			) : (
				<EmptyState title="هنوز دسته‌ای نیست" text="با فرم بالا اولین دسته‌ی منو را بساز." />
			)}
			{editing && (
				<CategoryForm
					category={editing}
					menuTypes={menuTypes}
					onClose={() => setEditing(null)}
					onSaved={() => {
						reload();
						show('دسته ویرایش شد.', 'ok');
					}}
				/>
			)}
		</div>
	);
}

function CategoryForm({ category, menuTypes, onClose, onSaved }: { category: CategoryRow; menuTypes: MenuTypeRow[]; onClose: () => void; onSaved: () => void }) {
	const [name, setName] = useState(category.name);
	const [typeId, setTypeId] = useState(String(category.menuTypeId));
	return (
		<MenuModal
			title="ویرایش دسته‌بندی"
			onClose={onClose}
			onSubmit={async () => {
				if (!name.trim()) throw new Error('نام دسته الزامی است.');
				await adminApi(`/api/admin/categories/${category.id}`, { method: 'PATCH', body: { name: name.trim(), menuTypeId: Number(typeId) } });
				onSaved();
			}}
		>
			<div className="field">
				<label htmlFor="ecName">نام دسته</label>
				<input id="ecName" name="name" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
			</div>
			<div className="field">
				<label htmlFor="ecType">منو</label>
				<select id="ecType" name="type" value={typeId} onChange={(e) => setTypeId(e.target.value)}>
					{menuTypes.map((t) => (
						<option key={t.id} value={t.id}>
							{t.name}
						</option>
					))}
				</select>
			</div>
		</MenuModal>
	);
}
