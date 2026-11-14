import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { toman } from '../../shared/format';
import { adminApi } from '../common/adminApi';
import { ErrorNotice, Kpi, SkeletonKpis, fa } from '../common/ui';

interface Report {
	totalPaid: number;
	paidCount: number;
	avgPerReservation: number;
	avgGuests: number;
	upcoming: number;
	completed: number;
	cancelled: number;
	noShow: number;
	daily: { date: string; amount: number }[];
	topTables: { displayNumber: string; zone: string; count: number }[];
}

function RevenueChart({ daily }: { daily: Report['daily'] }) {
	const max = Math.max(...daily.map((d) => d.amount), 1);
	return (
		<div className="report-card">
			<h4>درآمد هفت روز اخیر (بر اساس روز رزرو)</h4>
			<div className="chart-wrap">
				{daily.map((d) => {
					const height = Math.round((d.amount / max) * 100);
					return (
						<div className="chart-col" key={d.date}>
							<div className="chart-bar" style={{ height: `${height || 2}%` }} title={toman(d.amount)}></div>
							{/* noon UTC of that day: the weekday is right in any time zone */}
							<span className="chart-label">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString('fa-IR', { weekday: 'short', timeZone: 'UTC' })}</span>
						</div>
					);
				})}
			</div>
		</div>
	);
}

function TopTables({ rows }: { rows: Report['topTables'] }) {
	if (!rows.length) return null;
	return (
		<div className="report-card">
			<h4>پرتقاضاترین میزها</h4>
			{rows.map((t, i) => (
				<div className="detail-row" key={i}>
					<span>{`میز ${t.displayNumber}`}</span>
					<span>{`${fa(t.count)} رزرو`}</span>
				</div>
			))}
		</div>
	);
}

/**
 * Paid revenue, booking outcomes, the last seven days and the most booked tables. Read again on every visit
 * (before: once per page load, so a payment made meanwhile never showed until the page was reloaded).
 */
export function Reports({ visit }: { visit: number }) {
	const [report, setReport] = useState<Report | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let current = true;
		adminApi<Report>('/api/admin/reports/revenue')
			.then((r) => {
				if (!current) return;
				setReport(r);
				setError(null);
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit]);

	if (error && !report) return <ErrorNotice message={error} />;
	if (!report) return <SkeletonKpis count={4} />;

	return (
		<>
			{error && (
				<div className="notice danger" style={{ gridColumn: '1 / -1' }}>
					{`به‌روز نشد: ${error}`}
				</div>
			)}
			<Kpi icon="receipt" label="درآمد کل" value={toman(report.totalPaid)} />
			<Kpi icon="check" label="پرداخت موفق" value={fa(report.paidCount)} />
			<Kpi icon="chart" label="میانگین هر رزرو" value={toman(report.avgPerReservation)} />
			<Kpi icon="users" label="میانگین نفرات" value={fa(report.avgGuests)} />
			<Kpi icon="calendar" label="رزروهای پیش‌رو" value={fa(report.upcoming)} />
			<Kpi icon="check" label="تکمیل‌شده" value={fa(report.completed)} />
			<Kpi icon="x" label="لغوشده" value={fa(report.cancelled)} />
			<Kpi icon="ban" label="عدم حضور" value={fa(report.noShow)} />
			<RevenueChart daily={report.daily} />
			<TopTables rows={report.topTables} />
		</>
	);
}
