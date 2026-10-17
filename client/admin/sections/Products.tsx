import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../shared/api';
import { toman } from '../../shared/format';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash, PLACEHOLDER, Thumb, uploadImage, type AddOnRow, type CategoryRow, type ProductRow } from './menu-common';

interface Data {
	products: ProductRow[];
	categories: CategoryRow[];
	addOns: AddOnRow[];
}

const categoryLabel = (categories: CategoryRow[], id: number) => {
	const category = categories.find((c) => c.id === id);
	return category ? `${category.name} · ${category.menuType?.name ?? ''}` : '—';
};

// the RLM keeps the «+» on the reading side (right) of the number in RTL text, like on the menu page
const addOnPriceText = (price: number) => (price > 0 ? `\u200F+${fa(price)} تومان` : 'رایگان');

/** Menu items: filter by category, add / edit (photo, add-ons) / delete. Reloaded on every visit. */
export function Products({ visit }: { visit: number }) {
	const [data, setData] = useState<Data | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState('all');
	const [editing, setEditing] = useState<ProductRow | 'new' | null>(null);
	const [deleting, setDeleting] = useState<number | null>(null);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		setData(null);
		setError(null);
		Promise.all([
			adminApi<{ products: ProductRow[] }>('/api/admin/products'),
			adminApi<{ categories: CategoryRow[] }>('/api/admin/categories'),
			adminApi<{ addOns: AddOnRow[] }>('/api/admin/addons'),
		])
			.then(([p, c, a]) => {
				if (!current) return;
				setData({ products: p.products, categories: c.categories, addOns: a.addOns });
				setFilter((f) => (f !== 'all' && !c.categories.some((cat) => String(cat.id) === f) ? 'all' : f));
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit]);

	if (error) return <div id="productsBox"><ErrorNotice message={error} /></div>;
	if (!data) return <div id="productsBox"><Skeleton height={180} /></div>;

	const { products, categories, addOns } = data;
	const list = filter === 'all' ? products : products.filter((p) => String(p.categoryId) === filter);
	const tabs: [string, string][] = [['all', `همه (${fa(products.length)})`]];
	categories.forEach((c) => tabs.push([String(c.id), `${c.name} (${fa(products.filter((p) => p.categoryId === c.id).length)})`]));

	const remove = async (product: ProductRow) => {
		if (!window.confirm(`«${product.name}» برای همیشه حذف شود؟`)) return;
		setDeleting(product.id);
		try {
			await adminApi(`/api/admin/products/${product.id}`, { method: 'DELETE' });
			setData({ ...data, products: products.filter((p) => p.id !== product.id) });
			show('محصول حذف شد.', 'ok');
		} catch (err) {
			show(errorText(err));
		} finally {
			setDeleting(null);
		}
	};

	return (
		<div id="productsBox">
			<MenuFlash flash={flash} />
			<div className="menu-toolbar">
				<div className="filter-tabs">
					{tabs.map(([key, label]) => (
						<button type="button" key={key} className={`filter-tab${key === filter ? ' active' : ''}`} onClick={() => setFilter(key)}>
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
								return (
									<tr key={p.id}>
										<td>
											<Thumb image={p.image} alt={p.name} />
										</td>
										<td>
											<strong>{p.name}</strong>
											{p.description ? (
												<>
													<br />
													<small className="menu-desc">{p.description}</small>
												</>
											) : null}
											{/* .menu-desc is a block box, so this line starts on its own line without a <br> */}
											{linked.length > 0 && <small className="menu-desc menu-addons-line">{`افزودنی‌ها: ${linked.join('، ')}`}</small>}
										</td>
										<td>{categoryLabel(categories, p.categoryId)}</td>
										<td className="menu-nowrap">{toman(p.price)}</td>
										<td className="table-actions-cell">
											<button type="button" className="secondary-btn" onClick={() => setEditing(p)}>
												ویرایش
											</button>
											<button type="button" className="danger-btn" disabled={deleting === p.id} onClick={() => remove(p)}>
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
				<EmptyState title="محصولی نیست" text="برای این دسته هنوز محصولی ثبت نشده." />
			)}
			{editing && (
				<ProductForm
					product={editing === 'new' ? null : editing}
					categories={categories}
					addOns={addOns}
					defaultCategoryId={editing === 'new' ? (filter !== 'all' ? Number(filter) : categories[0]?.id) : editing.categoryId}
					onClose={() => setEditing(null)}
					onSaved={(saved, isEdit) => {
						setData({ ...data, products: isEdit ? products.map((p) => (p.id === saved.id ? saved : p)) : [...products, saved] });
						show(isEdit ? 'محصول ویرایش شد.' : 'محصول اضافه شد.', 'ok');
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
	defaultCategoryId: number | undefined;
	onClose: () => void;
	onSaved: (product: ProductRow, isEdit: boolean) => void;
}

function ProductForm({ product, categories, addOns, defaultCategoryId, onClose, onSaved }: FormProps) {
	const [name, setName] = useState(product?.name ?? '');
	const [price, setPrice] = useState(product ? String(product.price) : '');
	const [categoryId, setCategoryId] = useState(String(defaultCategoryId ?? ''));
	const [description, setDescription] = useState(product?.description ?? '');
	const [image, setImage] = useState(product?.image || PLACEHOLDER);
	const [addOnIds, setAddOnIds] = useState<number[]>(product?.addOnIds ?? []);
	const [uploadStatus, setUploadStatus] = useState('');
	const [uploading, setUploading] = useState(false);
	const fileRef = useRef<HTMLInputElement>(null);

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
		</MenuModal>
	);
}
