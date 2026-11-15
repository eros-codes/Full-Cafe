import { useEffect, useState, type ReactNode } from 'react';
import { errorText } from '../../shared/api';
import { faDigits, faNumber, toman } from '../../shared/format';
import { ICONS, type IconName } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { BarChart, LineChart, amountScale, type ChartPoint } from '../common/charts';
import { ADMIN_ICONS } from '../common/icons';
import { CountUp } from '../common/motion';
import { ErrorNotice, Skeleton, faCount, fa, tomanScale } from '../common/ui';

interface UpcomingReservation {
	id: string;
	startAt: string;
	customerName: string;
	guestCount: number;
	tables?: { table: { displayNumber: string } }[];
}

interface SeriesDay {
	date: string;
	revenue: number;
	reservations: number;
	guests: number;
	visitors: number;
}

export interface DashboardData {
	actionNeeded: number;
	totalRevenue: number;
	visitorsToday: number;
	reviewsPending: number;
	productsCount: number;
	categoriesCount: number;
	upcoming: UpcomingReservation[];
	today: { reservations: number; guests: number; revenue: number; visitors: number };
	week: { revenue: number; revenuePrev: number; reservations: number; reservationsPrev: number; visitors: number; visitorsPrev: number };
	series: SeriesDay[];
}

export type DashboardTarget = 'reservations' | 'manual' | 'products' | 'categories' | 'reviews' | 'reports';

// noon UTC of the day: the right weekday and date in any time zone
const dayDate = (date: string) => new Date(`${date}T12:00:00Z`);
const shortDay = (date: string) =>
	`${dayDate(date).toLocaleDateString('fa-IR', { weekday: 'narrow', timeZone: 'UTC' })} ${dayDate(date).toLocaleDateString('fa-IR', { day: 'numeric', timeZone: 'UTC' })}`;
const fullDay = (date: string) => dayDate(date).toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });

function points(series: SeriesDay[], field: 'revenue' | 'reservations' | 'visitors'): ChartPoint[] {
	return series.map((d) => ({ key: d.date, label: shortDay(d.date), full: fullDay(d.date), value: d[field] }));
}

/** This week against the one before: «▲ ۱۲٪», «▼ ۵٪», or «بدون تغییر». */
function Delta({ now, before }: { now: number; before: number }) {
	if (!before && !now) return <span className="delta flat">بدون تغییر</span>;
	if (!before) return <span className="delta up">{ADMIN_ICONS.trendUp}جدید</span>;
	const change = Math.round(((now - before) / before) * 100);
	if (change === 0) return <span className="delta flat">بدون تغییر</span>;
	const up = change > 0;
	return (
		<span className={`delta ${up ? 'up' : 'down'}`} title={up ? 'بیشتر از هفته‌ی قبل' : 'کمتر از هفته‌ی قبل'}>
			{up ? ADMIN_ICONS.trendUp : ADMIN_ICONS.trendDown}
			<bdi>{`${faNumber(Math.abs(change))}٪`}</bdi>
		</span>
	);
}

function Stat({ icon, label, value, unit, foot, alert = false }: { icon: IconName; label: string; value: ReactNode; unit?: string; foot?: ReactNode; alert?: boolean }) {
	return (
		<div className={`stat${alert ? ' is-alert' : ''}`}>
			<div className="stat-top">
				<span className="stat-label">{label}</span>
				<span className="stat-icon">{ICONS[icon]}</span>
			</div>
			<div className="stat-value">
				{value}
				{unit && <small>{unit}</small>}
			</div>
			{foot && <div className="stat-foot">{foot}</div>}
		</div>
	);
}

function Agenda({ rows }: { rows: UpcomingReservation[] }) {
	if (!rows.length) {
		return (
			<div className="agenda-empty">
				{ICONS.calendar}
				<span>رزرو دیگری برای امروز باقی نمانده.</span>
			</div>
		);
	}
	return (
		<ul className="agenda">
			{rows.map((r) => {
				const time = new Date(r.startAt).toLocaleTimeString('fa-IR', { hour: '2-digit', minute: '2-digit' });
				const tables = (r.tables || []).map((t) => t.table.displayNumber).join(' و ') || '—';
				return (
					<li key={r.id}>
						<span className="agenda-time">{time}</span>
						<span className="agenda-who">
							<strong>{r.customerName}</strong>
							<small>
								{'میز '}
								<bdi>{faDigits(tables)}</bdi>
							</small>
						</span>
						<span className="agenda-guests">{`${fa(r.guestCount)} نفر`}</span>
					</li>
				);
			})}
		</ul>
	);
}

