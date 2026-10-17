import { useCallback, useEffect, useState } from 'react';
import { api, errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { OtpWidget } from '../common/OtpWidget';
import { Topbar } from '../common/Topbar';
import { ReserveFooter } from '../common/ReserveFooter';
import { faDateTime, faNumber, statusFa, tablesText, toman } from '../common/format';
import type { CurrentUser, Reservation } from '../common/types';

const AUTH_TEXTS = {
	login: {
		eyebrow: 'ورود با کد یک‌بارمصرف',
		title: 'حساب من',
		lede: 'با شماره موبایلت وارد شو تا رزروهات و اطلاعات حسابت رو اینجا ببینی.',
		submit: 'ورود',
	},
	signup: {
		eyebrow: 'ثبت‌نام',
		title: 'ساخت حساب',
		lede: 'اسم و شماره موبایلت رو وارد کن تا حسابت ساخته بشه.',
		submit: 'ثبت‌نام',
	},
};

type AuthMode = keyof typeof AUTH_TEXTS;
type Reservations = { state: 'loading' } | { state: 'error'; message: string } | { state: 'loaded'; list: Reservation[] };

function DateBlock({ iso }: { iso: string }) {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return (
			<div className="timeline-date">
				<strong>—</strong>
				<span>—</span>
			</div>
		);
	}
	return (
		<div className="timeline-date">
			<strong>{d.toLocaleDateString('fa-IR', { day: 'numeric' })}</strong>
			<span>{d.toLocaleDateString('fa-IR', { month: 'short' })}</span>
		</div>
	);
}

