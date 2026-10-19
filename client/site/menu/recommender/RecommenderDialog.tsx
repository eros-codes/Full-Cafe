import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import { faNumber } from '../../../shared/format';
import { useLatest } from '../../../shared/useLatest';
import { productImageUrl, type Product } from '../api';
import { ImageIcon } from '../ImagePlaceholder';
import { KIND_FA, fetchRecommenderData, joinFa, type RecProduct } from './data';
import {
	answer,
	answerOptions,
	availableKinds,
	buildCatalog,
	canStartRound2,
	chooseKind,
	hardGroups,
	initialState,
	keepAsking,
	more,
	progress,
	questionText,
	showNow,
	skip,
	startRound2,
	type Catalog,
	type RecState,
} from './engine';
import { KIND_ICONS, SPARK_ICON } from './icons';

// «انتخاب برای من»: the dialog. The engine (./engine.ts) decides; this file only shows its state and turns
// taps into engine actions. Every action keeps the previous state, so «قبلی» is exact.

const DISCLAIMER = 'این پیشنهادها بر اساس سلیقه‌ی تو و اطلاعات ثبت‌شده‌ی منو هستند. برای آلرژی و محدودیت غذایی حتماً از پرسنل بپرس.';
/** The data is read again at the start of a new round of questions if it is older than this. */
const DATA_MAX_AGE_MS = 60 * 1000;

type Load = { state: 'loading' } | { state: 'error' } | { state: 'off' } | { state: 'ready'; catalog: Catalog<RecProduct>; at: number };

const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

interface Props {
	open: boolean;
	/** The product dialog is open on top (opened from a suggestion). */
	productOpen: boolean;
	onOpenProduct: (product: Product) => void;
	onClose: () => void;
}

