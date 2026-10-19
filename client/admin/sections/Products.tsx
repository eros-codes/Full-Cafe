import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../shared/api';
import { toman } from '../../shared/format';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash, PLACEHOLDER, Thumb, uploadImage, type AddOnRow, type CategoryKind, type CategoryRow, type ProductRow } from './menu-common';
import {
	ProductTagsField,
	TagChip,
	TagRow,
	fetchCoverage,
	fetchTagGroups,
	implying,
	ownTagsBody,
	ownTagsOf,
	toggleOption,
	type OwnTags,
	type TagCoverage,
	type TagGroupRow,
} from './tags-common';

interface Data {
	products: ProductRow[];
	categories: CategoryRow[];
	addOns: AddOnRow[];
	groups: TagGroupRow[];
	/** null when it could not be read: the list still works, only the «برچسب ناقص» hints are missing. */
	coverage: TagCoverage | null;
}

/** Filter tabs besides the categories. */
const UNAVAILABLE = 'unavailable';
const INCOMPLETE = 'incomplete';

const categoryLabel = (categories: CategoryRow[], id: number) => {
	const category = categories.find((c) => c.id === id);
	return category ? `${category.name} · ${category.menuType?.name ?? ''}` : '—';
};

// the RLM keeps the «+» on the reading side (right) of the number in RTL text, like on the menu page
const addOnPriceText = (price: number) => (price > 0 ? `‏+${fa(price)} تومان` : 'رایگان');

const fetchProducts = () => adminApi<{ products: ProductRow[] }>('/api/admin/products').then((r) => r.products);

/**
 * Menu items: filter by category (or sold out / incomplete tags), add / edit (photo, add-ons, availability,
 * tags) / delete, mark sold out in one click, and add or remove tags on many products at once.
 * Reloaded on every visit.
 */
