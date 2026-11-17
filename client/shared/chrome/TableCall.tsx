import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api } from '../api';
import { faDigits } from '../format';
import { safeStorage } from '../storage';

// «صدا کردن گارسون», the guest's button: only for someone who scanned a table's QR code (/menu?table=<token>).
// The token is remembered for a few hours (the guest moves between the menu, the games and the About page) and
// taken out of the address bar, so a shared link does not carry it. On the menu and the list of games only (not over
// a game, not on the other pages). A round button at the bottom left (the mirror of
// «انتخاب برای من» at the bottom right of the menu) opens a small sheet: «گارسون» or «صورت‌حساب»; after that its
// colour shows the call's state: orange while it waits, green for a few seconds once the waiter answered.
//
// Its entrance, timed with the menu's other button: the circle arrives, opens into «صدا کردن گارسون» after half a
// second, and closes back into the circle at three seconds, just as «نمی‌دونی چی انتخاب کنی؟» arrives on the right.

const KEY = 'table-call';
/** A scan is good for this long: a guest's visit, not tomorrow's. */
const KEEP_HOURS = 4;
const POLL_MS = 8000;
/** The entrance: the circle opens into the sentence after this… */
const OPEN_AFTER_MS = 500;
/** …and closes again at this moment after the page loaded (when the menu's «انتخاب برای من» arrives). */
const CLOSE_AT_MS = 3000;
/** How long the button stays green after the waiter answered. */
const ANSWERED_MS = 12_000;

type Kind = 'WAITER' | 'BILL';
interface Call {
	id: string;
	kind: Kind;
	status: 'OPEN' | 'DONE';
	createdAt: string;
	handledAt: string | null;
}
interface TableInfo {
	displayNumber: string;
	zoneFa: string;
}

const KIND_TEXT: Record<Kind, { ask: string; sent: string; done: string }> = {
	WAITER: { ask: 'صدا کردن گارسون', sent: 'گارسون رو صدا کردی', done: 'گارسون داره میاد' },
	BILL: { ask: 'درخواست صورت‌حساب', sent: 'صورت‌حساب خواستی', done: 'صورت‌حساب داره میاد' },
};

/** The table token: from the address (a fresh scan), or remembered from a scan in the last few hours. */
function readToken(): string | null {
	const url = new URL(window.location.href);
	const fresh = url.searchParams.get('table');
	if (fresh && /^[\w-]{8,40}$/.test(fresh)) {
		// a new scan (another table, or the same one later): the sentence shows once again
		safeStorage.set(KEY, JSON.stringify({ token: fresh, at: Date.now(), intro: false }));
		url.searchParams.delete('table');
		window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
		return fresh;
	}
	try {
		const saved = JSON.parse(safeStorage.get(KEY) ?? 'null') as { token: string; at: number } | null;
		if (saved && Date.now() - saved.at < KEEP_HOURS * 3600_000) return saved.token;
	} catch {
		// a damaged entry: as if there were none
	}
	safeStorage.remove(KEY);
	return null;
}

/** Whether this scan's button already showed its sentence (on the first page after the scan). */
function introDone(): boolean {
	try {
		return Boolean((JSON.parse(safeStorage.get(KEY) ?? 'null') as { intro?: boolean } | null)?.intro);
	} catch {
		return false;
	}
}

function markIntroDone(): void {
	try {
		const saved = JSON.parse(safeStorage.get(KEY) ?? 'null') as Record<string, unknown> | null;
		if (saved) safeStorage.set(KEY, JSON.stringify({ ...saved, intro: true }));
	} catch {
		// nothing saved: the sentence may show again, no harm
	}
}

const BellIcon = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
		<path d="M10 20.5a2 2 0 0 0 4 0" />
		<path d="M12 3v2" />
	</svg>
);

const ReceiptIcon = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M6 3h12v18l-2.5-1.6L13 21l-2.5-1.6L8 21l-2-1.6z" />
		<path d="M9 8h6M9 12h6M9 16h3" />
	</svg>
);

