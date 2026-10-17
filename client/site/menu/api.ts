import { api } from '../../shared/api';

export interface MenuType {
	id: number;
	name: string;
}

export interface Category {
	id: number;
	name: string;
	menuTypeId: number;
}

export interface AddOn {
	id: number;
	name: string;
	/** Extra price in toman (may be 0). */
	price: number;
}

export interface Product {
	id: number;
	name: string;
	price: number;
	description: string;
	image: string;
	categoryId: number;
	addOns: AddOn[];
}

export const fetchMenuTypes = () => api<MenuType[]>('/api/menu-types', { fallbackMessage: 'خطا در دریافت منو' });
export const fetchCategories = () => api<Category[]>('/api/categories', { fallbackMessage: 'خطا در دریافت دسته‌بندی‌ها' });
export const fetchProducts = (categoryId: number, signal?: AbortSignal) =>
	api<Product[]>(`/api/products?categoryId=${encodeURIComponent(categoryId)}`, { signal, fallbackMessage: 'خطا در دریافت محصولات' });

/** Product images are served from the server's uploads folder; the placeholder means "no image". */
export function productImageUrl(image: string | null | undefined): string {
	if (!image || image === 'placeholder.png') return '';
	return `/uploads/products/${encodeURIComponent(image)}`;
}
