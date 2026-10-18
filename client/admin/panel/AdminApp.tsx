import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, errorText } from '../../shared/api';
import { ICONS, type IconName } from '../../shared/icons';
import { Topbar } from '../../reserve/common/Topbar';
import type { MapTable } from '../../reserve/map/types';
import { LOGIN_URL, adminApi } from '../common/adminApi';
import { ROLE_FA, can, type Admin } from '../common/roles';
import { AddOns } from '../sections/AddOns';
import { Admins } from '../sections/Admins';
import { Categories } from '../sections/Categories';
import { Closures } from '../sections/Closures';
import { Dashboard } from '../sections/Dashboard';
import { Hours } from '../sections/Hours';
import { ManualBooking } from '../sections/ManualBooking';
import { MenuTypes } from '../sections/MenuTypes';
import { Products } from '../sections/Products';
import { Reports } from '../sections/Reports';
import { Reservations } from '../sections/Reservations';
import { Reviews } from '../sections/Reviews';
import { Settings } from '../sections/Settings';
import { TableEditorDialog } from '../sections/TableEditorDialog';
import { Tables, type TableDialogTarget } from '../sections/Tables';

type SectionKey =
	| 'dashboard'
	| 'reservations'
	| 'manual'
	| 'tables'
	| 'products'
	| 'addons'
	| 'categories'
	| 'menuTypes'
	| 'reviews'
	| 'hours'
	| 'closures'
	| 'settings'
	| 'reports'
	| 'admins';

const SECTIONS: { key: SectionKey; label: string; icon: IconName }[] = [
	{ key: 'dashboard', label: 'داشبورد امروز', icon: 'home' },
	{ key: 'reservations', label: 'رزروها', icon: 'list' },
	{ key: 'manual', label: 'رزرو دستی', icon: 'plus' },
	{ key: 'tables', label: 'مدیریت میزها', icon: 'table' },
	{ key: 'products', label: 'محصولات منو', icon: 'cup' },
	{ key: 'addons', label: 'افزودنی‌ها', icon: 'addOn' },
	{ key: 'categories', label: 'دسته‌بندی منو', icon: 'tag' },
	{ key: 'menuTypes', label: 'دسته‌های اصلی منو', icon: 'layers' },
	{ key: 'reviews', label: 'نظرات', icon: 'chat' },
	{ key: 'hours', label: 'ساعت کاری', icon: 'clock' },
	{ key: 'closures', label: 'تعطیلی‌ها', icon: 'ban' },
	{ key: 'settings', label: 'قیمت و تنظیمات', icon: 'gear' },
	{ key: 'reports', label: 'گزارش‌ها', icon: 'chart' },
	{ key: 'admins', label: 'مدیریت ادمین‌ها', icon: 'shield' },
];

/** What a secondary admin (staff) sees; the rest is for the café manager and the developer. */
const STAFF_SECTIONS: SectionKey[] = ['reservations', 'manual', 'tables', 'products', 'addons', 'categories', 'reviews'];

/** Sections that load on first open and stay as they are afterwards (the menu sections reload on every open). */
const MOUNTED_FROM_START: SectionKey[] = ['dashboard', 'reservations', 'manual', 'tables'];

function Section({ id, active, title, hint, children }: { id: SectionKey; active: boolean; title: string; hint?: string; children?: ReactNode }) {
	return (
		<div id={id} className={`admin-section${active ? ' active' : ''}`}>
			<h3>
				{title}
				{hint && <span className="hint">{hint}</span>}
			</h3>
			{children}
		</div>
	);
}

