import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { ApiError, api, errorText } from '../../shared/api';
import { BRAND } from '../../shared/brand';
import { ICONS, type IconName } from '../../shared/icons';
import type { MapTable } from '../../reserve/map/types';
import { LOGIN_URL, adminApi } from '../common/adminApi';
import { ADMIN_ICONS } from '../common/icons';
import { OwnPasswordDialog } from '../common/OwnPasswordDialog';
import { ROLE_FA, can, type Admin } from '../common/roles';
import { useTheme } from '../common/theme';
import { WaiterCallBell, WaiterCallToasts, useWaiterCalls } from '../common/WaiterCalls';
import { Notice, Skeleton, useFlash } from '../common/ui';
import { AddOns } from '../sections/AddOns';
import { Admins } from '../sections/Admins';
import { Categories } from '../sections/Categories';
import { Closures } from '../sections/Closures';
import { Dashboard, type DashboardData } from '../sections/Dashboard';
import { Games } from '../sections/Games';
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
import { Tags } from '../sections/Tags';

type SectionKey =
	| 'dashboard'
	| 'reservations'
	| 'manual'
	| 'tables'
	| 'products'
	| 'addons'
	| 'categories'
	| 'menuTypes'
	| 'tags'
	| 'games'
	| 'reviews'
	| 'hours'
	| 'closures'
	| 'settings'
	| 'reports'
	| 'admins';

interface SectionInfo {
	key: SectionKey;
	/** In the side menu. */
	label: string;
	/** The page title in the top bar. */
	title: string;
	icon: IconName;
	/** A short explanation above the section. */
	hint?: string;
}

const NAV: { group: string; sections: SectionInfo[] }[] = [
	{
		group: 'عملیات',
		sections: [
			{ key: 'dashboard', label: 'داشبورد', title: 'داشبورد امروز', icon: 'home' },
			{ key: 'reservations', label: 'رزروها', title: 'رزروها', icon: 'list' },
			{ key: 'manual', label: 'رزرو دستی', title: 'ثبت رزرو دستی', icon: 'plus', hint: 'این رزرو بلافاصله تایید‌شده و پرداخت‌شده ثبت می‌شود.' },
			{ key: 'tables', label: 'میزها و نقشه', title: 'مدیریت میزها', icon: 'table' },
		],
	},
	{
		group: 'منو',
		sections: [
			{ key: 'products', label: 'محصولات', title: 'محصولات منو', icon: 'cup', hint: 'آیتم‌هایی که در صفحه‌ی منوی سایت نمایش داده می‌شوند.' },
			{
				key: 'addons',
				label: 'افزودنی‌ها',
				title: 'افزودنی‌ها',
				icon: 'addOn',
				hint: 'گزینه‌هایی مثل شات اضافه یا شیر گیاهی؛ یک بار بساز و از فرم هر محصول وصلش کن. افزودنی غیرفعال در منو دیده نمی‌شود.',
			},
			{ key: 'categories', label: 'دسته‌بندی‌ها', title: 'دسته‌بندی‌های منو', icon: 'tag', hint: 'هر دسته زیر یکی از دسته‌های اصلی منو (مثل کافه یا صبحانه) قرار می‌گیرد.' },
			{
				key: 'menuTypes',
				label: 'دسته‌های اصلی',
				title: 'دسته‌های اصلی منو',
				icon: 'layers',
				hint: 'تب‌های بالای صفحه‌ی منو (کافه، صبحانه، …). ترتیب این فهرست همان ترتیب تب‌هاست؛ دسته‌ی مخفی با همه‌ی محصولاتش در سایت دیده نمی‌شود.',
			},
			{
				key: 'tags',
				label: 'انتخاب برای من',
				title: 'انتخاب برای من: سوال‌ها و برچسب‌ها',
				icon: 'spark',
				hint: 'سوال‌هایی که از مشتری پرسیده می‌شود و گزینه‌هایشان. هر محصول برچسب‌هایش را از دسته‌اش می‌گیرد و می‌تواند برچسب‌های خودش را هم داشته باشد.',
			},
		],
	},
	{
		group: 'سایت',
		sections: [
			{ key: 'games', label: 'بازی‌ها', title: 'بازی‌ها', icon: 'dice', hint: 'صفحه‌ی بازی‌های دورهمی سایت (/games): بازی‌هایی که نمایش داده می‌شوند و کارت‌های بازی‌های کلمه‌ای.' },
			{ key: 'reviews', label: 'نظرات', title: 'نظرات مشتریان', icon: 'chat', hint: 'نظرها بعد از تایید شما در صفحه‌ی «ثبت نظر» سایت نمایش داده می‌شوند.' },
		],
	},
	{
		group: 'کافه',
		sections: [
			{ key: 'hours', label: 'ساعت کاری', title: 'ساعت کاری', icon: 'clock', hint: 'برای بسته شدن در نیمه‌شب 24:00 بنویس؛ ساعت کاری بعد از نیمه‌شب پشتیبانی نمی‌شود.' },
			{ key: 'closures', label: 'تعطیلی‌ها', title: 'تعطیلی‌ها و بلاک‌ها', icon: 'ban' },
			{ key: 'settings', label: 'قیمت و تنظیمات', title: 'قیمت و تنظیمات', icon: 'gear' },
			{ key: 'reports', label: 'گزارش‌ها', title: 'گزارش‌ها', icon: 'chart' },
			{ key: 'admins', label: 'ادمین‌ها', title: 'مدیریت ادمین‌ها', icon: 'shield' },
		],
	},
];

