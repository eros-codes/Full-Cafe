import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../../shared/api';
import { faDigits, faNumber, toman } from '../../shared/format';
import { ICONS, type IconName } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { BarChart, RankBars, amountScale } from '../common/charts';
import { CountUp } from '../common/motion';
import { ErrorNotice, Skeleton, ZONE_FA, faCount, fa, tomanScale } from '../common/ui';

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

// noon UTC of that day: the weekday is right in any time zone
const dayDate = (date: string) => new Date(`${date}T12:00:00Z`);

function Stat({ icon, label, value, unit }: { icon: IconName; label: string; value: ReactNode; unit?: string }) {
	return (
		<div className="stat">
			<div className="stat-top">
				<span className="stat-label">{label}</span>
				<span className="stat-icon">{ICONS[icon]}</span>
			</div>
			<div className="stat-value">
				{value}
				{unit && <small>{unit}</small>}
			</div>
		</div>
	);
}

/**
 * Paid revenue, how bookings ended, the last seven days and the most booked tables. Read again on every visit
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
	if (!report) {
		return (
			<div className="dash-grid">
				<div className="card card-pad span-3">
					<Skeleton height={120} />
				</div>
				<div className="card card-pad span-2">
					<Skeleton height={240} />
				</div>
				<div className="card card-pad">
					<Skeleton height={240} />
				</div>
			</div>
		);
	}

	const scale = amountScale(Math.max(...report.daily.map((d) => d.amount)));
	const weekTotal = report.daily.reduce((total, d) => total + d.amount, 0);
	const outcomes = [
		{ key: 'upcoming', label: 'پیش‌رو', value: report.upcoming },
		{ key: 'completed', label: 'تکمیل‌شده', value: report.completed },
		{ key: 'noShow', label: 'عدم حضور', value: report.noShow },
		{ key: 'cancelled', label: 'لغوشده', value: report.cancelled },
	];
	const outcomeTotal = outcomes.reduce((total, o) => total + o.value, 0);

	return (
		<>
			{error && <div className="notice danger" style={{ marginBottom: '16px' }}>{`به‌روز نشد: ${error}`}</div>}
			<div className="stat-grid">
				<Stat icon="receipt" label="درآمد کل" value={<CountUp value={report.totalPaid} format={tomanScale(report.totalPaid).format} />} unit={tomanScale(report.totalPaid).unit} />
				<Stat icon="check" label="پرداخت موفق" value={<CountUp value={report.paidCount} format={faCount} />} unit="پرداخت" />
				<Stat
					icon="chart"
					label="میانگین هر رزرو"
					value={<CountUp value={report.avgPerReservation} format={tomanScale(report.avgPerReservation).format} />}
					unit={tomanScale(report.avgPerReservation).unit}
				/>
				<Stat icon="users" label="میانگین نفرات" value={<CountUp value={report.avgGuests} format={(n) => fa(Math.round(n * 10) / 10)} />} unit="نفر" />
			</div>

			<div className="dash-grid">
				<section className="card card-pad span-2" aria-labelledby="reportRevenueTitle">
					<div className="card-head">
						<div>
							<h2 className="card-title" id="reportRevenueTitle">
								درآمد هفت روز اخیر
							</h2>
							<p className="card-sub">{`بر اساس روز رزرو · محور به ${scale.unit}`}</p>
						</div>
						<div className="dash-total">
							<strong>{toman(weekTotal)}</strong>
							<small>جمع هفت روز</small>
						</div>
					</div>
					<BarChart
						label="درآمد هفت روز اخیر"
						points={report.daily.map((d) => ({
							key: d.date,
							label: dayDate(d.date).toLocaleDateString('fa-IR', { weekday: 'short', timeZone: 'UTC' }),
							full: dayDate(d.date).toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }),
							value: d.amount,
						}))}
						format={toman}
						axisFormat={(n) => faNumber(Math.round((n / scale.divisor) * 10) / 10)}
						height={250}
						emptyText="در این هفته پرداختی ثبت نشده."
					/>
				</section>

				<section className="card card-pad" aria-labelledby="reportOutcomeTitle">
					<div className="card-head">
						<div>
							<h2 className="card-title" id="reportOutcomeTitle">
								سرانجام رزروها
							</h2>
							<p className="card-sub">{`${fa(outcomeTotal)} رزرو، از ابتدا`}</p>
						</div>
					</div>
					<RankBars
						label="سرانجام رزروها"
						rows={outcomes.map((o) => ({
							...o,
							text: `${fa(o.value)}${outcomeTotal ? ` · ${faNumber(Math.round((o.value / outcomeTotal) * 100))}٪` : ''}`,
						}))}
					/>
				</section>

				<section className="card card-pad span-3" aria-labelledby="reportTablesTitle">
					<div className="card-head">
						<div>
							<h2 className="card-title" id="reportTablesTitle">
								پرتقاضاترین میزها
							</h2>
							<p className="card-sub">رزروهای تاییدشده، تکمیل‌شده و عدم حضور</p>
						</div>
					</div>
					{report.topTables.length ? (
						<RankBars
							label="پرتقاضاترین میزها"
							rows={report.topTables.map((t, i) => ({
								key: `${t.displayNumber}-${i}`,
								label: `میز ${faDigits(t.displayNumber)}`,
								note: ZONE_FA[t.zone] ?? '',
								value: t.count,
								text: `${fa(t.count)} رزرو`,
							}))}
						/>
					) : (
						<p className="hint">هنوز رزروی ثبت نشده.</p>
					)}
				</section>
			</div>
		</>
	);
}
