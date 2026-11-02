import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { fa } from './names';
import { useLatest } from '../../../shared/useLatest';
import type { Deck } from '../data';
import { UI_ICONS } from './icons';
import { playSound, setMuted, unlockAudio, useMuted } from './sound';
import { useWakeLock } from './screen';

// The building blocks every game screen is made of: the game frame (bar with exit, rules and sound), sheets,
// steppers and choice chips, the players/teams editor, the deck picker, «pass the phone», clock and scores.
// Styles: style/kit.css.

export { fa, finalNames, joinNames } from './names';

/** «۴:۰۵» */
export function formatClock(ms: number): string {
	const total = Math.ceil(ms / 1000);
	return fa(`${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`);
}

/** The colours of teams 1–4 (also used for the players' avatars). */
export const SIDE_COLORS = ['#9a5b43', '#4c6f80', '#6d7f45', '#b07a2e', '#7a5a86', '#3f7f72'];
export const sideColor = (index: number) => SIDE_COLORS[index % SIDE_COLORS.length];

// ─── Sheet (rules, place list, confirmations) ───────────────────────────────

export function Sheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children?: ReactNode; actions?: ReactNode }) {
	const close = useLatest(onClose);
	const panelRef = useRef<HTMLDivElement>(null);
	const titleId = useId();
	useEffect(() => {
		const previous = document.activeElement as HTMLElement | null;
		panelRef.current?.querySelector<HTMLElement>('button, [href], input')?.focus();
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape') close.current();
		};
		document.addEventListener('keydown', onKey);
		return () => {
			document.removeEventListener('keydown', onKey);
			previous?.focus?.();
		};
	}, [close]);
	return createPortal(
		<div className="gm-sheet-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
			<div className="gm-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} ref={panelRef}>
				<div className="gm-sheet-head">
					<h2 id={titleId}>{title}</h2>
					<button type="button" className="gm-icon-btn" aria-label="بستن" onClick={onClose}>
						{UI_ICONS.close}
					</button>
				</div>
				{children && <div className="gm-sheet-body">{children}</div>}
				{actions && <div className="gm-sheet-actions">{actions}</div>}
			</div>
		</div>,
		document.body,
	);
}

// ─── Game frame ───────────────────────────────────────────────────────────────

interface FrameProps {
	title: string;
	/** dark = the playing screens; light = setup and results. */
	theme: 'light' | 'dark';
	/** In the middle of a game: leaving asks first. */
	live: boolean;
	/** Leaving the game (✕): always a full exit, the game is not kept. */
	onExit: () => void;
	rules: ReactNode;
	children: ReactNode;
}

export function GameFrame({ title, theme, live, onExit, rules, children }: FrameProps) {
	const muted = useMuted();
	const [sheet, setSheet] = useState<'rules' | null>(null);
	useWakeLock(live);

	return (
		<div className={`gm-frame gm-${theme}`}>
			<header className="gm-bar">
				{/* خروج یعنی خروج کامل: بی‌سؤال، و بازی نیمه‌کاره هم پاک می‌شود */}
				<button type="button" className="gm-icon-btn" aria-label="خروج از بازی" onClick={onExit}>
					{UI_ICONS.close}
				</button>
				<h1 className="gm-bar-title">{title}</h1>
				<div className="gm-bar-tools">
					<button type="button" className="gm-icon-btn" aria-label="قوانین بازی" onClick={() => setSheet('rules')}>
						{UI_ICONS.rules}
					</button>
					<button
						type="button"
						className="gm-icon-btn"
						aria-label={muted ? 'روشن کردن صدا' : 'بی‌صدا'}
						aria-pressed={muted}
						onClick={() => {
							unlockAudio();
							setMuted(!muted);
						}}
					>
						{muted ? UI_ICONS.soundOff : UI_ICONS.soundOn}
					</button>
				</div>
			</header>
			<main className="gm-stage">{children}</main>
			{sheet === 'rules' && (
				<Sheet title={`قوانین ${title}`} onClose={() => setSheet(null)}>
					<div className="gm-rules">{rules}</div>
				</Sheet>
			)}
		</div>
	);
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
	return (
		<section className="gm-field">
			<h2 className="gm-field-label">{label}</h2>
			{children}
			{hint && <p className="gm-field-hint">{hint}</p>}
		</section>
	);
}

export function Stepper({
	value,
	min,
	max,
	onChange,
	unit,
	label,
}: {
	value: number;
	min: number;
	max: number;
	onChange: (value: number) => void;
	unit?: string;
	label: string;
}) {
	return (
		<div className="gm-stepper" role="group" aria-label={label}>
			<button type="button" className="gm-step-btn" aria-label="بیشتر" disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}>
				{UI_ICONS.plus}
			</button>
			<output className="gm-step-value" aria-live="polite">
				<strong>{fa(value)}</strong>
				{unit && <span>{unit}</span>}
			</output>
			<button type="button" className="gm-step-btn" aria-label="کمتر" disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}>
				{UI_ICONS.minus}
			</button>
		</div>
	);
}