export function RecommenderDialog({ open, productOpen, onOpenProduct, onClose }: Props) {
	const [load, setLoad] = useState<Load>({ state: 'loading' });
	const [attempt, setAttempt] = useState(0);
	const [rec, setRec] = useState<RecState>(() => initialState(randomSeed()));
	const [history, setHistory] = useState<RecState[]>([]);
	const [constraints, setConstraints] = useState<number[]>([]);
	const [dietOpen, setDietOpen] = useState(false);
	/** Ticked answers of a multi-choice question (keyed by the question, so a new question starts empty). */
	const [multi, setMulti] = useState<{ groupId: number | null; ids: number[] }>({ groupId: null, ids: [] });
	const [visible, setVisible] = useState(false);
	const dialogRef = useRef<HTMLElement>(null);
	const titleRef = useRef<HTMLHeadingElement>(null);
	const lastCardRef = useRef<HTMLButtonElement | null>(null);
	const onCloseRef = useLatest(onClose);
	const productOpenRef = useLatest(productOpen);

	// ─── data ─────────────────────────────────────────────────────────────────
	useEffect(() => {
		let cancelled = false;
		setLoad((current) => (current.state === 'ready' ? current : { state: 'loading' }));
		fetchRecommenderData()
			.then((data) => {
				if (cancelled) return;
				const catalog = data.enabled ? buildCatalog(data.groups, data.products) : null;
				const usable = catalog && availableKinds(catalog).length > 0 && catalog.groups.some((g) => g.strictness === 'SOFT');
				setLoad(usable ? { state: 'ready', catalog, at: Date.now() } : { state: 'off' });
			})
			.catch(() => {
				// a failed refresh keeps the data already shown
				if (!cancelled) setLoad((current) => (current.state === 'ready' ? current : { state: 'error' }));
			});
		return () => {
			cancelled = true;
		};
	}, [attempt]);

	const atStart = rec.phase === 'kind' && history.length === 0;

	// opening again at the start: fresh data if what we have is old (the café may have changed the menu).
	// Only when the dialog opens, hence the single dependency.
	const staleAtStart = atStart && load.state === 'ready' && Date.now() - load.at > DATA_MAX_AGE_MS;
	const staleRef = useLatest(staleAtStart);
	useEffect(() => {
		if (open && staleRef.current) setAttempt((n) => n + 1);
	}, [open, staleRef]);

	// ─── open / close: fade, scroll lock, Escape ───────────────────────────────
	useEffect(() => {
		if (!open) {
			setVisible(false);
			return;
		}
		document.body.classList.add('recommender-open');
		const frame = requestAnimationFrame(() => setVisible(true));
		const onKey = (event: KeyboardEvent) => {
			// Escape on the product dialog opened from a suggestion closes only that one
			if (event.key === 'Escape' && !productOpenRef.current && !document.body.classList.contains('product-dialog-open')) onCloseRef.current();
		};
		document.addEventListener('keydown', onKey);
		return () => {
			cancelAnimationFrame(frame);
			document.body.classList.remove('recommender-open');
			document.removeEventListener('keydown', onKey);
		};
	}, [open, onCloseRef, productOpenRef]);

	// every new screen: focus its title, so a screen reader reads it and Tab starts from the top
	const screenKey = `${load.state}|${rec.phase}|${rec.current}|${rec.round}|${rec.result?.suggestions.map((s) => s.productId).join(',')}`;
	useEffect(() => {
		if (!open || productOpen) return;
		const frame = requestAnimationFrame(() => titleRef.current?.focus({ preventScroll: true }));
		return () => cancelAnimationFrame(frame);
	}, [open, screenKey, productOpen]);

	// back from the product dialog: focus the suggestion that opened it
	const wasProductOpen = useRef(productOpen);
	useEffect(() => {
		if (wasProductOpen.current && !productOpen && open) lastCardRef.current?.focus({ preventScroll: true });
		wasProductOpen.current = productOpen;
	}, [productOpen, open]);

	/** Keeps Tab inside the dialog. */
	const trapFocus = (event: ReactKeyboardEvent<HTMLElement>) => {
		if (event.key !== 'Tab' || !dialogRef.current) return;
		const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])')].filter(
			(el) => el.offsetParent !== null,
		);
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && (document.activeElement === first || document.activeElement === titleRef.current)) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	// ─── engine actions ──────────────────────────────────────────────────────
	const go = (next: RecState) => {
		if (next === rec) return;
		setHistory([...history, rec]);
		setRec(next);
	};
	const back = () => {
		if (!history.length) return;
		const previous = history[history.length - 1];
		setHistory(history.slice(0, -1));
		setRec(previous);
		// a multi-choice question comes back with what was ticked
		if (previous.phase === 'question' && previous.current !== null) setMulti({ groupId: previous.current, ids: rec.answers[previous.current] ?? [] });
	};
	const restart = () => {
		setRec(initialState(randomSeed()));
		setHistory([]);
		setConstraints([]);
		setDietOpen(false);
		if (load.state === 'ready' && Date.now() - load.at > DATA_MAX_AGE_MS) setAttempt((n) => n + 1);
	};

	// ─── screens ─────────────────────────────────────────────────────────────
	const title = (text: string) => (
		<h2 id="rec-title" className="rec-title" tabIndex={-1} ref={titleRef}>
			{text}
		</h2>
	);

	let screen: ReactNode;
	let footer: ReactNode = null;
	if (load.state === 'loading') {
		screen = (
			<>
				{title('یه لحظه…')}
				<p className="rec-loading" aria-hidden="true"></p>
			</>
		);
	} else if (load.state === 'error') {
		screen = (
			<>
				{title('الان نمی‌شه پیشنهاد داد')}
				<p className="rec-sub">اتصال اینترنت رو چک کن و دوباره امتحان کن.</p>
				<button type="button" className="rec-primary" onClick={() => setAttempt((n) => n + 1)}>
					دوباره امتحان کن
				</button>
			</>
		);
	} else if (load.state === 'off') {
		screen = (
			<>
				{title('این قابلیت الان در دسترس نیست')}
				<p className="rec-sub">از منو انتخاب کن یا از پرسنل کافه کمک بگیر.</p>
			</>
		);
	} else {
		const { catalog } = load;
		const kinds = availableKinds(catalog);

		if (rec.phase === 'kind') {
			const restrictions = hardGroups(catalog).filter((g) => g.kinds.some((k) => kinds.includes(k)));
			const toggleConstraint = (id: number) => setConstraints((list) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]));
			screen = (
				<>
					{title('دنبال چی هستی؟')}
					<p className="rec-sub">چند سوال کوتاه می‌پرسم و ۱ تا ۳ پیشنهاد از منو بهت می‌دم.</p>
					<div className={`rec-kinds rec-kinds-${kinds.length}`}>
						{kinds.map((kind) => (
							<button type="button" key={kind} className="rec-kind" onClick={() => go(chooseKind(rec, catalog, kind, constraints))}>
								{KIND_ICONS[kind]}
								<span>{KIND_FA[kind]}</span>
							</button>
						))}
					</div>
					{kinds.length > 1 && (
						<button type="button" className="rec-skip" onClick={() => go(chooseKind(rec, catalog, 'ANY', constraints))}>
							فرقی نداره
						</button>
					)}
					{restrictions.length > 0 && (
						<div className="rec-diet">
							<button type="button" className="rec-link" aria-expanded={dietOpen} aria-controls="rec-diet-panel" onClick={() => setDietOpen((v) => !v)}>
								{constraints.length ? `محدودیت غذایی (${faNumber(constraints.length)})` : 'محدودیت غذایی داری؟'}
							</button>
							{dietOpen && (
								<div id="rec-diet-panel" className="rec-diet-panel">
									{restrictions.map((group) => (
										<div key={group.id} className="rec-diet-group" role="group" aria-label={group.question}>
											{restrictions.length > 1 && <p className="rec-diet-title">{group.question}</p>}
											<div className="rec-chips">
												{group.options.map((option) => {
													const on = constraints.includes(option.id);
													return (
														<button
															type="button"
															key={option.id}
															className={`rec-chip${on ? ' on' : ''}`}
															aria-pressed={on}
															onClick={() => toggleConstraint(option.id)}
														>
															{option.label}
														</button>
													);
												})}
											</div>
										</div>
									))}
									<p className="rec-note">فقط چیزهایی پیشنهاد می‌شن که در منو همین‌طور ثبت شده‌اند.</p>
								</div>
							)}
						</div>
					)}
				</>
			);
		} else if (rec.phase === 'question' && rec.current !== null) {
			const group = catalog.groupById.get(rec.current)!;
			const options = answerOptions(rec, catalog);
			const ticked = multi.groupId === group.id ? multi.ids : [];
			const toggle = (id: number) => setMulti({ groupId: group.id, ids: ticked.includes(id) ? ticked.filter((x) => x !== id) : [...ticked, id] });
			screen = (
				<>
					{title(questionText(group, rec.kind))}
					{group.multi && <p className="rec-sub">می‌تونی چندتا رو با هم انتخاب کنی.</p>}
					<div className="rec-options">
						{options.map((option) =>
							group.multi ? (
								<button
									type="button"
									key={option.id}
									className={`rec-option${ticked.includes(option.id) ? ' on' : ''}`}
									aria-pressed={ticked.includes(option.id)}
									onClick={() => toggle(option.id)}
								>
									{option.label}
								</button>
							) : (
								<button type="button" key={option.id} className="rec-option" onClick={() => go(answer(rec, catalog, [option.id]))}>
									{option.label}
								</button>
							),
						)}
					</div>
					{group.multi && (
						<button type="button" className="rec-primary" disabled={!ticked.length} onClick={() => go(answer(rec, catalog, ticked))}>
							تأیید
						</button>
					)}
					<button type="button" className="rec-skip" onClick={() => go(skip(rec, catalog))}>
						فرقی نداره
					</button>
				</>
			);
			footer = (
				<button type="button" className="rec-now" onClick={() => go(showNow(rec, catalog))}>
					نشونم بده
				</button>
			);
		} else if (rec.phase === 'skipPrompt') {
			screen = (
				<>
					{title('باشه، با همین نتیجه بدم؟')}
					<div className="rec-actions">
						<button type="button" className="rec-primary" onClick={() => go(showNow(rec, catalog))}>
							آره، نشونم بده
						</button>
						<button type="button" className="rec-secondary" onClick={() => go(keepAsking(rec, catalog))}>
							یه سوال دیگه
						</button>
					</div>
				</>
			);
		} else if (rec.phase === 'results' && rec.result) {
			const result = rec.result;
			const heading = result.exhausted
				? 'همه‌ی گزینه‌های مناسب را دیدی'
				: result.note === 'closest'
					? 'این‌ها نزدیک‌ترین‌ها به سلیقه‌ات هستند'
					: result.note === 'noTaste'
						? 'چند پیشنهاد از منو'
						: result.suggestions.length === 1
							? 'این رو پیشنهاد می‌کنم'
							: 'این‌ها رو پیشنهاد می‌کنم';
			screen = (
				<>
					{title(heading)}
					{result.suggestions.length > 0 && (
						<ul className="rec-results">
							{result.suggestions.map((suggestion) => {
								const product = catalog.byId.get(suggestion.productId)!;
								const src = productImageUrl(product.image);
								return (
									<li key={product.id}>
										<button
											type="button"
											className="rec-card"
											onClick={(event) => {
												lastCardRef.current = event.currentTarget;
												onOpenProduct(product);
											}}
										>
											<span className="rec-card-pic">{src ? <img src={src} alt="" /> : <ImageIcon />}</span>
											<span className="rec-card-info">
												<span className="rec-card-name">{product.name}</span>
												<span className="rec-card-price">{`${faNumber(product.price)} تومان`}</span>
												{suggestion.reasons.length > 0 && (
													<span className="rec-card-reason">{`${joinFa(suggestion.reasons)}، مطابق جواب‌هات`}</span>
												)}
											</span>
											<span className="rec-card-go" aria-hidden="true">
												‹
											</span>
										</button>
									</li>
								);
							})}
						</ul>
					)}
					{result.suggestions.length > 0 && <p className="rec-note">{DISCLAIMER}</p>}
					{canStartRound2(rec, catalog) && (
						<div className="rec-round2">
							<p>هیچ‌کدوم به دلت ننشست؟ حداکثر ۳ سوال دیگه می‌پرسم تا دقیق‌تر بشه.</p>
							<button type="button" className="rec-secondary" onClick={() => go(startRound2(rec, catalog))}>
								بپرس
							</button>
						</div>
					)}
					<div className="rec-actions">
						{!result.exhausted && (
							<button type="button" className="rec-secondary" onClick={() => go(more(rec, catalog))}>
								یه چیز دیگه نشونم بده
							</button>
						)}
						<button type="button" className="rec-ghost" onClick={restart}>
							از اول
						</button>
					</div>
				</>
			);
		} else if (rec.phase === 'moreOffer') {
			screen = (
				<>
					{title('سوال دیگه‌ای کمکی نمی‌کنه')}
					<p className="rec-sub">گزینه‌های بعدی منو رو نشونت بدم؟</p>
					<div className="rec-actions">
						<button type="button" className="rec-primary" onClick={() => go(more(rec, catalog))}>
							یه چیز دیگه نشونم بده
						</button>
						<button type="button" className="rec-ghost" onClick={restart}>
							از اول
						</button>
					</div>
				</>
			);
		} else {
			// 'empty': the restrictions left nothing
			screen = (
				<>
					{title('با این محدودیت‌ها چیزی پیدا نکردیم، از پرسنل بپرس.')}
					<div className="rec-actions">
						<button type="button" className="rec-ghost" onClick={restart}>
							از اول
						</button>
					</div>
				</>
			);
		}
	}

	const showProgress = load.state === 'ready' && (rec.phase === 'question' || rec.phase === 'skipPrompt');
	const percent = Math.round(progress(rec) * 100);

	return (
		<>
			<div className={`rec-backdrop${open && visible ? ' visible' : ''}`} hidden={!open} onClick={onClose}></div>
			<section
				id="recommender-dialog"
				className={`rec-dialog${open && visible ? ' open' : ''}`}
				role="dialog"
				aria-modal="true"
				aria-labelledby="rec-title"
				hidden={!open}
				ref={dialogRef}
				onKeyDown={trapFocus}
			>
				<div className="rec-head">
					<span className="rec-head-label">
						{SPARK_ICON}
						انتخاب برای من
					</span>
					<button type="button" className="rec-close" aria-label="بستن انتخاب برای من" onClick={onClose}>
						&times;
					</button>
				</div>
				<div className="rec-progress" hidden={!showProgress} role="progressbar" aria-label="پیشرفت سوال‌ها" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
					<span style={{ width: `${percent}%` }}></span>
				</div>
				<div className="rec-body" key={screenKey}>
					{screen}
				</div>
				{(history.length > 0 || footer) && load.state === 'ready' && (
					<div className="rec-foot">
						{history.length > 0 ? (
							<button type="button" className="rec-back" onClick={back}>
								<span aria-hidden="true">›</span> قبلی
							</button>
						) : (
							<span></span>
						)}
						{footer}
					</div>
				)}
			</section>
		</>
	);
}
