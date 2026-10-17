import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { toman } from '../../shared/format';
import { adminApi } from '../common/adminApi';
import { ErrorNotice, Kpi, SkeletonKpis, fa } from '../common/ui';

interface UpcomingReservation {
	id: string;
	startAt: string;
	customerName: string;
	guestCount: number;
	tables?: { table: { displayNumber: string } }[];
}

interface DashboardData {
	actionNeeded: number;
	totalRevenue: number;
	visitorsToday: number;
	reviewsPending: number;
	productsCount: number;
	categoriesCount: number;
	upcoming: UpcomingReservation[];
}

function UpcomingList({ rows }: { rows: UpcomingReservation[] }) {
	if (!rows.length) {
		return (
			<div className="report-card">
				<h4>رزروهای پیش‌روی امروز</h4>
				<p className="hint">رزرو دیگری برای امروز باقی نمانده.</p>
			</div>
		);
	}
	return (
		<div className="report-card">
			<h4>رزروهای پیش‌روی امروز</h4>
			{rows.map((r) => {
				const time = new Date(r.startAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
				const tables = (r.tables || []).map((t) => t.table.displayNumber).join(' و ') || '—';
				return (
					<div className="detail-row" key={r.id}>
						<span>
							<b>{time}</b>
							{` · ${r.customerName}`}
						</span>
						<span>
							{'میز '}
							<bdi>{tables}</bdi>
							{' · '}
							<bdi>{`${fa(r.guestCount)} نفر`}</bdi>
						</span>
					</div>
				);
			})}
		</div>
	);
}

/** Today at a glance: what needs attention, revenue, visitors, menu numbers and the rest of today's bookings. */
export function Dashboard({ reloadKey }: { reloadKey: number }) {
	const [data, setData] = useState<DashboardData | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let current = true;
		setData(null);
		setError(null);
		adminApi<DashboardData>('/api/admin/dashboard')
			.then((d) => current && setData(d))
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [reloadKey]);

	return (
		<div id="dashboardBox" className="kpi-grid">
			{error ? (
				<ErrorNotice message={error} />
			) : !data ? (
				<SkeletonKpis count={6} />
			) : (
				<>
					<Kpi icon="stop" label="رزروهای نیازمند بررسی" value={fa(data.actionNeeded)} />
					<Kpi icon="receipt" label="درآمد کل رزرو" value={toman(data.totalRevenue)} />
					<Kpi icon="users" label="بازدیدکننده‌ی امروز" value={fa(data.visitorsToday)} />
					<Kpi icon="chat" label="نظرات در انتظار تایید" value={fa(data.reviewsPending)} />
					<Kpi icon="cup" label="محصولات منو" value={fa(data.productsCount)} />
					<Kpi icon="tag" label="دسته‌بندی‌های منو" value={fa(data.categoriesCount)} />
					<UpcomingList rows={data.upcoming || []} />
				</>
			)}
		</div>
	);
}