export function TableCall() {
	const [token, setToken] = useState<string | null>(null);
	const [table, setTable] = useState<TableInfo | null>(null);
	const [calls, setCalls] = useState<Call[]>([]);
	const [open, setOpen] = useState(false);
	const [busy, setBusy] = useState<Kind | null>(null);
	const [message, setMessage] = useState<string | null>(null);
	const sheetRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);

	useEffect(() => setToken(readToken()), []);

	// the entrance (once, when the button first appears): open into the sentence, then back to the circle
	const shown = Boolean(token && table);
	const [expanded, setExpanded] = useState(false);
	const [hovered, setHovered] = useState(false);
	useEffect(() => {
		if (!shown) return;
		// only once per scan: on the next pages the circle comes without its sentence
		if (introDone()) return;
		markIntroDone();
		const open = window.setTimeout(() => setExpanded(true), OPEN_AFTER_MS);
		const close = window.setTimeout(() => setExpanded(false), Math.max(OPEN_AFTER_MS + 1500, CLOSE_AT_MS - performance.now()));
		return () => {
			window.clearTimeout(open);
			window.clearTimeout(close);
		};
	}, [shown]);

	// an answered call is shown (green) for a few seconds from the moment this phone saw it, then the button is plain again
	const [seenDone, setSeenDone] = useState<Record<string, number>>({});
	const [, tick] = useState(0);
	useEffect(() => {
		const fresh = calls.filter((c) => c.status === 'DONE' && !seenDone[c.id]);
		if (!fresh.length) return;
		setSeenDone((seen) => ({ ...seen, ...Object.fromEntries(fresh.map((c) => [c.id, Date.now()])) }));
		const timer = window.setTimeout(() => tick((n) => n + 1), ANSWERED_MS + 50);
		return () => window.clearTimeout(timer);
	}, [calls, seenDone]);

	const refresh = useCallback(async () => {
		if (!token) return;
		try {
			const data = await api<{ table: TableInfo; calls: Call[] }>(`/api/table-call/${encodeURIComponent(token)}`);
			setTable(data.table);
			setCalls(data.calls);
		} catch (error) {
			// a code that no longer works (codes replaced, table switched off): the button goes
			if (error instanceof ApiError && error.status === 404) {
				safeStorage.remove(KEY);
				setToken(null);
				setTable(null);
			}
		}
	}, [token]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	// while a call waits (or was just answered), its state is read again every few seconds
	const waiting = calls.some((c) => c.status === 'OPEN');
	const isFreshDone = (c: Call) => c.status === 'DONE' && Date.now() - (seenDone[c.id] ?? Date.now()) < ANSWERED_MS;
	const answered = calls.some(isFreshDone);
	useEffect(() => {
		if (!waiting && !answered) return;
		const timer = window.setInterval(() => document.visibilityState === 'visible' && void refresh(), POLL_MS);
		return () => window.clearInterval(timer);
	}, [waiting, answered, refresh]);

	// the sheet: Escape closes it and the focus goes back to the button
	useEffect(() => {
		if (!open) return;
		const button = buttonRef.current;
		sheetRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
		const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
		document.addEventListener('keydown', escape);
		return () => {
			document.removeEventListener('keydown', escape);
			button?.focus();
		};
	}, [open]);

	if (!token || !table) return null;

	const openCall = (kind: Kind) => calls.find((c) => c.kind === kind && c.status === 'OPEN');
	const doneCall = calls.find(isFreshDone);

	const send = async (kind: Kind) => {
		setBusy(kind);
		setMessage(null);
		try {
			const data = await api<{ calls: Call[] }>(`/api/table-call/${encodeURIComponent(token)}`, { method: 'POST', body: { kind } });
			setCalls(data.calls);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'درخواست فرستاده نشد.');
		} finally {
			setBusy(null);
		}
	};

	const cancel = async (call: Call) => {
		try {
			const data = await api<{ calls: Call[] }>(`/api/table-call/${encodeURIComponent(token)}/${call.id}`, { method: 'DELETE' });
			setCalls(data.calls);
		} catch (error) {
			setMessage(error instanceof Error ? error.message : 'لغو نشد.');
		}
	};

	const tableName = `میز ${faDigits(table.displayNumber)}`;
	const state = waiting ? 'is-waiting' : doneCall ? 'is-answered' : '';
	const label = waiting
		? KIND_TEXT[calls.find((c) => c.status === 'OPEN')!.kind].sent
		: doneCall
			? KIND_TEXT[doneCall.kind].done
			: 'صدا کردن گارسون';

	return (
		<>
			<button
				type="button"
				ref={buttonRef}
				className={`tc-fab ${state}${expanded || hovered ? ' expanded' : ''}`}
				aria-label={`${tableName}: ${label}`}
				onMouseEnter={() => setHovered(true)}
				onMouseLeave={() => setHovered(false)}
				onFocus={() => setHovered(true)}
				onBlur={() => setHovered(false)}
				aria-haspopup="dialog"
				aria-expanded={open}
				onClick={() => {
					setMessage(null);
					setOpen(true);
				}}
			>
				<span className="tc-fab-icon">{BellIcon}</span>
				<span className="tc-fab-text" aria-hidden="true">
					<small>{tableName}</small>
					<strong>{label}</strong>
				</span>
			</button>

			{open && (
				<div className="tc-layer" role="presentation" onClick={(event) => event.target === event.currentTarget && setOpen(false)}>
					<div className="tc-sheet" role="dialog" aria-modal="true" aria-labelledby="tcTitle" ref={sheetRef}>
						<div className="tc-head">
							<div>
								<h2 id="tcTitle">{tableName}</h2>
								{table.zoneFa && <p>{table.zoneFa}</p>}
							</div>
							<button type="button" className="tc-close" aria-label="بستن" onClick={() => setOpen(false)}>
								×
							</button>
						</div>

						<div className="tc-actions">
							{(['WAITER', 'BILL'] as const).map((kind) => {
								const pending = openCall(kind);
								return (
									<div key={kind} className={`tc-action${pending ? ' is-sent' : ''}`}>
										<button type="button" disabled={busy !== null || Boolean(pending)} onClick={() => send(kind)}>
											<span className="tc-action-icon">{kind === 'WAITER' ? BellIcon : ReceiptIcon}</span>
											<span>{pending ? `${KIND_TEXT[kind].sent} ✓` : busy === kind ? 'در حال فرستادن…' : KIND_TEXT[kind].ask}</span>
										</button>
										{pending && (
											<button type="button" className="tc-cancel" onClick={() => cancel(pending)}>
												لغو
											</button>
										)}
									</div>
								);
							})}
						</div>

						<p className="tc-note" role="status">
							{message ??
								(waiting
									? 'درخواستت به پیشخوان رسید؛ همین‌جا می‌بینی کی رسیدگی شد.'
									: doneCall
										? `${KIND_TEXT[doneCall.kind].done}.`
										: 'درخواستت فوراً به پیشخوان کافه می‌رسه.')}
						</p>
					</div>
				</div>
			)}
		</>
	);
}