const ALL_SECTIONS = NAV.flatMap((g) => g.sections);
const GROUP_OF = Object.fromEntries(NAV.flatMap((g) => g.sections.map((s) => [s.key, g.group]))) as Record<SectionKey, string>;

/** What a secondary admin (staff) sees; the rest is for the café manager and the developer. */
const STAFF_SECTIONS: SectionKey[] = ['reservations', 'manual', 'tables', 'products', 'addons', 'categories', 'reviews'];

/** Sections that load on first open and stay as they are afterwards (the menu sections reload on every open). */
const MOUNTED_FROM_START: SectionKey[] = ['dashboard', 'reservations', 'manual', 'tables'];

/** Sections that draw their own cards (dashboard, reports, the map); the others sit in one card. */
const PLAIN: SectionKey[] = ['dashboard', 'reports'];

function Section({ info, active, children }: { info: SectionInfo; active: boolean; children?: ReactNode }) {
	return (
		<section id={info.key} className={`admin-section${active ? ' active' : ''}`} aria-label={info.title} hidden={!active}>
			{info.hint && (
				<p className="section-hint">
					{ADMIN_ICONS.info}
					<span>{info.hint}</span>
				</p>
			)}
			{PLAIN.includes(info.key) ? children : <div className="card card-pad">{children}</div>}
		</section>
	);
}

