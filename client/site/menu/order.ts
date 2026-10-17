import { safeStorage } from '../../shared/storage';
import type { AddOn } from './api';

// The order list is only a note on the customer's phone (no online ordering): it lives in
// localStorage for 6 hours after the last change.

const ORDER_STORAGE_KEY = 'roofMenuOrder';
const ORDER_EXPIRE_MS = 6 * 60 * 60 * 1000;

export interface OrderItem {
	/** Product id + chosen add-ons: the same pizza with and without extra cheese are two lines. */
	key: string;
	id: string;
	name: string;
	/** Base price of the product, without add-ons. */
	price: number;
	image: string;
	addOns: AddOn[];
	quantity: number;
}

export interface Order {
	expiresAt: number;
	items: OrderItem[];
}

export interface OrderProduct {
	id: number | string;
	name: string;
	price: number;
	image?: string;
}

export function itemKey(productId: number | string, addOns: readonly AddOn[]): string {
	if (!addOns.length) return String(productId);
	return `${productId}+${[...addOns.map((a) => a.id)].sort((a, b) => a - b).join('.')}`;
}

export function unitPrice(item: Pick<OrderItem, 'price' | 'addOns'>): number {
	return item.price + item.addOns.reduce((sum, addOn) => sum + addOn.price, 0);
}

function normalizeAddOns(value: unknown): AddOn[] {
	if (!Array.isArray(value)) return [];
	return value
		.map((a) => ({ id: Number(a?.id), name: String(a?.name ?? ''), price: Number(a?.price) || 0 }))
		.filter((a) => Number.isInteger(a.id) && a.id > 0 && a.name);
}

function normalizeItems(items: unknown): OrderItem[] {
	if (!Array.isArray(items)) return [];
	const result: OrderItem[] = [];
	for (const raw of items) {
		if (!raw || raw.id === undefined || raw.id === null) continue;
		const quantity = Number(raw.quantity);
		if (!Number.isFinite(quantity) || quantity < 1) continue;
		const addOns = normalizeAddOns(raw.addOns);
		result.push({
			key: itemKey(raw.id, addOns),
			id: String(raw.id),
			name: String(raw.name || ''),
			price: Number(raw.price) || 0,
			image: raw.image ? String(raw.image) : '',
			addOns,
			quantity: Math.floor(quantity),
		});
	}
	return result;
}

const emptyOrder = (): Order => ({ expiresAt: Date.now() + ORDER_EXPIRE_MS, items: [] });

export function loadOrder(): Order {
	let raw: { expiresAt?: unknown; items?: unknown } | null = null;
	try {
		raw = JSON.parse(safeStorage.get(ORDER_STORAGE_KEY) ?? 'null');
	} catch {
		raw = null;
	}
	const expiresAt = Number(raw?.expiresAt);
	const items = normalizeItems(raw?.items);
	if (!raw || typeof raw !== 'object' || !Number.isFinite(expiresAt) || expiresAt <= Date.now() || !items.length) {
		safeStorage.remove(ORDER_STORAGE_KEY);
		return emptyOrder();
	}
	return { expiresAt, items };
}

function save(items: OrderItem[]): Order {
	if (!items.length) {
		safeStorage.remove(ORDER_STORAGE_KEY);
		return emptyOrder();
	}
	const order = { expiresAt: Date.now() + ORDER_EXPIRE_MS, items };
	safeStorage.set(ORDER_STORAGE_KEY, JSON.stringify(order));
	return order;
}

export function addItem(product: OrderProduct, addOns: readonly AddOn[] = []): Order {
	const items = loadOrder().items;
	const key = itemKey(product.id, addOns);
	const index = items.findIndex((item) => item.key === key);
	const base = {
		key,
		id: String(product.id),
		name: product.name,
		price: Number(product.price) || 0,
		image: product.image ?? '',
		addOns: addOns.map((a) => ({ id: a.id, name: a.name, price: a.price })),
	};
	if (index >= 0) items[index] = { ...items[index], ...base, quantity: items[index].quantity + 1 };
	else items.push({ ...base, quantity: 1 });
	return save(items);
}

export function decreaseItem(key: string): Order {
	return save(loadOrder().items.flatMap((item) => (item.key !== key ? [item] : item.quantity > 1 ? [{ ...item, quantity: item.quantity - 1 }] : [])));
}

export function removeItem(key: string): Order {
	return save(loadOrder().items.filter((item) => item.key !== key));
}

export function clearOrder(): Order {
	return save([]);
}

/** Every line (all add-on variants) of one product. */
export function productQuantity(order: Order, productId: number | string): number {
	const id = String(productId);
	return order.items.reduce((sum, item) => sum + (item.id === id ? item.quantity : 0), 0);
}

export function keyQuantity(order: Order, key: string): number {
	return order.items.find((item) => item.key === key)?.quantity ?? 0;
}

export function totalQuantity(order: Order): number {
	return order.items.reduce((sum, item) => sum + item.quantity, 0);
}
