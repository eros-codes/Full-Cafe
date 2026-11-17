import { useCallback, useEffect, useRef, useState } from 'react';
import { errorText } from '../../shared/api';
import { faDigits } from '../../shared/format';
import { ZONE_FA } from '../../shared/zones';
import { adminApi } from './adminApi';

// «صدا کردن گارسون» in the panel, for every role: a bell in the top bar with the number of open calls, its list
// («رسیدگی شد»), and for a new call a ding, a card at the top of the screen and the count in the tab's title.
// The server says when something changed over a live line (server-sent events); a slow read every 30 s covers a
// line that dropped. The panel must stay open on a phone or tablet at the counter: that is where calls are heard.

export interface WaiterCall {
	id: string;
	kind: 'WAITER' | 'BILL';
	status: 'OPEN' | 'DONE';
	createdAt: string;
	handledAt: string | null;
	table: { id: string; displayNumber: string; zone: string };
	handledBy: { name: string } | null;
}

interface CallsData {
	open: WaiterCall[];
	done: WaiterCall[];
	now: string;
}

export const CALL_FA: Record<WaiterCall['kind'], string> = { WAITER: 'گارسون', BILL: 'صورت‌حساب' };

const BellIcon = (
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
		<path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
		<path d="M10 20.5a2 2 0 0 0 4 0" />
	</svg>
);

/** «۳ دقیقه پیش» */
function ago(iso: string, now: number): string {
	const minutes = Math.max(0, Math.floor((now - new Date(iso).getTime()) / 60_000));
	if (minutes < 1) return 'همین الان';
	if (minutes < 60) return `${minutes.toLocaleString('fa-IR')} دقیقه پیش`;
	return `${Math.floor(minutes / 60).toLocaleString('fa-IR')} ساعت پیش`;
}

const tableName = (call: WaiterCall) => `میز ${faDigits(call.table.displayNumber)}`;

// ─── the ding ────────────────────────────────────────────────────────────────

let audio: AudioContext | null = null;
/** Browsers only play sound after the page was touched once: the first click in the panel opens the sound. */
function unlockSound() {
	try {
		audio ??= new AudioContext();
		if (audio.state === 'suspended') void audio.resume();
	} catch {
		audio = null;
	}
}

/** Two soft notes (a bell's «ding-dong»), drawn by the browser: no sound file. */
function ding() {
	if (!audio || audio.state !== 'running') return;
	const now = audio.currentTime;
	for (const [i, freq] of [880, 660].entries()) {
		const osc = audio.createOscillator();
		const gain = audio.createGain();
		osc.type = 'sine';
		osc.frequency.value = freq;
		const start = now + i * 0.22;
		gain.gain.setValueAtTime(0.0001, start);
		gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.9);
		osc.connect(gain).connect(audio.destination);
		osc.start(start);
		osc.stop(start + 1);
	}
}

// ─── data ────────────────────────────────────────────────────────────────────

export function useWaiterCalls(enabled: boolean) {
	const [data, setData] = useState<CallsData | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [fresh, setFresh] = useState<WaiterCall[]>([]);
	const seen = useRef<Set<string> | null>(null);

	const load = useCallback(async () => {
		try {
			const next = await adminApi<CallsData>('/api/admin/waiter-calls');
			setError(null);
			setData(next);
			// a call not seen before (not on the first read): ding and a card
			const known = seen.current;
			const added = known ? next.open.filter((c) => !known.has(c.id)) : [];
			seen.current = new Set(next.open.map((c) => c.id));
			if (added.length) {
				ding();
				setFresh((list) => [...list, ...added]);
			}
			setFresh((list) => list.filter((c) => next.open.some((o) => o.id === c.id)));
		} catch (err) {
			setError(errorText(err));
		}
	}, []);

	useEffect(() => {
		if (!enabled) return;
		void load();
		const source = new EventSource('/api/admin/waiter-calls/stream', { withCredentials: true });
		source.addEventListener('changed', () => void load());
		// the line came back after a drop: something may have happened meanwhile
		source.addEventListener('open', () => void load());
		const slow = window.setInterval(() => void load(), 30_000);
		document.addEventListener('pointerdown', unlockSound);
		return () => {
			source.close();
			window.clearInterval(slow);
			document.removeEventListener('pointerdown', unlockSound);
		};
	}, [enabled, load]);

	// «(۲) …» in the tab's title while calls wait
	const openCount = data?.open.length ?? 0;
	useEffect(() => {
		const base = document.title.replace(/^\(\S+\) /, '');
		document.title = openCount ? `(${openCount.toLocaleString('fa-IR')}) ${base}` : base;
	}, [openCount]);

	const handle = useCallback(async (id: string) => {
		try {
			setData(await adminApi<CallsData>(`/api/admin/waiter-calls/${id}`, { method: 'PATCH', body: {} }));
			setFresh((list) => list.filter((c) => c.id !== id));
		} catch (err) {
			setError(errorText(err));
			void load();
		}
	}, [load]);

	const dismiss = useCallback((id: string) => setFresh((list) => list.filter((c) => c.id !== id)), []);

	return { data, error, fresh, handle, dismiss };
}