function DashboardSkeleton() {
	return (
		<>
			<div className="stat-grid">
				{Array.from({ length: 4 }, (_, i) => (
					<div className="stat" key={i}>
						<div className="skeleton" style={{ height: '14px', width: '55%', marginBottom: '18px' }}></div>
						<div className="skeleton" style={{ height: '26px', width: '45%' }}></div>
					</div>
				))}
			</div>
			<div className="dash-grid">
				<div className="card card-pad span-2">
					<Skeleton height={250} />
				</div>
				<div className="card card-pad">
					<Skeleton height={250} />
				</div>
			</div>
		</>
	);
}

/**
 * Today at a glance: what needs attention, today's bookings and guests, this week's revenue and visits against
 * last week, two weeks of charts, the rest of today's bookings and shortcuts to the menu and the reviews.
 * Read again on every visit (a panel left open since the morning showed the morning's numbers) and after a
 * booking changes; the numbers on screen stay until the new ones arrive.
 */
export function Dashboard({
	reloadKey,
	visit,
	onData,
	onOpen,
}: {
	reloadKey: number;
	visit: number;
	/** The counts for the side menu (bookings to check, reviews to approve). */
	onData?: (data: DashboardData) => void;
	onOpen: (section: DashboardTarget) => void;
}) {
	const [data, setData] = useState<DashboardData | null>(null);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let current = true;
		adminApi<DashboardData>('/api/admin/dashboard')
			.then((d) => {
				if (!current) return;
				setData(d);
				setError(null);
				onData?.(d);
			})
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
		// onData is a state setter of the panel: stable, so not a reason to read again
	}, [reloadKey, visit]);

	if (error && !data) return <ErrorNotice message={error} />;
	if (!data) return <DashboardSkeleton />;

	const { today, week, series } = data;
	const revenueScale = amountScale(Math.max(...series.map((d) => d.revenue)));
	const fortnightRevenue = series.reduce((total, d) => total + d.revenue, 0);
	const fortnightBookings = series.reduce((total, d) => total + d.reservations, 0);
	const fortnightVisits = series.reduce((total, d) => total + d.visitors, 0);
	const amountAxis = (n: number) => faNumber(Math.round((n / revenueScale.divisor) * 10) / 10);

	return (
		<div id="dashboardBox">
			{error && <div className="notice danger" style={{ marginBottom: '16px' }}>{`به‌روز نشد: ${error}`}</div>}

			<div className="stat-grid">
				<Stat
					icon="stop"
					label="نیازمند بررسی"
					value={<CountUp value={data.actionNeeded} format={faCount} />}
					unit="رزرو"
					alert={data.actionNeeded > 0}
					foot={
						data.actionNeeded > 0 ? (
							<button type="button" className="stat-link" onClick={() => onOpen('reservations')}>
								بررسی رزروها
								{ADMIN_ICONS.chevronLeft}
							</button>
						) : (
							<span>همه‌چیز مرتب است.</span>
						)
					}
				/>
				<Stat icon="calendar" label="رزروهای امروز" value={<CountUp value={today.reservations} format={faCount} />} unit="رزرو" foot={<span>{`${fa(today.guests)} مهمان`}</span>} />
				<Stat
					icon="receipt"
					label="درآمد ۷ روز اخیر"
					value={<CountUp value={week.revenue} format={tomanScale(week.revenue).format} />}
					unit={tomanScale(week.revenue).unit}
					foot={
						<>
							<Delta now={week.revenue} before={week.revenuePrev} />
							<span>نسبت به هفته‌ی قبل</span>
						</>
					}
				/>
				<Stat
					icon="users"
					label="بازدیدکننده‌ی امروز"
					value={<CountUp value={data.visitorsToday} format={faCount} />}
					unit="نفر"
					foot={
						<>
							<Delta now={week.visitors} before={week.visitorsPrev} />
							<span>{`${fa(week.visitors)} نفر در ۷ روز`}</span>
						</>
					}
				/>
			</div>

			<div className="dash-grid">
				<section className="card card-pad span-2" aria-labelledby="dashRevenueTitle">
					<div className="card-head">
						<div>
							<h2 className="card-title" id="dashRevenueTitle">
								درآمد ۱۴ روز اخیر
							</h2>
							<p className="card-sub">{`بر اساس روز رزرو · محور به ${revenueScale.unit}`}</p>
						</div>
						<div className="dash-total">
							<strong>{toman(fortnightRevenue)}</strong>
							<small>جمع دو هفته</small>
						</div>
					</div>
					<BarChart label="درآمد ۱۴ روز اخیر" points={points(series, 'revenue')} format={toman} axisFormat={amountAxis} height={240} emptyText="در این دو هفته پرداختی ثبت نشده." />
				</section>

				<section className="card card-pad" aria-labelledby="dashAgendaTitle">
					<div className="card-head">
						<div>
							<h2 className="card-title" id="dashAgendaTitle">
								ادامه‌ی امروز
							</h2>
							<p className="card-sub">رزروهای تاییدشده‌ای که ساعتشان نرسیده</p>
						</div>
						<button type="button" className="secondary-btn" onClick={() => onOpen('manual')}>
							{ICONS.plus}
							رزرو دستی
						</button>
					</div>
					<Agenda rows={data.upcoming || []} />
				</section>

				<section className="card card-pad" aria-labelledby="dashBookingsTitle">
					<div className="card-head">
						<div>
							<h2 className="card-title" id="dashBookingsTitle">
								رزروها
							</h2>
							<p className="card-sub">هر روز، ۱۴ روز اخیر</p>
						</div>
						<div className="dash-total">
							<strong>{fa(fortnightBookings)}</strong>
							<small>
								<Delta now={week.reservations} before={week.reservationsPrev} />
							</small>
						</div>
					</div>
					<BarChart label="تعداد رزروها در ۱۴ روز اخیر" points={points(series, 'reservations')} format={(n) => `${fa(n)} رزرو`} height={190} />
				</section>

				<section className="card card-pad" aria-labelledby="dashVisitsTitle">
					<div className="card-head">
						<div>
							<h2 className="card-title" id="dashVisitsTitle">
								بازدید سایت
							</h2>
							<p className="card-sub">بازدیدکننده‌ی یکتا در روز</p>
						</div>
						<div className="dash-total">
							<strong>{fa(fortnightVisits)}</strong>
							<small>جمع دو هفته</small>
						</div>
					</div>
					<LineChart label="بازدیدکننده‌های سایت در ۱۴ روز اخیر" points={points(series, 'visitors')} format={(n) => `${fa(n)} نفر`} height={190} />
				</section>

				<section className="card card-pad" aria-labelledby="dashQuickTitle">
					<div className="card-head">
						<h2 className="card-title" id="dashQuickTitle">
							منو و نظرات
						</h2>
					</div>
					<div className="quick-list">
						<button type="button" className={`quick-item${data.reviewsPending ? ' is-alert' : ''}`} onClick={() => onOpen('reviews')}>
							<span className="stat-icon">{ICONS.chat}</span>
							<span className="quick-text">
								<span>نظرات در انتظار تایید</span>
								<strong>{fa(data.reviewsPending)}</strong>
							</span>
							{ADMIN_ICONS.chevronLeft}
						</button>
						<button type="button" className="quick-item" onClick={() => onOpen('products')}>
							<span className="stat-icon">{ICONS.cup}</span>
							<span className="quick-text">
								<span>محصولات منو</span>
								<strong>{fa(data.productsCount)}</strong>
							</span>
							{ADMIN_ICONS.chevronLeft}
						</button>
						<button type="button" className="quick-item" onClick={() => onOpen('categories')}>
							<span className="stat-icon">{ICONS.tag}</span>
							<span className="quick-text">
								<span>دسته‌بندی‌های منو</span>
								<strong>{fa(data.categoriesCount)}</strong>
							</span>
							{ADMIN_ICONS.chevronLeft}
						</button>
						<button type="button" className="quick-item" onClick={() => onOpen('reports')}>
							<span className="stat-icon">{ICONS.chart}</span>
							<span className="quick-text">
								<span>درآمد کل رزروها</span>
								<strong>{toman(data.totalRevenue)}</strong>
							</span>
							{ADMIN_ICONS.chevronLeft}
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