export function ProfilePage() {
	// undefined = still asking the server
	const [user, setUser] = useState<CurrentUser | null | undefined>(undefined);
	const [loadError, setLoadError] = useState<string | null>(null);
	const [authMode, setAuthMode] = useState<AuthMode>('login');
	const [tab, setTab] = useState<'reservations' | 'account'>('reservations');
	const [reservations, setReservations] = useState<Reservations>({ state: 'loading' });
	const [name, setName] = useState('');
	const [greetingName, setGreetingName] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);
	const [accountNotice, setAccountNotice] = useState<{ type: string; text: string } | null>(null);

	const load = useCallback(async (isCurrent: () => boolean = () => true) => {
		let me: CurrentUser | null;
		try {
			({ user: me } = await api<{ user: CurrentUser | null }>('/api/me'));
		} catch (error) {
			if (!isCurrent()) return;
			setLoadError(errorText(error));
			setUser(null);
			setAuthMode('login');
			return;
		}
		if (!isCurrent()) return;
		setLoadError(null);
		setUser(me);
		if (!me) {
			setAuthMode('login');
			return;
		}
		setName(me.name || '');
		setGreetingName(me.name);
		setReservations({ state: 'loading' });
		try {
			const { reservations: list } = await api<{ reservations: Reservation[] }>('/api/reservations/profile/list');
			if (isCurrent()) setReservations({ state: 'loaded', list: list || [] });
		} catch (error) {
			if (isCurrent()) setReservations({ state: 'error', message: errorText(error) });
		}
	}, []);

	useEffect(() => {
		let current = true;
		load(() => current);
		return () => {
			current = false;
		};
	}, [load]);

	const logout = async () => {
		try {
			await api('/api/logout', { method: 'POST' });
		} catch (error) {
			console.warn('خروج با خطا مواجه شد:', error);
		}
		await load();
	};

	const saveName = async () => {
		const clean = name.trim();
		if (!clean) {
			setAccountNotice({ type: 'danger', text: 'نام نمی‌تواند خالی باشد.' });
			return;
		}
		setSaving(true);
		try {
			const { user: updated } = await api<{ user: CurrentUser }>('/api/me', { method: 'PATCH', body: { name: clean } });
			setAccountNotice({ type: 'ok', text: 'ذخیره شد.' });
			setGreetingName(updated.name);
		} catch (error) {
			setAccountNotice({ type: 'danger', text: errorText(error) });
		} finally {
			setSaving(false);
		}
	};

	const loggedIn = Boolean(user);
	const texts = AUTH_TEXTS[authMode];

	return (
		<>
		<main className="shell">
			<Topbar sub="حساب من">
				<a href="/reserve">رزرو جدید</a>
				<button id="logoutBtn" hidden={!loggedIn} onClick={logout}>
					خروج
				</button>
			</Topbar>

			{/* وارد نشده: فقط گیت ورود */}
			<section id="loginGate" className="page-head" style={{ maxWidth: '420px', marginInline: 'auto', textAlign: 'center' }} hidden={loggedIn}>
				<span className="eyebrow" style={{ alignSelf: 'center' }} id="authEyebrow">
					{texts.eyebrow}
				</span>
				<h2 id="authTitle">{texts.title}</h2>
				<p className="lede" style={{ marginInline: 'auto' }} id="authLede">
					{texts.lede}
				</p>
				<div className="mode-tabs" style={{ justifyContent: 'center', marginTop: '6px' }}>
					<button type="button" className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>
						ورود
					</button>
					<button type="button" className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>
						ثبت‌نام
					</button>
				</div>
			</section>
			<section id="loginGateForm" className="card card-pad" style={{ maxWidth: '420px', margin: '0 auto' }} hidden={loggedIn}>
				{user === null && (
					// هر دو حالت یک مسیر سروری دارند؛ تفاوتشان فقط در متن‌ها
					<OtpWidget
						key={authMode}
						purpose="LOGIN"
						extraFields={[{ key: 'name', label: 'نام (اگر حساب نداری لازم است)', required: false }]}
						submitLabel={texts.submit}
						initialNotice={loadError ? { message: loadError, type: 'danger' } : null}
						onVerified={() => load()}
					/>
				)}
			</section>

			{/* واردشده */}
			<section id="accountHub" hidden={!loggedIn}>
				<section className="page-head">
					<span className="eyebrow">خوش اومدی</span>
					<h2 id="hubGreeting">{greetingName ? `سلام ${greetingName}` : 'حساب من'}</h2>
				</section>

				<nav className="admin-menu" id="hubTabs" style={{ gridAutoFlow: 'column', gridTemplateColumns: 'none', width: 'fit-content', marginBottom: '18px' }}>
					<button type="button" className={tab === 'reservations' ? 'active' : ''} onClick={() => setTab('reservations')}>
						رزروهای من
					</button>
					<button type="button" className={tab === 'account' ? 'active' : ''} onClick={() => setTab('account')}>
						اطلاعات حساب
					</button>
				</nav>

				<section className={`admin-section${tab === 'reservations' ? ' active' : ''}`}>
					{reservations.state === 'loading' ? (
						<div id="reservationsBox" className="skeleton" style={{ height: '100px' }}></div>
					) : (
						<div id="reservationsBox">
							{reservations.state === 'error' && <div className="notice danger">{reservations.message}</div>}
							{reservations.state === 'loaded' && reservations.list.length === 0 && (
								<div className="empty-state">
									{ICONS.empty}
									<strong>هنوز رزروی ثبت نشده</strong>
									<p>از صفحه اصلی یک تاریخ انتخاب کن تا اولین رزروت اینجا بیفته.</p>
								</div>
							)}
							{reservations.state === 'loaded' && reservations.list.length > 0 && (
								<div className="timeline">
									{reservations.list.map((r) => (
										<div className="timeline-item" key={r.id}>
											<DateBlock iso={r.startAt} />
											<div className="timeline-body">
												<strong>
													میز <bdi>{tablesText(r)}</bdi> · <bdi>{faNumber(r.guestCount || 0)} نفر</bdi>
												</strong>
												<span>
													{faDateTime(r.startAt)} · {toman(r.totalAmount)}
												</span>
											</div>
											<div className="timeline-actions">
												<span className={`status ${r.status}`}>{statusFa(r.status)}</span>
												<a className="secondary-btn" href={`/reserve/invoice?id=${encodeURIComponent(r.id)}`}>
													فاکتور
												</a>
											</div>
										</div>
									))}
								</div>
							)}
						</div>
					)}
				</section>

				<section className={`admin-section${tab === 'account' ? ' active' : ''}`}>
					<div className="card card-pad" style={{ maxWidth: '420px' }}>
						<h3>اطلاعات حساب</h3>
						<div className="form-grid">
							<div className="field">
								<label>نام</label>
								<input id="accountName" placeholder="نامت رو وارد کن" value={name} onChange={(event) => setName(event.target.value)} />
							</div>
							<div className="field">
								<label>شماره موبایل</label>
								<input id="accountPhone" disabled value={user?.phone || ''} readOnly />
							</div>
							<button id="saveAccountBtn" className="secondary-btn" disabled={saving} onClick={saveName}>
								ذخیره نام
							</button>
							<div id="accountNotice" className={accountNotice ? `notice ${accountNotice.type}` : undefined}>
								{accountNotice?.text}
							</div>
						</div>
					</div>
				</section>
			</section>
		</main>
		<ReserveFooter />
		</>
	);
}