export function Products({ visit }: { visit: number }) {
	const [data, setData] = useState<Data | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState('all');
	const [editing, setEditing] = useState<ProductRow | 'new' | null>(null);
	const [busyId, setBusyId] = useState<number | null>(null);
	const [selected, setSelected] = useState<number[]>([]);
	const [bulk, setBulk] = useState<'add' | 'remove' | null>(null);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		setData(null);
		setError(null);
		setSelected([]);
		Promise.all([
			fetchProducts(),
			adminApi<{ categories: CategoryRow[] }>('/api/admin/categories'),
			adminApi<{ addOns: AddOnRow[] }>('/api/admin/addons'),
			fetchTagGroups(),
			fetchCoverage().catch(() => null),
		])
			.then(([products, c, a, groups, coverage]) => {
				if (!current) return;
				setData({ products, categories: c.categories, addOns: a.addOns, groups, coverage });
				setFilter((f) => (f === 'all' || f === UNAVAILABLE || f === INCOMPLETE || c.categories.some((cat) => String(cat.id) === f) ? f : 'all'));
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit]);

	if (error) return <div id="productsBox"><ErrorNotice message={error} /></div>;
	if (!data) return <div id="productsBox"><Skeleton height={180} /></div>;

	const { products, categories, addOns, groups, coverage } = data;
	const missing = new Map((coverage?.incomplete ?? []).map((i) => [i.productId, i.missingGroupIds]));
	const groupName = new Map((coverage?.groups ?? []).map((g) => [g.id, g.name]));
	const canTag = groups.some((g) => g.isActive && g.options.length > 0);

	const list =
		filter === 'all'
			? products
			: filter === UNAVAILABLE
				? products.filter((p) => !p.isAvailable)
				: filter === INCOMPLETE
					? products.filter((p) => missing.has(p.id))
					: products.filter((p) => String(p.categoryId) === filter);
	const unavailableCount = products.filter((p) => !p.isAvailable).length;
	const incompleteCount = products.filter((p) => missing.has(p.id)).length;
	const tabs: [string, string][] = [['all', `همه (${fa(products.length)})`]];
	if (unavailableCount || filter === UNAVAILABLE) tabs.push([UNAVAILABLE, `ناموجود (${fa(unavailableCount)})`]);
	if (incompleteCount || filter === INCOMPLETE) tabs.push([INCOMPLETE, `برچسب ناقص (${fa(incompleteCount)})`]);
	categories.forEach((c) => tabs.push([String(c.id), `${c.name} (${fa(products.filter((p) => p.categoryId === c.id).length)})`]));

	const changeFilter = (key: string) => {
		setFilter(key);
		// a selection hidden by the filter would be changed without being seen
		setSelected([]);
	};

	const refreshCoverage = () =>
		fetchCoverage()
			.then((c) => setData((d) => d && { ...d, coverage: c }))
			.catch(() => undefined);

	const replaceRow = (saved: ProductRow) => setData((d) => d && { ...d, products: d.products.map((p) => (p.id === saved.id ? saved : p)) });

	const remove = async (product: ProductRow) => {
		if (!window.confirm(`«${product.name}» برای همیشه حذف شود؟`)) return;
		setBusyId(product.id);
		try {
			await adminApi(`/api/admin/products/${product.id}`, { method: 'DELETE' });
			setData((d) => d && { ...d, products: d.products.filter((p) => p.id !== product.id) });
			setSelected((ids) => ids.filter((id) => id !== product.id));
			show('محصول حذف شد.', 'ok');
			void refreshCoverage();
		} catch (err) {
			show(errorText(err));
		} finally {
			setBusyId(null);
		}
	};

	const toggleAvailable = async (product: ProductRow) => {
		setBusyId(product.id);
		try {
			const { product: saved } = await adminApi<{ product: ProductRow }>(`/api/admin/products/${product.id}`, {
				method: 'PATCH',
				body: { isAvailable: !product.isAvailable },
			});
			replaceRow(saved);
			show(
				saved.isAvailable
					? `«${saved.name}» دوباره موجود شد.`
					: `«${saved.name}» ناموجود شد: در منو با برچسب «ناموجود» دیده می‌شود، سفارش داده نمی‌شود و پیشنهاد هم نمی‌شود.`,
				'ok',
			);
		} catch (err) {
			show(errorText(err));
		} finally {
			setBusyId(null);
		}
	};

	const allShownSelected = list.length > 0 && list.every((p) => selected.includes(p.id));
	const toggleSelected = (id: number, on: boolean) => setSelected((ids) => (on ? [...ids, id] : ids.filter((x) => x !== id)));

	return (
		<div id="productsBox">
			<MenuFlash flash={flash} />
			<div className="menu-toolbar">
				<div className="filter-tabs">
					{tabs.map(([key, label]) => (
						<button type="button" key={key} className={`filter-tab${key === filter ? ' active' : ''}`} onClick={() => changeFilter(key)}>
							{label}
						</button>
					))}
				</div>
				<button type="button" className="primary-btn menu-add-btn" disabled={!categories.length} onClick={() => setEditing('new')}>
					{ICONS.plus}
					<span>محصول جدید</span>
				</button>
			</div>
			{!categories.length ? (
				<div className="notice warn">اول از بخش «دسته‌بندی منو» یک دسته بساز؛ هر محصول باید داخل یک دسته باشد.</div>
			) : list.length ? (
				<div className="table-scroll">
					<table className="table-list menu-table">
						<thead>
							<tr>
								{canTag && (
									<th className="menu-select">
										<input
											type="checkbox"
											aria-label="انتخاب همه‌ی محصولات این فهرست"
											checked={allShownSelected}
											onChange={(e) => setSelected(e.target.checked ? list.map((p) => p.id) : [])}
										/>
									</th>
								)}
								<th>تصویر</th>
								<th>نام</th>
								<th>دسته</th>
								<th>قیمت</th>
								<th>عملیات</th>
							</tr>
						</thead>
						<tbody>
							{list.map((p) => {
								const linked = p.addOnIds.map((id) => addOns.find((a) => a.id === id)?.name).filter(Boolean);
								const missingNames = (missing.get(p.id) ?? []).map((id) => groupName.get(id)).filter(Boolean);
								return (
									<tr key={p.id} className={p.isAvailable ? undefined : 'menu-row-soldout'}>
										{canTag && (
											<td className="menu-select">
												<input
													type="checkbox"
													aria-label={`انتخاب «${p.name}»`}
													checked={selected.includes(p.id)}
													onChange={(e) => toggleSelected(p.id, e.target.checked)}
												/>
											</td>
										)}
										<td>
											<Thumb image={p.image} alt={p.name} />
										</td>
										<td>
											<strong>{p.name}</strong>
											{!p.isAvailable && <span className="status CANCELLED menu-soldout-badge">ناموجود</span>}
											{p.description ? (
												<>
													<br />
													<small className="menu-desc">{p.description}</small>
												</>
											) : null}
											{/* .menu-desc is a block box, so this line starts on its own line without a <br> */}
											{linked.length > 0 && <small className="menu-desc menu-addons-line">{`افزودنی‌ها: ${linked.join('، ')}`}</small>}
											{missingNames.length > 0 && <small className="menu-desc tag-missing">{`برچسب ناقص: ${missingNames.join('، ')}`}</small>}
										</td>
										<td>{categoryLabel(categories, p.categoryId)}</td>
										<td className="menu-nowrap">{toman(p.price)}</td>
										<td className="table-actions-cell">
											<button type="button" className="secondary-btn" onClick={() => setEditing(p)}>
												ویرایش
											</button>
											<button type="button" className="secondary-btn" disabled={busyId === p.id} onClick={() => toggleAvailable(p)}>
												{p.isAvailable ? 'ناموجود کن' : 'موجود کن'}
											</button>
											<button type="button" className="danger-btn" disabled={busyId === p.id} onClick={() => remove(p)}>
												حذف
											</button>
										</td>
									</tr>
								);
							})}
						</tbody>
					</table>
				</div>
			) : (
				<EmptyState
					title="محصولی نیست"
					text={
						filter === UNAVAILABLE
							? 'همه‌ی محصولات موجودند.'
							: filter === INCOMPLETE
								? 'برچسب همه‌ی محصولات کامل است.'
								: 'برای این دسته هنوز محصولی ثبت نشده.'
					}
				/>
			)}
			{canTag && selected.length > 0 && (
				// after the list and sticky at the bottom: ticking a row does not push the list down
				<div className="bulk-bar" role="region" aria-label="کار گروهی روی محصولات انتخاب‌شده">
					<strong>{`${fa(selected.length)} محصول انتخاب شد`}</strong>
					<div className="bulk-bar-actions">
						<button type="button" className="secondary-btn" onClick={() => setBulk('add')}>
							{ICONS.plus}
							<span>افزودن برچسب</span>
						</button>
						<button type="button" className="secondary-btn" onClick={() => setBulk('remove')}>
							برداشتن برچسب
						</button>
						<button type="button" className="secondary-btn" onClick={() => setSelected([])}>
							لغو انتخاب
						</button>
					</div>
				</div>
			)}
			{editing && (
				<ProductForm
					product={editing === 'new' ? null : editing}
					categories={categories}
					addOns={addOns}
					groups={groups}
					defaultCategoryId={editing === 'new' ? (/^\d+$/.test(filter) ? Number(filter) : categories[0]?.id) : editing.categoryId}
					onClose={() => setEditing(null)}
					onSaved={(saved, isEdit) => {
						setData((d) => d && { ...d, products: isEdit ? d.products.map((p) => (p.id === saved.id ? saved : p)) : [...d.products, saved] });
						show(isEdit ? 'محصول ویرایش شد.' : 'محصول اضافه شد.', 'ok');
						void refreshCoverage();
					}}
				/>
			)}
			{bulk && (
				<BulkTagDialog
					mode={bulk}
					products={products.filter((p) => selected.includes(p.id))}
					categories={categories}
					groups={groups}
					onClose={() => setBulk(null)}
					onDone={async (count) => {
						show(`برچسب ${fa(count)} محصول به‌روز شد.`, 'ok');
						setSelected([]);
						try {
							const [fresh, c] = await Promise.all([fetchProducts(), fetchCoverage().catch(() => null)]);
							setData((d) => d && { ...d, products: fresh, coverage: c ?? d.coverage });
						} catch (err) {
							show(errorText(err));
						}
					}}
				/>
			)}
		</div>
	);
}