// ─── the bell and the cards ──────────────────────────────────────────────────

export function WaiterCallBell({ calls }: { calls: ReturnType<typeof useWaiterCalls> }) {
	const [open, setOpen] = useState(false);
	const [now, setNow] = useState(() => Date.now());
	const ref = useRef<HTMLDivElement>(null);
	const { data, error, handle } = calls;
	const count = data?.open.length ?? 0;

	// «… دقیقه پیش» moves on while the list is open
	useEffect(() => {
		if (!open) return;
		setNow(Date.now());
		const timer = window.setInterval(() => setNow(Date.now()), 20_000);
		const outside = (event: MouseEvent) => !ref.current?.contains(event.target as Node) && setOpen(false);
		const escape = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
		document.addEventListener('mousedown', outside);
		document.addEventListener('keydown', escape);
		return () => {
			window.clearInterval(timer);
			document.removeEventListener('mousedown', outside);
			document.removeEventListener('keydown', escape);
		};
	}, [open]);

	return (
		<div className="adm-user wc" ref={ref}>
			<button
				type="button"
				className={`icon-btn wc-bell${count ? ' has-calls' : ''}`}
				id="waiterCalls"
				aria-haspopup="dialog"
				aria-expanded={open}
				aria-label={count ? `درخواست میزها: ${count.toLocaleString('fa-IR')} درخواست باز` : 'درخواست میزها'}
				title="درخواست میزها"
				onClick={() => setOpen((o) => !o)}
			>
				{BellIcon}
				{count > 0 && <span className="wc-count">{count.toLocaleString('fa-IR')}</span>}
			</button>
			{open && (
				<div className="adm-menu wc-panel" role="dialog" aria-label="درخواست میزها">
					<div className="adm-menu-head">
						<strong>درخواست میزها</strong>
						<small>مهمان‌هایی که کد QR میز را اسکن کرده‌اند</small>
					</div>
					{error && <div className="notice danger">{error}</div>}
					{!data ? (
						<p className="wc-empty">در حال خواندن…</p>
					) : !data.open.length && !data.done.length ? (
						<p className="wc-empty">درخواستی نیست.</p>
					) : (
						<ul className="wc-list">
							{data.open.map((call) => (
								<li key={call.id} className={`wc-item is-${call.kind.toLowerCase()}`}>
									<div className="wc-item-text">
										<strong>
											{tableName(call)} · {CALL_FA[call.kind]}
										</strong>
										<small>
											{ZONE_FA[call.table.zone] ?? ''} · {ago(call.createdAt, now)}
										</small>
									</div>
									<button type="button" className="primary-btn" onClick={() => handle(call.id)}>
										رسیدگی شد
									</button>
								</li>
							))}
							{data.done.map((call) => (
								<li key={call.id} className="wc-item is-done">
									<div className="wc-item-text">
										<strong>
											{tableName(call)} · {CALL_FA[call.kind]}
										</strong>
										<small>
											رسیدگی شد{call.handledBy ? ` · ${call.handledBy.name}` : ''} · {ago(call.handledAt ?? call.createdAt, now)}
										</small>
									</div>
								</li>
							))}
						</ul>
					)}
					<p className="wc-foot">صدای زنگ بعد از اولین کلیک در پنل فعال می‌شود؛ پنل را روی گوشی یا تبلت پیشخوان باز نگه دارید.</p>
				</div>
			)}
		</div>
	);
}

/** A card for each new call, at the top of the screen, until it is answered or closed. */
export function WaiterCallToasts({ calls }: { calls: ReturnType<typeof useWaiterCalls> }) {
	const { fresh, handle, dismiss } = calls;
	if (!fresh.length) return null;
	return (
		<div className="wc-toasts" role="region" aria-label="درخواست‌های تازه‌ی میزها" aria-live="assertive">
			{fresh.map((call) => (
				<div key={call.id} className={`wc-toast is-${call.kind.toLowerCase()}`}>
					<span className="wc-toast-icon">{BellIcon}</span>
					<div className="wc-toast-text">
						<strong>{tableName(call)}</strong>
						<span>{call.kind === 'WAITER' ? 'گارسون می‌خواد' : 'صورت‌حساب می‌خواد'}</span>
					</div>
					<button type="button" className="primary-btn" onClick={() => handle(call.id)}>
						رسیدگی شد
					</button>
					<button type="button" className="wc-toast-close" aria-label="بستن" onClick={() => dismiss(call.id)}>
						×
					</button>
				</div>
			))}
		</div>
	);
}
