import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { api, errorText } from '../../shared/api';
import { faNumber, toman } from '../../shared/format';
import { useLatest } from '../../shared/useLatest';
import { DurationChips } from '../common/DurationChips';
import { Topbar } from '../../shared/chrome/Topbar';
import { ReserveFooter } from '../common/ReserveFooter';
import type { CurrentUser, PublicConfig } from '../common/types';
import { FloorMap } from '../map/FloorMap';
import type { MapTable } from '../map/types';
import { card, DetailContent, type Detail } from './DetailContent';
import { useSheet } from './useSheet';

const ZONE_FA: Record<string, string> = { WINDOW: 'سالن پنجره', CENTER: 'سالن وسط', ROOF: 'روف گاردن' };

interface Combo {
	comboId: string;
	tableIds: string[];
	displayNumbers: string[];
	startTime: string;
	endTime: string;
	capacity: number;
	message: string;
}

interface AvailabilityResult {
	tables: MapTable[];
	combos: Combo[];
	suggestions: { startTime: string; endTime: string }[];
	exactMissingMessage: string | null;
}

type Notice = { className: string; text: string } | null;

// Every new detail is a fresh set of elements, so its entry animation (css/motion.css) replays,
// as it did when the panel's HTML was replaced.
let detailCounter = 0;

