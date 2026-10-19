import { api } from '../../../shared/api';
import type { AddOn } from '../api';
import type { EngineGroup, EngineProduct, Kind } from './engine';

// The data of «انتخاب برای من» (GET /api/recommender, src/services/recommender.service.ts): the questions
// and the products that can be suggested (available, in a category with a kind, on a visible tab).

export interface RecProduct extends EngineProduct {
	name: string;
	price: number;
	description: string;
	image: string;
	categoryName: string;
	isAvailable: true;
	addOns: AddOn[];
}

export type RecData = { enabled: false } | { enabled: true; groups: EngineGroup[]; products: RecProduct[] };

/** Whether the menu shows the button (switched on, and there is something to ask and to suggest). */
export const fetchRecommenderStatus = () => api<{ enabled: boolean }>('/api/recommender/status');

export const fetchRecommenderData = () => api<RecData>('/api/recommender', { fallbackMessage: 'خطا در دریافت پیشنهادها' });

export const KIND_FA: Record<Kind, string> = { DRINK: 'نوشیدنی', FOOD: 'غذا', DESSERT: 'دسر' };

/** «سرد» · «سرد و شیرین» · «سرد، شیرین و سبک» */
export function joinFa(labels: readonly string[]): string {
	if (labels.length < 2) return labels.join('');
	return `${labels.slice(0, -1).join('، ')} و ${labels[labels.length - 1]}`;
}
