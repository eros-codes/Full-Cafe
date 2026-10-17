import { api } from '../../shared/api';

export interface PublicReview {
	id: number;
	name: string | null;
	text: string;
	reply: string | null;
	createdAt: string;
}

export async function fetchReviews(): Promise<PublicReview[]> {
	const res = await api<{ data: PublicReview[] } | PublicReview[]>('/api/reviews?limit=30', { fallbackMessage: 'خطا در دریافت نظرات' });
	// the server answers {data, page, limit, total} when ?limit is sent, a plain array otherwise
	return Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : [];
}

export function postReview(review: { name: string | null; text: string }) {
	return api('/api/reviews', { method: 'POST', body: review, fallbackMessage: 'خطا در ثبت نظر' });
}