export function Choices<T extends string | number | boolean>({
	options,
	value,
	onChange,
	label,
}: {
	options: readonly { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
	label: string;
}) {
	return (
		<div className="gm-choices" role="radiogroup" aria-label={label}>
			{options.map((option) => (
				<button
					key={String(option.value)}
					type="button"
					role="radio"
					aria-checked={option.value === value}
					className={`gm-chip${option.value === value ? ' on' : ''}`}
					onClick={() => onChange(option.value)}
				>
					{option.label}
				</button>
			))}
		</div>
	);
}

/** Names of the players (or teams): one field each, add and remove within [min, max]. */
export function NamesEditor({
	names,
	onChange,
	min,
	max,
	placeholder,
	addLabel,
	colored,
}: {
	names: string[];
	onChange: (names: string[]) => void;
	min: number;
	max: number;
	placeholder: (index: number) => string;
	addLabel: string;
	/** Teams: a colour dot before each name. */
	colored?: boolean;
}) {
	const listRef = useRef<HTMLOListElement>(null);
	const focusLast = useRef(false);
	useEffect(() => {
		if (!focusLast.current) return;
		focusLast.current = false;
		const inputs = listRef.current?.querySelectorAll('input');
		inputs?.[inputs.length - 1]?.focus();
	}, [names.length]);

	return (
		<div className="gm-names">
			<ol className="gm-names-list" ref={listRef}>
				{names.map((name, index) => (
					<li key={index} className="gm-name-row">
						<span className="gm-avatar" style={{ background: sideColor(index) }} aria-hidden="true">
							{colored ? '' : fa(index + 1)}
						</span>
						<input
							value={name}
							maxLength={20}
							placeholder={placeholder(index)}
							aria-label={placeholder(index)}
							enterKeyHint="next"
							onChange={(event) => onChange(names.map((n, i) => (i === index ? event.target.value : n)))}
						/>
						<button
							type="button"
							className="gm-icon-btn gm-name-remove"
							aria-label={`حذف ${name.trim() || placeholder(index)}`}
							disabled={names.length <= min}
							onClick={() => onChange(names.filter((_, i) => i !== index))}
						>
							{UI_ICONS.trash}
						</button>
					</li>
				))}
			</ol>
			{names.length < max && (
				<button
					type="button"
					className="gm-add"
					onClick={() => {
						focusLast.current = true;
						onChange([...names, '']);
					}}
				>
					{UI_ICONS.plus}
					<span>{addLabel}</span>
				</button>
			)}
		</div>
	);
}

/** The decks a game can draw from; at least one stays chosen. `value` empty = all of them. */
export function DeckPicker({
	decks,
	value,
	onChange,
	countOf,
}: {
	decks: readonly Deck[];
	value: number[];
	onChange: (ids: number[]) => void;
	/** Cards of the deck this game can use. */
	countOf: (deck: Deck) => number;
}) {
	const chosen = value.filter((id) => decks.some((deck) => deck.id === id));
	const all = chosen.length === 0 || chosen.length === decks.length;
	const isOn = (id: number) => all || chosen.includes(id);
	const toggle = (id: number) => {
		const current = all ? decks.map((deck) => deck.id) : chosen;
		const next = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
		if (!next.length) return;
		onChange(next.length === decks.length ? [] : next);
	};
	return (
		<div className="gm-decks">
			{decks.map((deck) => (
				<button key={deck.id} type="button" aria-pressed={isOn(deck.id)} className={`gm-chip gm-deck${isOn(deck.id) ? ' on' : ''}`} onClick={() => toggle(deck.id)}>
					<span>{deck.name}</span>
					<small>{fa(countOf(deck))}</small>
				</button>
			))}
		</div>
	);
}

// ─── Playing pieces ───────────────────────────────────────────────────────────

/** «Give the phone to …»: only the next player's name, so nobody sees the previous player's card. */
export function Handoff({ name, color, note, action, onReady }: { name: string; color?: string; note: string; action: string; onReady: () => void }) {
	return (
		<div className="gm-handoff">
			<span className="gm-handoff-avatar" style={color ? { background: color } : undefined} aria-hidden="true">
				{name.trim().charAt(0)}
			</span>
			<p className="gm-handoff-note">{note}</p>
			<p className="gm-handoff-name">{name}</p>
			<button
				type="button"
				className="gm-btn gm-btn-light gm-btn-big"
				onClick={() => {
					unlockAudio();
					playSound('tap');
					onReady();
				}}
			>
				{action}
			</button>
		</div>
	);
}

/** A ring that empties as the time runs out. */
export function ClockFace({ left, total, paused, size = 'big' }: { left: number; total: number; paused?: boolean; size?: 'big' | 'small' }) {
	const share = total > 0 ? Math.max(0, Math.min(1, left / total)) : 0;
	const r = 44;
	const length = 2 * Math.PI * r;
	const low = left <= 10_000;
	return (
		<div className={`gm-clock gm-clock-${size}${low ? ' low' : ''}${paused ? ' paused' : ''}`} role="timer" aria-label={`زمان باقی‌مانده ${formatClock(left)}`}>
			<svg viewBox="0 0 100 100" aria-hidden="true">
				<circle className="gm-clock-track" cx="50" cy="50" r={r} />
				<circle className="gm-clock-fill" cx="50" cy="50" r={r} strokeDasharray={length} strokeDashoffset={length * (1 - share)} />
			</svg>
			<span className="gm-clock-text" dir="ltr">
				{formatClock(left)}
			</span>
		</div>
	);
}

export function Scoreboard({ names, scores, current, colored }: { names: readonly string[]; scores: readonly number[]; current?: number; colored?: boolean }) {
	const best = Math.max(...scores, 0);
	return (
		<ol className="gm-scores">
			{names.map((name, index) => (
				<li key={index} className={`gm-score${index === current ? ' current' : ''}${scores[index] === best && best > 0 ? ' best' : ''}`}>
					<span className="gm-avatar" style={{ background: sideColor(index) }} aria-hidden="true">
						{colored ? '' : name.trim().charAt(0)}
					</span>
					<span className="gm-score-name">{name}</span>
					<strong className="gm-score-points" dir="ltr">
						{fa(scores[index])}
					</strong>
				</li>
			))}
		</ol>
	);
}
