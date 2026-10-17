import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';

export const PLACEHOLDER = 'placeholder.png';

export interface MenuTypeRow {
	id: number;
	name: string;
	sortOrder: number;
	isActive: boolean;
	_count?: { categories: number };
}

export interface CategoryRow {
	id: number;
	name: string;
	menuTypeId: number;
	menuType?: { id: number; name: string };
	_count?: { products: number };
}

export interface AddOnRow {
	id: number;
	name: string;
	price: number;
	isActive: boolean;
	_count?: { products: number };
}

export interface ProductRow {
	id: number;
	name: string;
	price: number;
	description: string;
	image: string;
	categoryId: number;
	addOnIds: number[];
}

export function imageSrc(image: string | null | undefined): string {
	return image && image !== PLACEHOLDER ? `/uploads/products/${encodeURIComponent(image)}` : '';
}

export function Thumb({ image, alt }: { image: string | null | undefined; alt: string }) {
	const src = imageSrc(image);
	return src ? (
		<img className="menu-thumb" src={src} alt={alt} loading="lazy" />
	) : (
		<span className="menu-thumb menu-thumb--empty" aria-hidden="true">
			{ICONS.image}
		</span>
	);
}

/** Flash message at the top of a menu section (errors stay, the rest fade after a few seconds). */
export function MenuFlash({ flash }: { flash: { type: string; text: string; id: number } | null }) {
	if (!flash) return null;
	return (
		<div className={`menu-notice notice ${flash.type}`} key={flash.id}>
			{flash.text}
		</div>
	);
}

export async function uploadImage(file: File): Promise<string> {
	const data = new FormData();
	data.append('image', file);
	const { filename } = await adminApi<{ filename: string }>('/api/admin/upload', { method: 'POST', body: data, fallbackMessage: 'آپلود تصویر ناموفق بود.' });
	return filename;
}