export function BookingPage() {
	const [config, setConfig] = useState<PublicConfig | null>(null);
	const [user, setUser] = useState<CurrentUser | null>(null);
	const [selectedDate, setSelectedDate] = useState<string | null>(null);
	const [mode, setModeState] = useState<'exact' | 'range'>('exact');
	const [duration, setDuration] = useState(60);
	const [guestCount, setGuestCount] = useState('2');
	const [startTime, setStartTime] = useState('15:00');
	const [rangeStart, setRangeStart] = useState('15:00');
	const [rangeEnd, setRangeEnd] = useState('17:00');

	const [availability, setAvailability] = useState<AvailabilityResult | null>(null);
	// میزها جدا نگه داشته می‌شن تا با باطل‌شدن نتایج، از نقشه محو نشن
	const [knownTables, setKnownTables] = useState<MapTable[]>([]);
	const [hasSearched, setHasSearched] = useState(false);
	const [selectedTableIds, setSelectedTableIds] = useState<string[]>([]);
	const [selectedLabel, setSelectedLabel] = useState('');
	const [notice, setNotice] = useState<Notice>(null);
	const [detailState, setDetailState] = useState<{ detail: Detail; id: number }>({ detail: { kind: 'skeleton' }, id: 0 });
	const setDetail = (detail: Detail) => setDetailState({ detail, id: ++detailCounter });
	const [resultVersion, setResultVersion] = useState(0);

	const [modalOpen, setModalOpen] = useState(false);
	const [customerName, setCustomerName] = useState('');
	const [customerPhone, setCustomerPhone] = useState('');
	const [decoration, setDecoration] = useState(false);
	const [decorationNote, setDecorationNote] = useState('');
	const [submitting, setSubmitting] = useState(false);
	const [modalError, setModalError] = useState<{ id: number; text: string } | null>(null);

	const sheet = useSheet();
	const guestInputRef = useRef<HTMLInputElement>(null);
	const searchSeq = useRef(0);
	const liveTimer = useRef<number | undefined>(undefined);

	const params = useMemo(() => {
		const p = new URLSearchParams({ date: selectedDate ?? '', guests: guestCount, durationMinutes: String(duration) });
		if (mode === 'exact') p.set('startTime', startTime);
		else {
			p.set('rangeStart', rangeStart);
			// a time input cannot show 24:00: «00:00» as the end of a range means midnight
			p.set('rangeEnd', rangeEnd === '00:00' ? '24:00' : rangeEnd);
		}
		return p.toString();
	}, [selectedDate, guestCount, duration, mode, startTime, rangeStart, rangeEnd]);
	const latestParams = useLatest(params);

	const mapTables = useMemo(
		() => availability?.tables ?? knownTables.map((t) => ({ ...t, availability: null })),
		[availability, knownTables],
	);

	// ─── first load: settings, current user, table layout (without free/busy) ───
	useEffect(() => {
		let cancelled = false;
		(async () => {
			try {
				const cfg = await api<PublicConfig>('/api/config');
				if (cancelled) return;
				setConfig(cfg);
				setSelectedDate(cfg.dates[0] ?? null);
				const me = await api<{ user: CurrentUser | null }>('/api/me').catch(() => ({ user: null }));
				if (cancelled) return;
				setUser(me.user);
				const first = new URLSearchParams({ date: cfg.dates[0] ?? '', guests: '2', durationMinutes: '60', startTime: '15:00' });
				try {
					const initial = await api<AvailabilityResult>(`/api/availability?${first}`);
					if (!cancelled) setKnownTables(initial.tables || []);
				} catch (error) {
					if (!cancelled) setNotice({ className: 'notice warn', text: `بارگذاری چیدمان میزها انجام نشد (${errorText(error)}).` });
				}
				if (!cancelled) setDetail(card('هنوز جستجو نشده', 'تاریخ، تعداد نفرات و ساعت رو انتخاب کن و دکمه‌ی بررسی میزها رو بزن.'));
			} catch (error) {
				if (!cancelled) setNotice({ className: 'notice danger', text: errorText(error) });
			}
		})();
		return () => {
			cancelled = true;
		};
	}, []);

	useEffect(() => () => window.clearTimeout(liveTimer.current), []);

	const clearSelection = () => {
		setSelectedTableIds([]);
		setSelectedLabel('');
	};

	const applyResult = (data: AvailabilityResult) => {
		const tables = data.tables || [];
		const combos = data.combos || [];
		const availableCount = tables.filter((t) => t.availability?.available).length;
		if (availableCount || combos.length) {
			setNotice({ className: 'notice ok', text: data.exactMissingMessage || `${faNumber(availableCount)} میز مناسب روی نقشه روشن شد.` });
			setDetail(card('میزی انتخاب نشده', 'روی یک میز روشن ضربه بزن تا جزئیاتش رو ببینی.'));
			return;
		}
		const suggestions = data.suggestions || [];
		setNotice({
			className: 'notice warn',
			text: suggestions.length
				? 'برای این ساعت میز آزادی نبود، ولی ساعت‌های نزدیک آزادن.'
				: 'برای این ترکیب زمان و تعداد نفرات، میز آزادی پیدا نشد. زمان یا تاریخ نزدیک دیگری رو امتحان کن.',
		});
		setDetail(
			suggestions.length
				? { kind: 'suggestions', items: suggestions }
				: card('گزینه‌ای پیدا نشد', 'زمان، تاریخ یا مدت رزرو رو تغییر بده تا نقشه دوباره بررسی بشه.'),
		);
	};

	/** Searches with the conditions on screen right now; an answer that arrives after a newer request is dropped. */
	const runSearch = async (query = latestParams.current) => {
		const seq = ++searchSeq.current;
		try {
			const data = await api<AvailabilityResult>(`/api/availability?${query}`);
			if (seq !== searchSeq.current) return;
			setAvailability(data);
			setResultVersion((v) => v + 1);
			setKnownTables(data.tables || []);
			setHasSearched(true);
			applyResult(data);
		} catch (error) {
			if (seq !== searchSeq.current) return;
			setNotice({ className: 'notice danger', text: errorText(error) });
		}
	};

	/**
	 * Any change to the search conditions. Before the first search it just clears the results; after it,
	 * the map updates live (debounced, so tapping +/− several times sends one request).
	 */
	const conditionsChanged = () => {
		clearSelection();
		if (hasSearched) {
			setNotice({ className: 'notice', text: 'در حال به‌روزرسانی...' });
			window.clearTimeout(liveTimer.current);
			liveTimer.current = window.setTimeout(() => runSearch(), 400);
			return;
		}
		setAvailability(null);
		setNotice({ className: 'notice warn', text: 'شرایط جستجو رو انتخاب کن و دکمه‌ی بررسی میزها رو بزن.' });
		setDetail(card('هنوز جستجو نشده', 'برای دیدن میزهای آزاد، دکمه‌ی بررسی میزها رو بزن.'));
	};

	const stepGuests = (step: number) => {
		const input = guestInputRef.current;
		const next = Math.min(20, Math.max(1, Number(guestCount || 1) + step));
		if (Number(guestCount) !== next) {
			setGuestCount(String(next));
			// تپش کوچک عدد (استایل در css/motion.css)
			if (input) {
				input.classList.remove('is-bumped');
				void input.offsetWidth;
				input.classList.add('is-bumped');
			}
		}
		conditionsChanged();
	};

	const setMode = (next: 'exact' | 'range') => {
		// اگر همان حالت فعلی دوباره انتخاب شود، نباید نتایج جستجو دور ریخته شود
		if (mode === next) return;
		setModeState(next);
		conditionsChanged();
	};

	const selectTable = (table: MapTable) => {
		const zone = ZONE_FA[table.zone] || table.zone;
		if (!table.availability?.available) {
			setDetail(
				card(
					`میز ${table.displayNumber}`,
					zone,
					table.availability
						? table.availability.reason || 'این میز در حال حاضر قابل رزرو نیست.'
						: 'برای دیدن وضعیت این میز، اول دکمه‌ی بررسی میزها رو بزن.',
				),
			);
			sheet.open();
			return;
		}
		const label = `میز ${table.displayNumber}`;
		setSelectedTableIds([table.id]);
		setSelectedLabel(label);
		setDetail({
			kind: 'card',
			title: label,
			lines: [
				`${zone} · ظرفیت ${faNumber(table.capacity)} نفر`,
				table.availability.message ?? '',
				`قابل رزرو از ${table.availability.startTime} تا ${table.availability.endTime}`,
			],
			action: true,
		});
		sheet.open();
	};

	const selectCombo = (combo: Combo) => {
		const label = `میزهای ${combo.displayNumbers.join(' و ')}`;
		setSelectedTableIds([...combo.tableIds]);
		setSelectedLabel(label);
		setDetail({
			kind: 'card',
			title: label,
			lines: [combo.message, `ظرفیت مجموع: ${faNumber(combo.capacity)} نفر`, `قابل رزرو از ${combo.startTime} تا ${combo.endTime}`],
			action: true,
		});
		sheet.open();
	};

	const startTimeOfSelection = (): string | undefined => {
		if (mode === 'exact') return startTime;
		const combo = availability?.combos?.find(
			(c) => c.tableIds.length === selectedTableIds.length && c.tableIds.every((id) => selectedTableIds.includes(id)),
		);
		if (combo) return combo.startTime;
		return availability?.tables?.find((t) => selectedTableIds.includes(t.id))?.availability?.startTime;
	};

	// ─── reserve modal ───────────────────────────────────────────────────────────
	const decorationPrice = Number(config?.settings?.decorationPrice || 0);
	const guests = Number(guestCount);
	const decorationExtra = decoration && decorationPrice > 0 ? decorationPrice : 0;

	const openModal = () => {
		if (!selectedTableIds.length) return;
		// قیمت صفر یعنی ادمین این قابلیت رو خاموش کرده
		if (decorationPrice <= 0) setDecoration(false);
		if (user) {
			setCustomerName(user.name || '');
			setCustomerPhone(user.phone || '');
		}
		setModalOpen(true);
	};

	const closeSheet = sheet.close;
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== 'Escape') return;
			// اول مودال، بعد پنل جزئیات؛ هر بار فقط یکی بسته شود
			if (modalOpen) setModalOpen(false);
			else closeSheet();
		};
		document.addEventListener('keydown', onKey);
		return () => document.removeEventListener('keydown', onKey);
	}, [modalOpen, closeSheet]);

	useEffect(() => {
		if (!modalError) return;
		const timer = window.setTimeout(() => setModalError(null), 8000);
		return () => window.clearTimeout(timer);
	}, [modalError]);

	const submitReservation = async (event: FormEvent) => {
		event.preventDefault();
		setSubmitting(true);
		setModalError(null);
		try {
			const time = startTimeOfSelection();
			if (!time) throw new Error('ساعت شروع مشخص نشد؛ دوباره میز رو انتخاب کن.');
			const { reservation } = await api<{ reservation: { id: string } }>('/api/reservations/hold', {
				method: 'POST',
				body: {
					tableIds: selectedTableIds,
					date: selectedDate,
					startTime: time,
					durationMinutes: duration,
					guestCount: guests,
					customerName: customerName.trim(),
					customerPhone: customerPhone.trim(),
					decoration,
					decorationNote: decorationNote.trim() || null,
				},
			});
			window.location.href = `/reserve/payment?id=${encodeURIComponent(reservation.id)}`;
		} catch (error) {
			setSubmitting(false);
			// خلاصه‌ی رزرو می‌ماند؛ خطا زیر آن نشان داده می‌شود
			setModalError({ id: Date.now(), text: errorText(error) });
		}
	};

	const holdMinutes = Number(config?.settings?.holdMinutes || 10);
	const cancelMinutes = Number(config?.settings?.minCancelMinutes || 120);
	const combos = availability?.combos ?? [];

	return (
		<>
			<main className="shell">
				<Topbar sub="رزرو میز " navLabel="دسترسی‌های کاربر">
					<a href="/menu">منو</a>
					<a href="/reserve/profile">پروفایل</a>
					<a href="/reserve/track">پیگیری رزرو</a>
				</Topbar>
				<section className="page-head">
					<h2>میزت رو برای یک تجربه خوب انتخاب کن</h2>
					<p className="lede">تاریخ، تعداد نفرات و زمان رو مشخص کن. میزهای آزاد روی نقشه روشن می‌شن و جزئیات هر انتخاب همون‌جا نمایش داده می‌شه.</p>
				</section>

				<section className="grid reservation-layout">
					<aside className="card card-pad reservation-filter">
						<h3>جزئیات رزرو</h3>
						<form
							id="searchForm"
							className="form-grid"
							onSubmit={(event) => {
								event.preventDefault();
								clearSelection();
								setNotice({ className: 'notice', text: 'در حال بررسی میزها...' });
								window.clearTimeout(liveTimer.current);
								runSearch(params);
							}}
						>
							<div className="field">
								<label>تاریخ</label>
								<div id="dateRow" className="date-row">
									{config?.dates.map((date, index) => {
										const value = new Date(`${date}T12:00:00`);
										const label = index === 0 ? 'امروز' : index === 1 ? 'فردا' : value.toLocaleDateString('fa-IR', { weekday: 'short' });
										return (
											<button
												key={date}
												type="button"
												className={`date-chip${date === selectedDate ? ' active' : ''}`}
												onClick={() => {
													setSelectedDate(date);
													conditionsChanged();
												}}
											>
												<strong>{label}</strong>
												<small>{value.toLocaleDateString('fa-IR', { month: 'short', day: 'numeric' })}</small>
											</button>
										);
									})}
								</div>
							</div>
							<div className="reserve-info">
								<div className="field">
									<label htmlFor="guestCount">تعداد نفرات</label>
									<div className="stepper">
										<button type="button" aria-label="کم کردن تعداد نفرات" onClick={() => stepGuests(-1)}>
											−
										</button>
										<input
											id="guestCount"
											type="number"
											inputMode="numeric"
											min="1"
											max="20"
											ref={guestInputRef}
											value={guestCount}
											onChange={(event) => {
												setGuestCount(event.target.value);
												conditionsChanged();
											}}
										/>
										<button type="button" aria-label="زیاد کردن تعداد نفرات" onClick={() => stepGuests(1)}>
											+
										</button>
									</div>
								</div>
								<div className="field">
									<label>مدت رزرو</label>
									{config && (
										<DurationChips
											id="durationRow"
											value={duration}
											onChange={(minutes) => {
												setDuration(minutes);
												conditionsChanged();
											}}
										/>
									)}
									{!config && <div id="durationRow" className="chip-row"></div>}
								</div>
							</div>
							<div className="field">
								<label>نوع زمان</label>
								<div className="mode-tabs">
									<button type="button" className={mode === 'exact' ? 'active' : ''} onClick={() => setMode('exact')}>
										ساعت دقیق
									</button>
									<button type="button" className={mode === 'range' ? 'active' : undefined} onClick={() => setMode('range')}>
										بازه زمانی
									</button>
								</div>
							</div>
							<div id="exactBox" className="row" hidden={mode !== 'exact'}>
								<div className="field">
									<label htmlFor="startTime">ساعت شروع</label>
									<input
										id="startTime"
										type="time"
										step="900"
										value={startTime}
										onChange={(event) => {
											setStartTime(event.target.value);
											conditionsChanged();
										}}
									/>
								</div>
							</div>
							<div id="rangeBox" className="clock-range" hidden={mode !== 'range'}>
								<div className="field">
									<label htmlFor="rangeStart">از ساعت</label>
									<input
										id="rangeStart"
										type="time"
										step="900"
										value={rangeStart}
										onChange={(event) => {
											setRangeStart(event.target.value);
											conditionsChanged();
										}}
									/>
								</div>
								<div className="field">
									<label htmlFor="rangeEnd">تا ساعت</label>
									<input
										id="rangeEnd"
										type="time"
										step="900"
										value={rangeEnd}
										onChange={(event) => {
											setRangeEnd(event.target.value);
											conditionsChanged();
										}}
									/>
								</div>
							</div>
							<button className="primary-btn-main" type="submit">
								بررسی میزهای آزاد
							</button>
						</form>
						<div id="searchNotice" aria-live="polite" className={notice?.className}>
							{notice?.text}
						</div>
					</aside>

					<section className="card map-card">
						<div className="map-toolbar">
							<div>
								<h3>نقشه رزرو</h3>
								<p className="map-hint">نقشه رو بکش، زوم کن یا یک سالن رو جدا ببین.</p>
							</div>
							<div className="legend" aria-label="راهنمای وضعیت میزها">
								<span>
									<i className="dot perfect"></i> مناسب دقیق
								</span>
								<span>
									<i className="dot soft"></i> ظرفیت بیشتر
								</span>
								<span>
									<i className="dot reserved"></i> غیرقابل رزرو
								</span>
								<span>
									<i className="dot selected"></i> انتخاب‌شده
								</span>
							</div>
						</div>

						<FloorMap
							tables={mapTables}
							selectedIds={selectedTableIds}
							mode={mode}
							onTableClick={selectTable}
							onError={(error) => setNotice({ className: 'notice danger', text: error.message })}
							svgProps={{ id: 'floorMap', 'aria-label': 'نقشه تعاملی کافه روف' }}
							wrapId="mapWrap"
							zoneTabsId="zoneTabs"
							loadingId="mapLoading"
							loadingText="در حال آماده‌سازی نقشه کافه..."
						/>

						<div id="comboPanel" className="table-detail combo-panel" hidden={combos.length === 0}>
							<h4>پیشنهادهای ترکیبی</h4>
							<div id="comboList" className="combo-list">
								{combos.map((combo) => (
									<div className="combo-item" key={`${resultVersion}-${combo.comboId}`}>
										<span>
											<b>میزهای {combo.displayNumbers.join(' و ')}</b>
											<small>
												{combo.startTime} تا {combo.endTime} · ظرفیت {faNumber(combo.capacity || 0)} نفر
											</small>
										</span>
										<button type="button" className="secondary-btn" onClick={() => selectCombo(combo)}>
											انتخاب
										</button>
									</div>
								))}
							</div>
						</div>

						<div className={`side-panel${sheet.state !== 'none' ? ' as-sheet' : ''}${sheet.state === 'open' ? ' open' : ''}`} id="sidePanel">
							<div className="sheet-handle"></div>
							<div id="selectedDetail" className="table-detail">
								<DetailContent
									key={detailState.id}
									detail={detailState.detail}
									onReserve={openModal}
									onSuggestion={(time) => {
										setStartTime(time);
										clearSelection();
										window.clearTimeout(liveTimer.current);
										setNotice({ className: 'notice', text: 'در حال بررسی...' });
										const p = new URLSearchParams(params);
										p.set('startTime', time);
										runSearch(p.toString());
									}}
								/>
							</div>
						</div>
					</section>
				</section>
			</main>
			<ReserveFooter />

			<div
				id="reserveModal"
				className={`modal${modalOpen ? ' open' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="reserveTitle"
				onClick={(event) => {
					if (event.target === event.currentTarget) setModalOpen(false);
				}}
			>
				<div className="modal-content">
					<h3 id="reserveTitle">تکمیل رزرو</h3>
					<div id="modalSummary" className="notice">
						{selectedLabel}
						<br />
						تعداد نفرات: {faNumber(guests)}
						{decorationExtra ? (
							<>
								<br />
								تزئین: {toman(decorationExtra)}
							</>
						) : null}
						<br />
						مبلغ کل (تقریبی): {toman((config?.settings.pricePerGuest ?? 0) * guests + decorationExtra)}
					</div>
					{modalError && (
						<div className="notice danger" style={{ marginTop: '8px' }} key={modalError.id}>
							{modalError.text}
						</div>
					)}
					<form id="reserveForm" className="form-grid" style={{ marginTop: '14px' }} onSubmit={submitReservation}>
						<div className="row">
							<div className="field">
								<label htmlFor="customerName">نام</label>
								<input
									id="customerName"
									required
									maxLength={80}
									autoComplete="name"
									placeholder="نام و نام خانوادگی"
									value={customerName}
									onChange={(event) => setCustomerName(event.target.value)}
								/>
							</div>
							<div className="field">
								<label htmlFor="customerPhone">موبایل</label>
								<input
									id="customerPhone"
									required
									inputMode="tel"
									autoComplete="tel"
									placeholder="09..."
									value={customerPhone}
									onChange={(event) => setCustomerPhone(event.target.value)}
								/>
							</div>
						</div>
						<div className="field" id="decorationField" hidden={decorationPrice <= 0}>
							<label className="checkbox-row">
								<input
									type="checkbox"
									id="decorationToggle"
									checked={decoration}
									onChange={(event) => {
										setDecoration(event.target.checked);
										if (!event.target.checked) setDecorationNote('');
									}}
								/>
								<span id="decorationLabel">{`تزئین میز (+${toman(decorationPrice)})`}</span>
							</label>
						</div>
						<div className="field" id="decorationNoteField" hidden={!decoration}>
							<label htmlFor="decorationNote">چه تزئینی می‌خوای؟ (اختیاری)</label>
							<input
								id="decorationNote"
								maxLength={200}
								placeholder="مثلاً تولد، با بادکنک"
								value={decorationNote}
								onChange={(event) => setDecorationNote(event.target.value)}
							/>
						</div>
						<p className="dialog-hint" id="reservePolicy">
							{`میز تا ${faNumber(holdMinutes)} دقیقه برای شما نگه داشته می‌شه. لغو رزرو تا ${faNumber(Math.round(cancelMinutes / 60))} ساعت قبل از شروع ممکنه.`}
						</p>
						<div className="actions">
							<button className="secondary-btn" type="button" id="closeModal" onClick={() => setModalOpen(false)}>
								برگشت
							</button>
							<button className="primary-btn" type="submit" disabled={submitting}>
								ثبت موقت و رفتن به پرداخت
							</button>
						</div>
					</form>
				</div>
			</div>

			<div className={`sheet-scrim${sheet.state === 'open' ? ' open' : ''}`} onClick={sheet.close}></div>
		</>
	);
}