interface FormProps {
	product: ProductRow | null;
	categories: CategoryRow[];
	addOns: AddOnRow[];
	groups: TagGroupRow[];
	defaultCategoryId: number | undefined;
	onClose: () => void;
	onSaved: (product: ProductRow, isEdit: boolean) => void;
}

function ProductForm({ product, categories, addOns, groups, defaultCategoryId, onClose, onSaved }: FormProps) {
	const [name, setName] = useState(product?.name ?? '');
	const [price, setPrice] = useState(product ? String(product.price) : '');
	const [categoryId, setCategoryId] = useState(String(defaultCategoryId ?? ''));
	const [description, setDescription] = useState(product?.description ?? '');
	const [image, setImage] = useState(product?.image || PLACEHOLDER);
	const [addOnIds, setAddOnIds] = useState<number[]>(product?.addOnIds ?? []);
	const [isAvailable, setIsAvailable] = useState(product?.isAvailable ?? true);
	const [ownTags, setOwnTags] = useState<OwnTags>(() => ownTagsOf(product, groups));
	const [uploadStatus, setUploadStatus] = useState('');
	const [uploading, setUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);
	const category = categories.find((c) => String(c.id) === categoryId);

	const pickFile = async (file: File | undefined) => {
		if (!file) return;
		if (file.size > 5 * 1024 * 1024) {
			setUploadStatus('حجم فایل بیشتر از ۵ مگابایت است.');
			return;
		}
		setUploading(true);
		setUploadStatus('در حال آپلود…');
		try {
			setImage(await uploadImage(file));
			setUploadStatus('آپلود شد ✓');
		} catch (err) {
			setUploadStatus(errorText(err));
		} finally {
			setUploading(false);
		}
	};

	const submit = async () => {
		if (uploading) throw new Error('صبر کن آپلود تصویر تمام شود.');
		const cleanName = name.trim();
		const priceNumber = Number(price);
		if (!cleanName) throw new Error('نام محصول الزامی است.');
		if (price === '' || !Number.isInteger(priceNumber) || priceNumber < 0) throw new Error('قیمت باید عدد صحیح و مثبت باشد.');
		const body = {
			name: cleanName,
			price: priceNumber,
			categoryId: Number(categoryId),
			description: description.trim(),
			image,
			// ترتیب نمایش افزودنی‌ها روی منو همان ترتیب فهرست افزودنی‌هاست
			addOnIds: addOns.filter((a) => addOnIds.includes(a.id)).map((a) => a.id),
			isAvailable,
			// همه‌ی گروه‌هایی که خود محصول تعیین کرده (حتی آن‌هایی که این‌جا نمایش داده نمی‌شوند) دست‌نخورده برمی‌گردند
			tags: ownTagsBody(ownTags),
		};
		const { product: saved } = product
			? await adminApi<{ product: ProductRow }>(`/api/admin/products/${product.id}`, { method: 'PATCH', body })
			: await adminApi<{ product: ProductRow }>('/api/admin/products', { method: 'POST', body });
		onSaved(saved, Boolean(product));
	};

	return (
		<MenuModal title={product ? 'ویرایش محصول' : 'محصول جدید'} submitLabel={product ? 'ذخیره تغییرات' : 'افزودن محصول'} onSubmit={submit} onClose={onClose}>
			<div className="field">
				<label htmlFor="pName">نام محصول</label>
				<input id="pName" name="name" maxLength={80} required placeholder="مثلاً لاته" value={name} onChange={(e) => setName(e.target.value)} />
			</div>
			<div className="row">
				<div className="field">
					<label htmlFor="pPrice">قیمت (تومان)</label>
					<input id="pPrice" name="price" type="number" inputMode="numeric" min="0" step="1000" required dir="ltr" value={price} onChange={(e) => setPrice(e.target.value)} />
				</div>
				<div className="field">
					<label htmlFor="pCategory">دسته</label>
					<select id="pCategory" name="categoryId" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
						{categories.map((c) => (
							<option key={c.id} value={c.id}>
								{`${c.name} · ${c.menuType?.name ?? ''}`}
							</option>
						))}
					</select>
				</div>
			</div>
			<div className="avail-field">
				<label className="checkbox-row">
					<input type="checkbox" name="isAvailable" checked={isAvailable} onChange={(e) => setIsAvailable(e.target.checked)} />
					<span>موجود است</span>
				</label>
				{!isAvailable && <p className="hint">در منو با برچسب «ناموجود» دیده می‌شود، سفارش داده نمی‌شود و پیشنهاد هم نمی‌شود.</p>}
			</div>
			<div className="field">
				<label htmlFor="pDesc">توضیحات (اختیاری)</label>
				<textarea id="pDesc" name="description" rows={3} maxLength={500} value={description} onChange={(e) => setDescription(e.target.value)}></textarea>
			</div>
			<div className="field">
				<label>افزودنی‌ها (اختیاری)</label>
				{addOns.length ? (
					<div className="menu-addon-picks">
						{addOns.map((addOn) => (
							<label className="checkbox-row" key={addOn.id}>
								<input
									type="checkbox"
									checked={addOnIds.includes(addOn.id)}
									onChange={(e) => setAddOnIds((ids) => (e.target.checked ? [...ids, addOn.id] : ids.filter((id) => id !== addOn.id)))}
								/>{' '}
								<span>
									{addOn.name}
									<small className="menu-addon-price">{` ${addOnPriceText(addOn.price)}${addOn.isActive ? '' : ' · غیرفعال'}`}</small>
								</span>
							</label>
						))}
					</div>
				) : (
					<p className="hint">هنوز افزودنی‌ای ساخته نشده؛ از بخش «افزودنی‌ها» بساز.</p>
				)}
			</div>
			<div className="field">
				<label>تصویر (اختیاری · jpg, png, webp, gif تا ۵ مگابایت)</label>
				<div className="menu-image-field">
					<div className="menu-image-preview">
						<Thumb image={image} alt="پیش‌نمایش تصویر" />
					</div>
					<div className="menu-image-actions">
						<input
							type="file"
							accept="image/jpeg,image/png,image/webp,image/gif"
							hidden
							ref={fileRef}
							onChange={(e) => {
								const file = e.target.files?.[0];
								e.target.value = '';
								pickFile(file);
							}}
						/>
						<button type="button" className="secondary-btn" onClick={() => fileRef.current?.click()}>
							{ICONS.image}
							<span>انتخاب تصویر</span>
						</button>
						<button
							type="button"
							className="secondary-btn"
							hidden={image === PLACEHOLDER}
							onClick={() => {
								setImage(PLACEHOLDER);
								setUploadStatus('');
							}}
						>
							حذف تصویر
						</button>
						<span className="menu-upload-status" aria-live="polite">
							{uploadStatus}
						</span>
					</div>
				</div>
			</div>
			{groups.some((g) => g.isActive) && <ProductTagsField groups={groups} category={category} own={ownTags} onChange={setOwnTags} />}
		</MenuModal>
	);
}

