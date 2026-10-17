import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash } from './menu-common';

interface Review {
	id: number;
	name: string | null;
	text: string;
	reply: string | null;
	visible: boolean;
	createdAt: string;
}

type Filter = 'pending' | 'visible' | 'all';

const TABS: [Filter, string, (r: Review) => boolean][] = [
	['pending', 'در انتظار تایید', (r) => !r.visible],
	['visible', 'نمایش داده‌شده', (r) => r.visible],
	['all', 'همه', () => true],
];

/** Customer reviews from the feedback page: approve (show on the site) / hide, reply, delete. Reloaded on every visit. */
export function Reviews({ visit }: { visit: number }) {
	const [reviews, setReviews] = useState<Review[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState<Filter>('pending');
	const [busyId, setBusyId] = useState<number | null>(null);
	const [replying, setReplying] = useState<Review | null>(null);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		setReviews(null);
		setError(null);
		adminApi<{ reviews: Review[] }>('/api/admin/reviews')
			.then((r) => current && setReviews(r.reviews))
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit]);

	if (error) return <div id="reviewsBox"><ErrorNotice message={error} /></div>;
	if (!reviews) return <div id="reviewsBox"><Skeleton height={180} /></div>;

	const tab = TABS.find(([key]) => key === filter) ?? TABS[0];
	const list = reviews.filter(tab[2]);
	const replace = (updated: Review) => setReviews((all) => (all ?? []).map((r) => (r.id === updated.id ? updated : r)));

	const toggle = async (review: Review) => {
		setBusyId(review.id);
		try {
			const { review: updated } = await adminApi<{ review: Review }>(`/api/admin/reviews/${review.id}`, { method: 'PATCH', body: { visible: !review.visible } });
			replace(updated);
			show(updated.visible ? 'نظر در سایت نمایش داده می‌شود.' : 'نظر مخفی شد.', 'ok');
		} catch (err) {
			show(errorText(err));
		} finally {
			setBusyId(null);
		}
	};

	const remove = async (review: Review) => {
		if (!window.confirm('این نظر برای همیشه حذف شود؟')) return;
		setBusyId(review.id);
		try {
			await adminApi(`/api/admin/reviews/${review.id}`, { method: 'DELETE' });
			setReviews((all) => (all ?? []).filter((r) => r.id !== review.id));
			show('نظر حذف شد.', 'ok');
		} catch (err) {
			show(errorText(err));
		} finally {
			setBusyId(null);
		}
	};

	return (
		<div id="reviewsBox">
			<MenuFlash flash={flash} />
			<div className="filter-tabs">
				{TABS.map(([key, label, test]) => (
					<button type="button" key={key} className={`filter-tab${key === tab[0] ? ' active' : ''}`} onClick={() => setFilter(key)}>
						{`${label} (${fa(reviews.filter(test).length)})`}
					</button>
				))}
			</div>
			{list.length ? (
				<div className="review-list">
					{list.map((r) => (
						<article className="report-card review-card" key={r.id}>
							<div className="review-head">
								<strong>{r.name || 'بدون نام'}</strong>
								<span className="review-date">{new Date(r.createdAt).toLocaleDateString('fa-IR', { dateStyle: 'medium' })}</span>
								<span className={`status ${r.visible ? 'CONFIRMED' : 'HOLD'}`}>{r.visible ? 'نمایش داده می‌شود' : 'در انتظار تایید'}</span>
							</div>
							<p className="review-text">{r.text}</p>
							{r.reply && (
								<div className="review-reply">
									<b>پاسخ روف:</b>
									{` ${r.reply}`}
								</div>
							)}
							<div className="review-actions">
								<button type="button" className={r.visible ? 'secondary-btn' : 'primary-btn'} disabled={busyId === r.id} onClick={() => toggle(r)}>
									{r.visible ? ICONS.eyeOff : ICONS.eye}
									<span>{r.visible ? 'مخفی کن' : 'تایید و نمایش'}</span>
								</button>
								<button type="button" className="secondary-btn" onClick={() => setReplying(r)}>
									{ICONS.chat}
									<span>{r.reply ? 'ویرایش پاسخ' : 'پاسخ'}</span>
								</button>
								<button type="button" className="danger-btn" disabled={busyId === r.id} onClick={() => remove(r)}>
									حذف
								</button>
							</div>
						</article>
					))}
				</div>
			) : (
				<EmptyState title="نظری اینجا نیست" text={tab[0] === 'pending' ? 'همه‌ی نظرها بررسی شده‌اند.' : 'هنوز نظری ثبت نشده.'} />
			)}
			{replying && (
				<ReplyForm
					review={replying}
					onClose={() => setReplying(null)}
					onSaved={(updated) => {
						replace(updated);
						show('پاسخ ذخیره شد.', 'ok');
					}}
				/>
			)}
		</div>
	);
}

function ReplyForm({ review, onClose, onSaved }: { review: Review; onClose: () => void; onSaved: (review: Review) => void }) {
	const [reply, setReply] = useState(review.reply ?? '');
	return (
		<MenuModal
			title="پاسخ به نظر"
			submitLabel="ذخیره پاسخ"
			onClose={onClose}
			onSubmit={async () => {
				const { review: updated } = await adminApi<{ review: Review }>(`/api/admin/reviews/${review.id}`, { method: 'PATCH', body: { reply: reply.trim() } });
				onSaved(updated);
			}}
		>
			<div className="notice">{review.text}</div>
			<div className="field">
				<label htmlFor="rReply">پاسخ روف (خالی = حذف پاسخ)</label>
				<textarea id="rReply" name="reply" rows={4} maxLength={500} value={reply} onChange={(e) => setReply(e.target.value)}></textarea>
			</div>
		</MenuModal>
	);
}
