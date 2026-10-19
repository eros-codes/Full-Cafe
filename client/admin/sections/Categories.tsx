import { useEffect, useState, type FormEvent } from 'react';
import { errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash, type CategoryKind, type CategoryRow, type MenuTypeRow } from './menu-common';
import { CategoryTagsField, KINDS, KIND_FA, fetchTagGroups, type TagGroupRow } from './tags-common';

const KIND_NONE_LABEL = 'بدون نوع (در «انتخاب برای من» نیست)';

const readKind = (value: string): CategoryKind | null => ((KINDS as readonly string[]).includes(value) ? (value as CategoryKind) : null);

function KindSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
	return (
		<select id={id} name="kind" value={value} onChange={(e) => onChange(e.target.value)}>
			<option value="">{KIND_NONE_LABEL}</option>
			{KINDS.map((kind) => (
				<option key={kind} value={kind}>
					{KIND_FA[kind]}
				</option>
			))}
		</select>
	);
}

/** Labels of the tags a category gives its products (active groups only), for the table. */
function tagLabels(category: CategoryRow, groups: TagGroupRow[]): string {
	const labels = groups.filter((g) => g.isActive).flatMap((g) => g.options.filter((o) => category.tagOptionIds.includes(o.id)).map((o) => o.label));
	return labels.length ? labels.join('، ') : '—';
}

/**
 * Categories, each under one of the menu's main types (café, restaurant, …), with their kind (drink / food /
 * dessert) and the tags their products inherit for «انتخاب برای من». Reloaded on every visit.
 */
export function Categories({ visit }: { visit: number }) {
	const [categories, setCategories] = useState<CategoryRow[] | null>(null);
	const [menuTypes, setMenuTypes] = useState<MenuTypeRow[]>([]);
	const [groups, setGroups] = useState<TagGroupRow[]>([]);
	const [error, setError] = useState<string | null>(null);
	const [name, setName] = useState('');
	const [typeId, setTypeId] = useState('');
	const [kind, setKind] = useState('');
	const [adding, setAdding] = useState(false);
	const [editing, setEditing] = useState<CategoryRow | null>(null);
	const [deleting, setDeleting] = useState<number | null>(null);
	const [reloadKey, setReloadKey] = useState(0);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		if (reloadKey === 0) setCategories(null);
		Promise.all([
			adminApi<{ categories: CategoryRow[] }>('/api/admin/categories'),
			adminApi<{ menuTypes: MenuTypeRow[] }>('/api/admin/menu-types'),
			fetchTagGroups(),
		])
			.then(([c, t, g]) => {
				if (!current) return;
				setCategories(c.categories);
				setMenuTypes(t.menuTypes);
				setGroups(g);
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
			await adminApi('/api/admin/categories', { method: 'POST', body: { name: name.trim(), menuTypeId: Number(typeId), kind: readKind(kind) } });
			setName('');
			setKind('');
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
				<div className="row row-3">
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
					<div className="field">
						<label htmlFor="cKind">نوع</label>
						<KindSelect id="cKind" value={kind} onChange={setKind} />
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
								<th>نوع</th>
								<th>برچسب‌ها</th>
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
									<td className="menu-nowrap">{c.kind ? KIND_FA[c.kind] : '—'}</td>
									<td>
										<small className="menu-desc">{tagLabels(c, groups)}</small>
									</td>
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
					groups={groups}
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

interface FormProps {
	category: CategoryRow;
	menuTypes: MenuTypeRow[];
	groups: TagGroupRow[];
	onClose: () => void;
	onSaved: () => void;
}

function CategoryForm({ category, menuTypes, groups, onClose, onSaved }: FormProps) {
	const [name, setName] = useState(category.name);
	const [typeId, setTypeId] = useState(String(category.menuTypeId));
	const [kind, setKind] = useState(category.kind ?? '');
	const [tagOptionIds, setTagOptionIds] = useState(category.tagOptionIds);
	return (
		<MenuModal
			title="ویرایش دسته‌بندی"
			onClose={onClose}
			onSubmit={async () => {
				if (!name.trim()) throw new Error('نام دسته الزامی است.');
				await adminApi(`/api/admin/categories/${category.id}`, {
					method: 'PATCH',
					body: { name: name.trim(), menuTypeId: Number(typeId), kind: readKind(kind), tagOptionIds },
				});
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
			<div className="field">
				<label htmlFor="ecKind">نوع (برای «انتخاب برای من»)</label>
				<KindSelect id="ecKind" value={kind} onChange={setKind} />
			</div>
			<CategoryTagsField groups={groups} kind={readKind(kind)} value={tagOptionIds} onChange={setTagOptionIds} />
		</MenuModal>
	);
}