export function AdminApp() {
	const [admin, setAdmin] = useState<Admin | null>(null);
	const [fatal, setFatal] = useState<string | null>(null);
	const [active, setActive] = useState<SectionKey>('dashboard');
	// how many times each section was opened: 0 = never (not mounted yet); the menu sections reload when it changes
	const [visits, setVisits] = useState<Partial<Record<SectionKey, number>>>({});
	const [tables, setTables] = useState<MapTable[]>([]);
	const [dashboardKey, setDashboardKey] = useState(0);
	const [reservationsKey, setReservationsKey] = useState(0);
	const [dialog, setDialog] = useState<TableDialogTarget>(null);

	const isMain = can(admin, 'manager');
	const canEditMap = can(admin, 'mapEditor');
	const canToggleTables = can(admin, 'tableToggle');
	const sections = admin ? (isMain ? SECTIONS : SECTIONS.filter((s) => STAFF_SECTIONS.includes(s.key))) : [];

	const loadTables = useCallback(async () => {
		const { tables: list } = await adminApi<{ tables: MapTable[] }>('/api/admin/tables');
		setTables(list);
	}, []);

	useEffect(() => {
		let current = true;
		api<{ admin: Admin }>('/api/admin/me').then(
			({ admin: me }) => {
				if (!current) return;
				setAdmin(me);
				const first: SectionKey = can(me, 'manager') ? 'dashboard' : 'reservations';
				setActive(first);
				setVisits({ [first]: 1 });
				loadTables().catch((error) => current && setFatal(errorText(error)));
			},
			// بدون نشست معتبر (یا هر خطای دیگری در شناسایی ادمین) جای پنل، صفحه‌ی ورود است
			() => {
				if (current) window.location.href = LOGIN_URL;
			},
		);
		return () => {
			current = false;
		};
	}, [loadTables]);

	const open = (key: SectionKey) => {
		setActive(key);
		setVisits((v) => ({ ...v, [key]: (v[key] ?? 0) + 1 }));
	};

	const reloadTables = useCallback(async () => {
		try {
			await loadTables();
			setFatal(null);
		} catch (error) {
			setFatal(errorText(error));
		}
	}, [loadTables]);

	const closeDialog = useCallback(() => setDialog(null), []);

	const logout = async () => {
		try {
			await api('/api/admin/logout', { method: 'POST' });
		} catch (error) {
			console.warn('خروج با خطا مواجه شد:', error);
		}
		window.location.href = LOGIN_URL;
	};

	const shown = (key: SectionKey) => Boolean(admin && sections.some((s) => s.key === key) && (MOUNTED_FROM_START.includes(key) || visits[key]));
	const visit = (key: SectionKey) => visits[key] ?? 0;

	const tablesHint = canEditMap
		? 'رو میز کلیک کن برای ویرایش/حذف؛ برای جابه‌جایی بگیر و بکش.'
		: canToggleTables
			? 'نقشه فقط با حساب توسعه‌دهنده تغییر می‌کند؛ از فهرست پایین می‌توانی میزها را فعال یا غیرفعال کنی.'
			: 'نقشه و فهرست میزها فقط برای مشاهده است.';

	return (
		<>
			<main className="shell">
				<Topbar href="/" sub={admin ? `${admin.name} · ${ROLE_FA[admin.role] || admin.role}` : 'در حال بارگذاری...'} subId="adminInfo">
					<a href="/">سایت</a>
					<button id="adminLogout" onClick={logout}>
						خروج
					</button>
				</Topbar>

				<section className="admin-layout" style={{ marginTop: '22px' }}>
					<nav className="admin-menu" id="adminMenu" aria-label="بخش‌های پنل مدیریت">
						{sections.map((section) => (
							<button key={section.key} data-section={section.key} className={section.key === active ? 'active' : ''} onClick={() => open(section.key)}>
								{ICONS[section.icon]}
								<span>{section.label}</span>
							</button>
						))}
					</nav>
					<section className="card card-pad admin-content">
						{fatal && <div className="notice danger">{fatal}</div>}
						<Section id="dashboard" active={active === 'dashboard'} title="داشبورد امروز">
							{shown('dashboard') ? <Dashboard reloadKey={dashboardKey} /> : <div id="dashboardBox" className="kpi-grid"></div>}
						</Section>
						{admin && (
							<>
								<Section id="reservations" active={active === 'reservations'} title="رزروها">
									{shown('reservations') && (
										<Reservations isMain={isMain} reloadKey={reservationsKey} onChanged={() => setDashboardKey((k) => k + 1)} />
									)}
								</Section>
								<Section id="manual" active={active === 'manual'} title="ثبت رزرو دستی" hint="این رزرو بلافاصله تایید‌شده و پرداخت‌شده ثبت می‌شود.">
									{shown('manual') && (
										<ManualBooking
											tables={tables}
											onCreated={() => {
												setReservationsKey((k) => k + 1);
												if (isMain) setDashboardKey((k) => k + 1);
											}}
										/>
									)}
								</Section>
								<Section id="tables" active={active === 'tables'} title="مدیریت میزها" hint={tablesHint}>
									{shown('tables') && (
										<Tables tables={tables} canEditMap={canEditMap} canToggleTables={canToggleTables} reload={reloadTables} openDialog={setDialog} />
									)}
								</Section>
								<Section id="products" active={active === 'products'} title="محصولات منو" hint="آیتم‌هایی که در صفحه‌ی منوی سایت نمایش داده می‌شوند.">
									{shown('products') && <Products visit={visit('products')} />}
								</Section>
								<Section
									id="addons"
									active={active === 'addons'}
									title="افزودنی‌ها"
									hint="گزینه‌هایی مثل شات اضافه یا شیر گیاهی؛ یک بار بساز و از فرم هر محصول وصلش کن. افزودنی غیرفعال در منو دیده نمی‌شود."
								>
									{shown('addons') && <AddOns visit={visit('addons')} />}
								</Section>
								<Section id="categories" active={active === 'categories'} title="دسته‌بندی‌های منو" hint="هر دسته زیر یکی از دسته‌های اصلی منو (مثل کافه یا صبحانه) قرار می‌گیرد.">
									{shown('categories') && <Categories visit={visit('categories')} />}
								</Section>
								{isMain && (
									<Section
										id="menuTypes"
										active={active === 'menuTypes'}
										title="دسته‌های اصلی منو"
										hint="تب‌های بالای صفحه‌ی منو (کافه، صبحانه، …). ترتیب این فهرست همان ترتیب تب‌هاست؛ دسته‌ی مخفی با همه‌ی محصولاتش در سایت دیده نمی‌شود."
									>
										{shown('menuTypes') && <MenuTypes visit={visit('menuTypes')} />}
									</Section>
								)}
								<Section id="reviews" active={active === 'reviews'} title="نظرات مشتریان" hint="نظرها بعد از تایید شما در صفحه‌ی «ثبت نظر» سایت نمایش داده می‌شوند.">
									{shown('reviews') && <Reviews visit={visit('reviews')} />}
								</Section>
								{isMain && (
									<>
										<Section id="hours" active={active === 'hours'} title="ساعت کاری" hint="برای بسته شدن در نیمه‌شب 24:00 بنویس؛ ساعت کاری بعد از نیمه‌شب پشتیبانی نمی‌شود.">
											<div id="hoursBox">{shown('hours') && <Hours />}</div>
										</Section>
										<Section id="closures" active={active === 'closures'} title="تعطیلی‌ها و بلاک‌ها">
											<div id="closuresBox">{shown('closures') && <Closures tables={tables} />}</div>
										</Section>
										<Section id="settings" active={active === 'settings'} title="قیمت و تنظیمات">
											<div id="settingsBox">{shown('settings') && <Settings />}</div>
										</Section>
										<Section id="reports" active={active === 'reports'} title="گزارش‌ها">
											<div id="reportsBox" className="kpi-grid">
												{shown('reports') && <Reports />}
											</div>
										</Section>
										<Section id="admins" active={active === 'admins'} title="مدیریت ادمین‌ها">
											{shown('admins') && <Admins me={admin} />}
										</Section>
									</>
								)}
							</>
						)}
					</section>
				</section>
			</main>
			{canEditMap && (
				<TableEditorDialog
					target={dialog}
					allTables={tables}
					onClose={closeDialog}
					onSaved={reloadTables}
					onDeleted={reloadTables}
				/>
			)}
		</>
	);
}