const todayFa = () => new Date().toLocaleDateString('fa-IR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** The account button in the top bar: who is logged in, «تغییر رمز» and «خروج». */
function UserMenu({ admin, onPassword, onLogout }: { admin: Admin; onPassword: () => void; onLogout: () => void }) {
	const [open, setOpen] = useState(false);
	const ref = useRef<HTMLDivElement>(null);
	const role = ROLE_FA[admin.role] || admin.role;

	useEffect(() => {
		if (!open) return;
		const outside = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
		const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
		document.addEventListener('mousedown', outside);
		document.addEventListener('keydown', escape);
		return () => {
			document.removeEventListener('mousedown', outside);
			document.removeEventListener('keydown', escape);
		};
	}, [open]);

	return (
		<div className="adm-user" ref={ref}>
			<button type="button" className="adm-user-btn" id="adminInfo" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={`${admin.name} · ${role}`}>
				<span className="adm-avatar" aria-hidden="true">
					{admin.name.trim().charAt(0) || '؟'}
				</span>
				<span className="adm-user-text">
					<strong>{admin.name}</strong>
					<small>{role}</small>
				</span>
				{ADMIN_ICONS.chevronDown}
			</button>
			{open && (
				<div className="adm-menu" role="menu">
					<div className="adm-menu-head">
						<strong>{admin.name}</strong>
						<small>
							<bdi>{admin.username}</bdi>
							{` · ${role}`}
						</small>
					</div>
					<button
						type="button"
						role="menuitem"
						id="adminPassword"
						onClick={() => {
							setOpen(false);
							onPassword();
						}}
					>
						{ADMIN_ICONS.key}
						تغییر رمز من
					</button>
					<a role="menuitem" href="/" target="_blank" rel="noopener">
						{ADMIN_ICONS.external}
						مشاهده‌ی سایت
					</a>
					<button type="button" role="menuitem" id="adminLogout" className="is-danger" onClick={onLogout}>
						{ADMIN_ICONS.logout}
						خروج از پنل
					</button>
				</div>
			)}
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
	// «تغییر رمز» in the account menu, for every role
	const [passwordOpen, setPasswordOpen] = useState(false);
	// the side menu as a drawer (tablets and phones)
	const [drawer, setDrawer] = useState(false);
	const [scrolled, setScrolled] = useState(false);
	// the counts beside «رزروها» and «نظرات» (from the dashboard, for the manager)
	const [counts, setCounts] = useState<{ action: number; reviews: number } | null>(null);
	const banner = useFlash();
	const { theme, toggle: toggleTheme } = useTheme();
	// «صدا کردن گارسون»: the guests' calls, live (every role)
	const waiterCalls = useWaiterCalls(Boolean(admin));
	const burgerRef = useRef<HTMLButtonElement>(null);
	const navRef = useRef<HTMLElement>(null);
	// the dark pill behind the open section in the side menu: it slides to the next one (placed without sliding the first time)
	const [pill, setPill] = useState<{ top: number; height: number; slide: boolean } | null>(null);
	// identifying the admin failed for another reason than the session (server or connection down)
	const [meError, setMeError] = useState<string | null>(null);
	const [meAttempt, setMeAttempt] = useState(0);

	const isMain = can(admin, 'manager');
	const canEditMap = can(admin, 'mapEditor');
	const canToggleTables = can(admin, 'tableToggle');
	const allowed = (key: SectionKey) => Boolean(admin && (isMain || STAFF_SECTIONS.includes(key)));

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
			(error) => {
				if (!current) return;
				// only a missing or ended session goes to the login page. Before, any error did: with the server or
				// the connection down for a moment, the staff were sent to log in again, and logging in failed too.
				if (error instanceof ApiError && (error.status === 401 || error.status === 403)) window.location.href = LOGIN_URL;
				else setMeError(errorText(error));
			},
		);
		return () => {
			current = false;
		};
	}, [loadTables, meAttempt]);

	// the top bar gets its line once the page is scrolled
	useEffect(() => {
		const onScroll = () => setScrolled(window.scrollY > 4);
		onScroll();
		window.addEventListener('scroll', onScroll, { passive: true });
		return () => window.removeEventListener('scroll', onScroll);
	}, []);

	// the drawer: Escape closes it, the page behind does not scroll, the focus moves in and back
	useEffect(() => {
		if (!drawer) return;
		const escape = (event: KeyboardEvent) => event.key === 'Escape' && setDrawer(false);
		document.addEventListener('keydown', escape);
		document.body.style.overflow = 'hidden';
		navRef.current?.querySelector<HTMLButtonElement>('button.active, button')?.focus();
		const burger = burgerRef.current;
		return () => {
			document.removeEventListener('keydown', escape);
			document.body.style.overflow = '';
			burger?.focus();
		};
	}, [drawer]);

	useLayoutEffect(() => {
		const place = () => {
			const button = navRef.current?.querySelector<HTMLElement>('button.active');
			setPill((before) => (button ? { top: button.offsetTop, height: button.offsetHeight, slide: before !== null } : null));
		};
		place();
		// the menu's font arriving can move the items a little
		document.fonts?.ready.then(place).catch(() => {});
		window.addEventListener('resize', place);
		return () => window.removeEventListener('resize', place);
	}, [active, admin]);

	const open = (key: SectionKey) => {
		setActive(key);
		setVisits((v) => ({ ...v, [key]: (v[key] ?? 0) + 1 }));
		setDrawer(false);
		window.scrollTo({ top: 0 });
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
	const onDashboard = useCallback((d: DashboardData) => setCounts({ action: d.actionNeeded, reviews: d.reviewsPending }), []);

	const logout = async () => {
		try {
			await api('/api/admin/logout', { method: 'POST' });
		} catch (error) {
			console.warn('خروج با خطا مواجه شد:', error);
		}
		window.location.href = LOGIN_URL;
	};

	const shown = (key: SectionKey) => allowed(key) && Boolean(MOUNTED_FROM_START.includes(key) || visits[key]);
	const visit = (key: SectionKey) => visits[key] ?? 0;
	const info = (key: SectionKey) => ALL_SECTIONS.find((s) => s.key === key)!;
	const badge = (key: SectionKey) => (key === 'reservations' ? counts?.action : key === 'reviews' ? counts?.reviews : 0) || 0;

	const tablesInfo: SectionInfo = {
		...info('tables'),
		hint: canEditMap
			? 'رو میز کلیک کن برای ویرایش/حذف؛ برای جابه‌جایی بگیر و بکش.'
			: canToggleTables
				? 'نقشه فقط با حساب توسعه‌دهنده تغییر می‌کند؛ از فهرست پایین می‌توانی میزها را فعال یا غیرفعال کنی.'
				: 'نقشه و فهرست میزها فقط برای مشاهده است.',
	};

	const current = info(active);
	const greeting = active === 'dashboard' && admin;

	return (
		<>
			<div className={`adm${drawer ? ' drawer-open' : ''}`}>
				<aside className="adm-side" id="adminSidebar" aria-label="منوی پنل مدیریت">
					<div className="adm-brand">
						<span className="adm-brand-mark">
							<img src={BRAND.logo.light} alt="" />
						</span>
						<span className="adm-brand-text">
							<strong>{BRAND.nameFa}</strong>
							<small>پنل مدیریت</small>
						</span>
						<button type="button" className="icon-btn adm-side-close" aria-label="بستن منو" onClick={() => setDrawer(false)}>
							{ADMIN_ICONS.close}
						</button>
					</div>
					<nav className={`adm-nav${pill ? ' has-pill' : ''}`} id="adminMenu" aria-label="بخش‌های پنل مدیریت" ref={navRef}>
						{pill && (
							<span
								className={`adm-nav-pill${pill.slide ? '' : ' no-slide'}`}
								style={{ transform: `translateY(${pill.top}px)`, height: `${pill.height}px` }}
								aria-hidden="true"
							></span>
						)}
						{admin &&
							NAV.map((group) => {
								const items = group.sections.filter((s) => allowed(s.key));
								if (!items.length) return null;
								return (
									<div className="adm-nav-group" key={group.group}>
										<p className="adm-nav-label">{group.group}</p>
										{items.map((section) => {
											const count = badge(section.key);
											return (
												<button
													type="button"
													key={section.key}
													data-section={section.key}
													className={section.key === active ? 'active' : ''}
													aria-current={section.key === active ? 'page' : undefined}
													onClick={() => open(section.key)}
												>
													{ICONS[section.icon]}
													<span>{section.label}</span>
													{count > 0 && (
														<span className="adm-nav-count" aria-label={`${count.toLocaleString('fa-IR')} مورد`}>
															{count.toLocaleString('fa-IR')}
														</span>
													)}
												</button>
											);
										})}
									</div>
								);
							})}
						{!admin && !meError && (
							<div style={{ display: 'grid', gap: '10px', padding: '8px 12px' }}>
								{Array.from({ length: 7 }, (_, i) => (
									<Skeleton key={i} height={30} />
								))}
							</div>
						)}
					</nav>
				</aside>
				<div className="adm-scrim" onClick={() => setDrawer(false)} aria-hidden="true"></div>

				<div className="adm-main">
					<header className={`adm-top${scrolled ? ' is-scrolled' : ''}`}>
						<button
							type="button"
							className="icon-btn adm-burger"
							ref={burgerRef}
							aria-label="منوی بخش‌ها"
							aria-controls="adminSidebar"
							aria-expanded={drawer}
							onClick={() => setDrawer(true)}
						>
							{ADMIN_ICONS.menu}
						</button>
						<div className="adm-title">
							<h1>{greeting ? `سلام، ${admin.name}` : admin ? current.title : 'پنل مدیریت'}</h1>
							<p>{greeting ? `${todayFa()} · خلاصه‌ی امروز کافه` : admin ? `${GROUP_OF[active]} · ${BRAND.cafeFa}` : meError ? BRAND.cafeFa : 'در حال بارگذاری...'}</p>
						</div>
						<div className="adm-top-actions">
							{admin && <WaiterCallBell calls={waiterCalls} />}
							<button
								type="button"
								className="icon-btn"
								id="themeToggle"
								onClick={(event) => {
									// the new theme spreads from the button's middle
									const box = event.currentTarget.getBoundingClientRect();
									toggleTheme({ x: box.left + box.width / 2, y: box.top + box.height / 2 });
								}}
								aria-label={theme === 'dark' ? 'حالت روشن' : 'حالت تیره'}
								title={theme === 'dark' ? 'حالت روشن' : 'حالت تیره'}
							>
								<span className="theme-icon" key={theme}>
									{theme === 'dark' ? ADMIN_ICONS.sun : ADMIN_ICONS.moon}
								</span>
							</button>
							<a className="icon-btn adm-site-link" href="/" target="_blank" rel="noopener" aria-label="مشاهده‌ی سایت" title="مشاهده‌ی سایت">
								{ADMIN_ICONS.eye}
							</a>
							{admin && <UserMenu admin={admin} onPassword={() => setPasswordOpen(true)} onLogout={logout} />}
						</div>
					</header>

					<main className="adm-content" id="adminContent">
						{meError && !admin && (
							<div className="notice danger" role="alert">
								{`پنل باز نشد: ${meError} `}
								<button
									type="button"
									className="secondary-btn"
									onClick={() => {
										setMeError(null);
										setMeAttempt((n) => n + 1);
									}}
								>
									تلاش دوباره
								</button>
							</div>
						)}
						{fatal && <div className="notice danger">{fatal}</div>}
						<Notice notice={banner.flash} reveal />
						{!admin && !meError && (
							<div className="stat-grid">
								{Array.from({ length: 4 }, (_, i) => (
									<div className="stat" key={i}>
										<Skeleton height={70} />
									</div>
								))}
							</div>
						)}
						{admin && (
							<>
								{allowed('dashboard') && (
									<Section info={info('dashboard')} active={active === 'dashboard'}>
										{shown('dashboard') && (
											<Dashboard reloadKey={dashboardKey} visit={visit('dashboard')} onData={onDashboard} onOpen={(key) => open(key)} />
										)}
									</Section>
								)}
								<Section info={info('reservations')} active={active === 'reservations'}>
									{shown('reservations') && (
										<Reservations
											isMain={isMain}
											// read again after a manual booking and on every visit (new online bookings); both numbers only
											// grow, so the sum changes whenever either does
											reloadKey={reservationsKey + visit('reservations')}
											onChanged={() => setDashboardKey((k) => k + 1)}
										/>
									)}
								</Section>
								<Section info={info('manual')} active={active === 'manual'}>
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
								<Section info={tablesInfo} active={active === 'tables'}>
									{shown('tables') && (
										<Tables tables={tables} canEditMap={canEditMap} canToggleTables={canToggleTables} reload={reloadTables} openDialog={setDialog} />
									)}
								</Section>
								<Section info={info('products')} active={active === 'products'}>
									{shown('products') && <Products visit={visit('products')} />}
								</Section>
								<Section info={info('addons')} active={active === 'addons'}>
									{shown('addons') && <AddOns visit={visit('addons')} />}
								</Section>
								<Section info={info('categories')} active={active === 'categories'}>
									{shown('categories') && <Categories visit={visit('categories')} />}
								</Section>
								{isMain && (
									<>
										<Section info={info('menuTypes')} active={active === 'menuTypes'}>
											{shown('menuTypes') && <MenuTypes visit={visit('menuTypes')} />}
										</Section>
										<Section info={info('tags')} active={active === 'tags'}>
											{shown('tags') && <Tags visit={visit('tags')} />}
										</Section>
										<Section info={info('games')} active={active === 'games'}>
											{shown('games') && <Games visit={visit('games')} />}
										</Section>
									</>
								)}
								<Section info={info('reviews')} active={active === 'reviews'}>
									{shown('reviews') && <Reviews visit={visit('reviews')} />}
								</Section>
								{isMain && (
									<>
										<Section info={info('hours')} active={active === 'hours'}>
											<div id="hoursBox">{shown('hours') && <Hours />}</div>
										</Section>
										<Section info={info('closures')} active={active === 'closures'}>
											<div id="closuresBox">{shown('closures') && <Closures tables={tables} />}</div>
										</Section>
										<Section info={info('settings')} active={active === 'settings'}>
											<div id="settingsBox">{shown('settings') && <Settings />}</div>
										</Section>
										<Section info={info('reports')} active={active === 'reports'}>
											<div id="reportsBox">{shown('reports') && <Reports visit={visit('reports')} />}</div>
										</Section>
										<Section info={info('admins')} active={active === 'admins'}>
											{shown('admins') && <Admins me={admin} />}
										</Section>
									</>
								)}
							</>
						)}
					</main>
				</div>
			</div>
			{admin && <WaiterCallToasts calls={waiterCalls} />}
			{admin && passwordOpen && (
				<OwnPasswordDialog
					me={admin}
					onClose={() => setPasswordOpen(false)}
					onSaved={() => banner.show('رمز عبور تغییر کرد. حساب تو روی دستگاه‌های دیگر از پنل خارج شد.', 'ok')}
				/>
			)}
			{canEditMap && (
				<TableEditorDialog target={dialog} allTables={tables} onClose={closeDialog} onSaved={reloadTables} onDeleted={reloadTables} />
			)}
		</>
	);
}