interface BulkProps {
	mode: 'add' | 'remove';
	products: ProductRow[];
	categories: CategoryRow[];
	groups: TagGroupRow[];
	onClose: () => void;
	onDone: (count: number) => void;
}

/** Adds or removes options on the selected products (only the groups that fit their kinds are offered). */
function BulkTagDialog({ mode, products, categories, groups, onClose, onDone }: BulkProps) {
	const [picked, setPicked] = useState<number[]>([]);
	const kinds = new Set(products.map((p) => categories.find((c) => c.id === p.categoryId)?.kind).filter((k): k is CategoryKind => Boolean(k)));
	const shown = groups.filter((g) => g.isActive && g.options.length > 0 && g.kinds.some((k) => kinds.has(k)));
	const withoutKind = products.filter((p) => !categories.find((c) => c.id === p.categoryId)?.kind).length;

	const pick = (group: TagGroupRow, optionId: number) =>
		setPicked((current) => {
			const own = current.filter((id) => group.options.some((o) => o.id === id));
			let next: number[];
			if (mode === 'add') next = toggleOption(group, own, optionId);
			else if (own.includes(optionId)) next = own.filter((id) => id !== optionId);
			// برداشتن «گیاهخوار» بدون «وگان» بی‌اثر است (وگان دوباره گیاهخوار را برمی‌گرداند)، پس با هم انتخاب می‌شوند
			else next = [...new Set([...own, optionId, ...implying(group, optionId)])];
			return [...current.filter((id) => !group.options.some((o) => o.id === id)), ...next];
		});

	return (
		<MenuModal
			title={mode === 'add' ? `افزودن برچسب به ${fa(products.length)} محصول` : `برداشتن برچسب از ${fa(products.length)} محصول`}
			submitLabel={mode === 'add' ? 'افزودن' : 'برداشتن'}
			onClose={onClose}
			onSubmit={async () => {
				if (!picked.length) throw new Error('حداقل یک گزینه انتخاب کن.');
				const body = mode === 'add' ? { productIds: products.map((p) => p.id), addOptionIds: picked } : { productIds: products.map((p) => p.id), removeOptionIds: picked };
				const { count } = await adminApi<{ count: number }>('/api/admin/products/tags/bulk', { method: 'POST', body });
				onDone(count);
			}}
		>
			<p className="hint">
				{mode === 'add'
					? 'گزینه‌های انتخاب‌شده به همه‌ی این محصولات اضافه می‌شوند و بقیه‌ی برچسب‌هایشان سر جایش می‌ماند.'
					: 'گزینه‌های انتخاب‌شده از همه‌ی این محصولات برداشته می‌شوند، حتی اگر از دسته آمده باشند.'}
			</p>
			{withoutKind > 0 && <p className="hint">{`${fa(withoutKind)} محصول از این‌ها در دسته‌ی بدون نوع است و در «انتخاب برای من» نیست.`}</p>}
			{shown.length ? (
				<div className="tag-rows">
					{shown.map((group) => (
						<TagRow key={group.id} group={group}>
							{group.options.map((option) => (
								<TagChip key={option.id} on={picked.includes(option.id)} onClick={() => pick(group, option.id)}>
									{option.label}
								</TagChip>
							))}
						</TagRow>
					))}
				</div>
			) : (
				<p className="hint">برای نوع این محصولات گروه برچسب فعالی نیست.</p>
			)}
		</MenuModal>
	);
}
