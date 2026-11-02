import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Card, Deck } from '../data';
import { decksFor } from '../data';
import { clockLeft, isPaused, pauseClock, resumeClock } from '../kit/clock';
import { useNow } from '../kit/useNow';
import { cardPool, pickCards, readSeen, rememberSeen } from '../kit/deck';
import { GAME_ICONS, UI_ICONS } from '../kit/icons';
import { rememberDecks, rememberNames, rememberedDecks, rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { enterFullscreen, exitFullscreen, usePauseWhenHidden } from '../kit/screen';
import { playSound, unlockAudio, vibrate } from '../kit/sound';
import { Choices, ClockFace, DeckPicker, Field, GameFrame, NamesEditor, Scoreboard, Stepper, fa, finalNames, joinNames, sideColor } from '../kit/ui';
import {
	WORD_LIMITS,
	answer,
	endsTurn,
	currentRound,
	currentSide,
	finishTurn,
	initialWordState,
	leaders,
	playAgain,
	startTurn,
	startWordGame,
	timeUp,
	toggleResult,
	totalTurns,
	turnPoints,
	type Outcome,
	type WordMode,
	type WordResult,
	type WordSettings,
	type WordState,
} from './engine';
import { requestTiltPermission, resetTiltStatus, useTilt } from './useTilt';

// «گوشی رو پیشونی», «پانتومیم» and «کلمات ممنوعه»: one screen flow (setup → ready → turn → review → …
// → winner) on the shared engine (engine.ts). What differs per game is in MODES below.

const VERSION = 1;
/** Fewer cards than this in the chosen decks and a game would run out. */
const MIN_CARDS = 10;
const TEAM_NAMES = ['تیم قهوه', 'تیم چای', 'تیم کیک', 'تیم بستنی'];

interface ModeText {
	title: string;
	icon: ReactNode;
	intro: string;
	teams: boolean;
	sidesLabel: string;
	placeholder: (index: number) => string;
	addLabel: string;
	turnNote: (side: string) => string;
	rules: ReactNode;
}

const MODES: Record<WordMode, ModeText> = {
	heads_up: {
		title: 'گوشی رو پیشونی',
		icon: GAME_ICONS.heads_up,
		intro: 'گوشی رو پیشونیته و کلمه رو نمی‌بینی؛ بقیه توضیح می‌دن و تو حدس می‌زنی. گوشی رو پایین بیار یعنی گفتم، بالا ببر یعنی رد.',
		teams: false,
		sidesLabel: 'بازیکن‌ها',
		placeholder: (index) => `بازیکن ${fa(index + 1)}`,
		addLabel: 'بازیکن تازه',
		turnNote: (side) => `${side} گوشی رو بگیره و بذاره رو پیشونیش، صفحه رو به بقیه. بقیه کلمه رو توضیح بدن، بدون گفتن خودش.`,
		rules: (
			<>
				<p>نوبت هر کی بشه، گوشی رو روی پیشونیش می‌ذاره طوری که صفحه رو به بقیه باشه و خودش کلمه رو نبینه.</p>
				<ul>
					<li>بقیه کلمه رو با توضیح، صدا یا ادا می‌فهمونن؛ فقط خود کلمه رو نباید بگن.</li>
					<li>حدس زدی: گوشی رو پایین بیار (سرت رو جلو خم کن). نمی‌دونی: گوشی رو بالا ببر (سرت رو عقب ببر).</li>
					<li>هر کلمه‌ی درست یک امتیاز داره. آخر نوبت لیست کلمه‌ها میاد و اگه چیزی اشتباه ثبت شده، درستش می‌کنید.</li>
					<li>اگه گوشی حسگر حرکت نداشت یا اجازه‌اش رو ندادی، دکمه‌های «گفت» و «رد» روی صفحه میاد که بقیه بزنن.</li>
				</ul>
			</>
		),
	},
	charades: {
		title: 'پانتومیم',
		icon: GAME_ICONS.charades,
		intro: 'کلمه رو فقط بازیگر می‌بینه و بدون حرف زدن، با ادا و اشاره به تیمش می‌فهمونه.',
		teams: true,
		sidesLabel: 'تیم‌ها',
		placeholder: (index) => TEAM_NAMES[index] ?? `تیم ${fa(index + 1)}`,
		addLabel: 'تیم تازه',
		turnNote: (side) => `یکی از «${side}» گوشی رو بگیره. کلمه رو فقط خودش ببینه و بدون حرف و صدا اجرا کنه.`,
		rules: (
			<>
				<p>تیم‌ها به نوبت بازی می‌کنن. هر نوبت یه نفر از تیم بازیگر می‌شه (نوبت بعد یه نفر دیگه).</p>
				<ul>
					<li>بازیگر کلمه رو می‌بینه و بدون حرف زدن، بدون صدا و بدون اشاره به حرف‌ها، فقط با ادا اجراش می‌کنه.</li>
					<li>تیمش حدس زد: «گفتن». سخت بود: «رد».</li>
					<li>در حالت «یک کلمه در هر نوبت»، نوبت با اولین حدس درست تموم می‌شه؛ مثل پانتومیم کلاسیک.</li>
					<li>هر کلمه‌ی درست یک امتیاز. آخر بازی تیمی که امتیاز بیشتری داره برنده‌ست.</li>
				</ul>
			</>
		),
	},
	taboo: {
		title: 'کلمات ممنوعه',
		icon: GAME_ICONS.taboo,
		intro: 'کلمه رو برای تیمت توضیح بده، بدون اینکه خودش یا کلمه‌های ممنوعِ زیرش رو بگی.',
		teams: true,
		sidesLabel: 'تیم‌ها',
		placeholder: (index) => TEAM_NAMES[index] ?? `تیم ${fa(index + 1)}`,
		addLabel: 'تیم تازه',
		turnNote: (side) => `یکی از «${side}» توضیح بده. یکی از تیم حریف کنارش باشه و کلمه‌های ممنوع رو بپاد.`,
		rules: (
			<>
				<p>تیم‌ها به نوبت بازی می‌کنن. هر نوبت یه نفر از تیم کلمه‌ها رو توضیح می‌ده و بقیه‌ی تیمش حدس می‌زنن.</p>
				<ul>
					<li>خود کلمه و کلمه‌های ممنوعِ زیرش رو نباید گفت؛ نه حتی بخشی از اون‌ها یا شکل دیگه‌شون.</li>
					<li>اشاره و ادا هم ممنوعه؛ فقط حرف زدن.</li>
					<li>یکی از تیم حریف کنار توضیح‌دهنده می‌ایسته و اگه کلمه‌ی ممنوع گفته شد، «خطا» رو می‌زنه.</li>
					<li>درست: یک امتیاز. رد: بدون امتیاز. خطا: یک امتیاز منفی.</li>
				</ul>
			</>
		),
	},
};

const SECOND_LABEL = (s: number) => (s % 60 === 0 ? `${fa(s / 60)} دقیقه` : s > 60 ? `${fa(Math.floor(s / 60))}:${fa(String(s % 60).padStart(2, '0'))}` : `${fa(s)} ثانیه`);

export default function WordGame({ mode, decks, onExit }: { mode: WordMode; decks: Deck[]; onExit: () => void }) {
	const text = MODES[mode];
	const limits = WORD_LIMITS[mode];
	const modeDecks = useMemo(() => decksFor(decks, mode), [decks, mode]);
	const [state, setState] = useSavedGame<WordState>(
		mode,
		VERSION,
		() =>
			initialWordState(
				mode,
				text.teams ? rememberedNames('teams', limits.sides.min, limits.sides.max) : rememberedNames('players', limits.sides.min, limits.sides.max),
				rememberedDecks(mode),
			),
		(s) => s.phase.kind !== 'setup',
	);
	// «کلمات ممنوعه» only draws cards that have forbidden words
	const pool = useMemo(
		() => cardPool(modeDecks, mode, state.settings.deckIds, (card) => mode !== 'taboo' || Boolean(card.forbidden?.length)),
		[modeDecks, mode, state.settings.deckIds],
	);

	/** The next card: not used in this game, preferably not seen lately on this phone. */
	const draw = (used: readonly number[]): Card | null => {
		const fresh = pickCards(pool, 1, new Set([...used, ...readSeen(mode)]));
		const notUsed = fresh.filter((card) => !used.includes(card.id));
		const card = notUsed[0] ?? pickCards(pool, 1, new Set())[0] ?? null;
		if (card) rememberSeen(mode, [card.id], pool.length);
		return card;
	};

	const { phase } = state;
	const sideNames = state.settings.sides;
	const dark = phase.kind === 'play';
	// full screen is only for the turn itself («گوشی رو پیشونی»); the list after it is read normally
	useEffect(() => {
		if (phase.kind === 'review' || phase.kind === 'over' || phase.kind === 'setup') exitFullscreen();
	}, [phase.kind]);

	return (
		<GameFrame title={text.title} theme={dark ? 'dark' : 'light'} live={phase.kind !== 'setup'} onExit={onExit} rules={text.rules}>
			{phase.kind === 'setup' && (
				<WordSetup
					mode={mode}
					state={state}
					decks={modeDecks}
					poolSize={pool.length}
					onChange={setState}
					onStart={(settings) => {
						rememberNames(text.teams ? 'teams' : 'players', state.settings.sides);
						rememberDecks(mode, settings.deckIds);
						setState(startWordGame(settings));
					}}
				/>
			)}
			{phase.kind === 'ready' && (
				<Ready
					mode={mode}
					state={state}
					onStart={(card) => setState(startTurn(state, card))}
					draw={() => draw(state.used)}
				/>
			)}
			{phase.kind === 'play' &&
				(mode === 'heads_up' ? (
					<HeadsUpPlay state={state} onState={setState} draw={draw} />
				) : (
					<WordPlay mode={mode} state={state} onState={setState} draw={draw} />
				))}
			{phase.kind === 'review' && (
				<Review
					mode={mode}
					side={sideNames[currentSide(state)]}
					results={phase.results}
					onToggle={(index) => setState(toggleResult(state, index))}
					onDone={() => {
						const next = finishTurn(state);
						if (next.phase.kind === 'over') playSound('win');
						setState(next);
					}}
				/>
			)}
			{phase.kind === 'over' && (
				<Over
					state={state}
					teams={text.teams}
					onAgain={() => setState(playAgain(state))}
					onSetup={() => setState({ ...state, scores: state.settings.sides.map(() => 0), turn: 0, used: [], phase: { kind: 'setup' } })}
				/>
			)}
		</GameFrame>
	);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function WordSetup({
	mode,
	state,
	decks,
	poolSize,
	onChange,
	onStart,
}: {
	mode: WordMode;
	state: WordState;
	decks: Deck[];
	poolSize: number;
	onChange: (state: WordState) => void;
	onStart: (settings: WordSettings) => void;
}) {
	const text = MODES[mode];
	const limits = WORD_LIMITS[mode];
	const { settings } = state;
	const set = (patch: Partial<WordSettings>) => onChange({ ...state, settings: { ...settings, ...patch } });
	const enough = poolSize >= MIN_CARDS;
	const countOf = (deck: Deck) => (mode === 'taboo' ? deck.cards.filter((card) => card.forbidden?.length).length : deck.cards.length);

	return (
		<div className="gm-setup">
			<div className="gm-intro">
				<span className="gm-intro-icon" aria-hidden="true">
					{text.icon}
				</span>
				<p>{text.intro}</p>
			</div>
			<Field label={text.sidesLabel} hint={`${fa(limits.sides.min)} تا ${fa(limits.sides.max)} ${text.teams ? 'تیم' : 'نفر'}`}>
				<NamesEditor
					names={settings.sides}
					min={limits.sides.min}
					max={limits.sides.max}
					placeholder={text.placeholder}
					addLabel={text.addLabel}
					colored={text.teams}
					onChange={(sides) => set({ sides })}
				/>
			</Field>
			<Field label="زمان هر نوبت">
				<Choices label="زمان هر نوبت" value={settings.seconds} onChange={(seconds) => set({ seconds })} options={limits.seconds.map((s) => ({ value: s, label: SECOND_LABEL(s) }))} />
			</Field>
			{mode === 'charades' && (
				<Field label="هر نوبت">
					<Choices
						label="هر نوبت"
						value={settings.oneWord}
						onChange={(oneWord) => set({ oneWord })}
						options={[
							{ value: false, label: 'هر چند کلمه که برسید' },
							{ value: true, label: 'فقط یک کلمه' },
						]}
					/>
				</Field>
			)}
			<Field label="تعداد دور" hint={`هر ${text.teams ? 'تیم' : 'نفر'} در هر دور یک نوبت بازی می‌کنه.`}>
				<Stepper label="تعداد دور" value={settings.rounds} min={limits.rounds.min} max={limits.rounds.max} onChange={(rounds) => set({ rounds })} />
			</Field>
			{decks.length > 1 && (
				<Field label="کلمه‌ها از کدوم دسته‌ها؟">
					<DeckPicker decks={decks} value={settings.deckIds} onChange={(deckIds) => set({ deckIds })} countOf={countOf} />
				</Field>
			)}
			{!enough && <p className="gm-warn">کلمه‌های دسته‌های انتخاب‌شده کمه؛ دسته‌های بیشتری انتخاب کن.</p>}
			<div className="gm-sticky">
				<button
					type="button"
					className="gm-btn gm-btn-primary gm-btn-big"
					disabled={!enough}
					onClick={() => {
						unlockAudio();
						onStart({ ...settings, sides: finalNames(settings.sides, text.placeholder) });
					}}
				>
					شروع بازی
				</button>
			</div>
		</div>
	);
}

// ─── Between turns ────────────────────────────────────────────────────────────

function Ready({ mode, state, onStart, draw }: { mode: WordMode; state: WordState; onStart: (card: Card) => void; draw: () => Card | null }) {
	const text = MODES[mode];
	const side = currentSide(state);
	const name = state.settings.sides[side];
	const [step, setStep] = useState<'ready' | 'position' | 'count'>('ready');
	const [count, setCount] = useState(3);
	const [noCards, setNoCards] = useState(false);
	const started = useRef(false);

	const begin = () => {
		if (started.current) return;
		started.current = true;
		const card = draw();
		if (!card) {
			// the café switched the chosen decks off meanwhile: say so instead of a button that does nothing
			started.current = false;
			exitFullscreen();
			setStep('ready');
			setCount(3);
			setNoCards(true);
			return;
		}
		playSound('reveal');
		onStart(card);
	};

	// heads up: phone on the forehead (upright for a moment, or 3 seconds without a sensor) → 3, 2, 1 → go
	useTilt(mode === 'heads_up' && step === 'position', { onUpright: () => setStep('count'), onNoSensor: () => setStep('count') });
	useEffect(() => {
		if (step !== 'count') return;
		if (count === 0) {
			begin();
			return;
		}
		playSound('tick');
		const timer = window.setTimeout(() => setCount((c) => c - 1), 800);
		return () => window.clearTimeout(timer);
	}, [step, count]);

	if (step === 'position') {
		return (
			<div className="gm-center hu-position">
				<span className="hu-phone" aria-hidden="true">
					{UI_ICONS.phone}
				</span>
				<p className="gm-title">گوشی رو بذار رو پیشونیت</p>
				<p className="gm-muted">صفحه رو به بقیه. وقتی صاف نگهش داری، شروع می‌شه.</p>
				<button type="button" className="gm-btn gm-btn-ghost" onClick={() => setStep('count')}>
					شروع بدون صبر
				</button>
			</div>
		);
	}
	if (step === 'count') {
		return (
			<div className="gm-center hu-countdown">
				<p className="hu-count" aria-live="assertive">
					{count > 0 ? fa(count) : ''}
				</p>
			</div>
		);
	}
	return (
		<div className="gm-panel">
			<p className="gm-eyebrow">
				دور {fa(currentRound(state))} از {fa(state.settings.rounds)}
			</p>
			<div className="gm-turn">
				<span className="gm-turn-avatar" style={{ background: sideColor(side) }} aria-hidden="true">
					{text.teams ? '' : name.charAt(0)}
				</span>
				<p className="gm-turn-label">نوبت</p>
				<p className="gm-turn-name">{name}</p>
				<p className="gm-muted">{text.turnNote(name)}</p>
			</div>
			<Scoreboard names={state.settings.sides} scores={state.scores} current={side} colored={text.teams} />
			{noCards && (
				<p className="gm-warn" role="alert">
					کلمه‌ای برای ادامه نمونده؛ احتمالاً کافه دسته‌های این بازی رو تغییر داده. از ✕ خارج شو و بازی رو دوباره شروع کن.
				</p>
			)}
			<div className="gm-sticky">
				<button
					type="button"
					className="gm-btn gm-btn-primary gm-btn-big"
					disabled={noCards}
					onClick={async () => {
						unlockAudio();
						if (mode === 'heads_up') {
							enterFullscreen();
							resetTiltStatus();
							await requestTiltPermission();
							setStep('position');
						} else {
							begin();
						}
					}}
				>
					{mode === 'heads_up' ? 'آماده‌ام' : 'شروع نوبت'}
				</button>
			</div>
		</div>
	);
}

// ─── A turn: charades and taboo ───────────────────────────────────────────────

const FLASH_MS = 450;

function useTurnClock(state: WordState, onState: (state: WordState) => void, onEnd?: () => void) {
	const phase = state.phase.kind === 'play' ? state.phase : null;
	const paused = phase ? isPaused(phase.clock) : true;
	const now = useNow(Boolean(phase) && !paused, 200);
	const left = phase ? clockLeft(phase.clock, now) : 0;
	const lastTick = useRef<number | null>(null);
	const ended = useRef(false);
	useEffect(() => {
		if (!phase || paused) return;
		const seconds = Math.ceil(left / 1000);
		if (left > 0 && seconds <= 5 && lastTick.current !== seconds) {
			lastTick.current = seconds;
			playSound('tick');
		}
		if (left <= 0 && !ended.current) {
			ended.current = true;
			playSound('buzz');
			vibrate([250, 80, 250]);
			onEnd?.();
			onState(timeUp(state));
		}
	}, [left, paused, phase, state, onState, onEnd]);
	return { left, paused, total: state.settings.seconds * 1000 };
}

function WordPlay({ mode, state, onState, draw }: { mode: WordMode; state: WordState; onState: (state: WordState) => void; draw: (used: readonly number[]) => Card | null }) {
	const { left, paused, total } = useTurnClock(state, onState);
	const [flash, setFlash] = useState<Outcome | null>(null);
	// a call or another app: the turn waits (its card stays hidden until «ادامه»)
	usePauseWhenHidden(!paused, () => {
		if (state.phase.kind === 'play') onState({ ...state, phase: { ...state.phase, clock: pauseClock(state.phase.clock) } });
	});
	if (state.phase.kind !== 'play') return null;
	const { card, results, clock } = state.phase;
	const correct = results.filter((r) => r.outcome === 'correct').length;

	const respond = (outcome: Outcome) => {
		if (flash || paused) return;
		playSound(outcome === 'correct' ? 'correct' : outcome === 'buzz' ? 'buzz' : 'pass');
		if (outcome === 'buzz') vibrate(120);
		setFlash(outcome);
		window.setTimeout(() => setFlash(null), FLASH_MS);
		onState(answer(state, outcome, endsTurn(state, outcome) ? null : draw(state.used)));
	};

	return (
		<div className={`wd-play${flash ? ` flash-${flash}` : ''}`}>
			<div className="wd-top">
				<ClockFace left={left} total={total} paused={paused} size="small" />
				<span className="wd-side" style={{ borderColor: sideColor(currentSide(state)) }}>
					{state.settings.sides[currentSide(state)]}
				</span>
				<span className="wd-score" aria-label={`${fa(correct)} درست`}>
					{UI_ICONS.check}
					{fa(correct)}
				</span>
			</div>
			{paused ? (
				<div className="wd-card wd-card-paused">
					<p className="gm-title-light">مکث</p>
					<p className="gm-muted-light">کلمه تا ادامه‌ی بازی پنهانه.</p>
				</div>
			) : (
				<div className="wd-card" key={card.id}>
					<p className="wd-word">{card.text}</p>
					{mode === 'taboo' && card.forbidden && (
						<div className="wd-forbidden">
							<p>نگو:</p>
							<ul>
								{card.forbidden.map((word) => (
									<li key={word}>{word}</li>
								))}
							</ul>
						</div>
					)}
				</div>
			)}
			<div className={`wd-buttons wd-buttons-${mode === 'taboo' ? 3 : 2}`}>
				{mode === 'taboo' && (
					<button type="button" className="wd-btn wd-btn-buzz" disabled={paused} onClick={() => respond('buzz')}>
						{UI_ICONS.buzz}
						<span>خطا</span>
					</button>
				)}
				<button type="button" className="wd-btn wd-btn-pass" disabled={paused} onClick={() => respond('pass')}>
					{UI_ICONS.skip}
					<span>رد</span>
				</button>
				<button type="button" className="wd-btn wd-btn-correct" disabled={paused} onClick={() => respond('correct')}>
					{UI_ICONS.check}
					<span>{mode === 'taboo' ? 'درست' : 'گفتن'}</span>
				</button>
			</div>
			<button
				type="button"
				className="gm-tool wd-pause"
				onClick={() => onState({ ...state, phase: { ...state.phase, clock: paused ? resumeClock(clock) : pauseClock(clock) } as WordState['phase'] })}
			>
				{paused ? UI_ICONS.play : UI_ICONS.pause}
				<span>{paused ? 'ادامه' : 'مکث'}</span>
			</button>
		</div>
	);
}

// ─── A turn: heads up ─────────────────────────────────────────────────────────

function HeadsUpPlay({ state, onState, draw }: { state: WordState; onState: (state: WordState) => void; draw: (used: readonly number[]) => Card | null }) {
	const { left, total, paused } = useTurnClock(state, onState, exitFullscreen);
	const [flash, setFlash] = useState<Outcome | null>(null);
	const flashing = useRef(false);
	const stateRef = useRef(state);
	stateRef.current = state;
	// the phone left the forehead for a call or another app: the turn waits until the player taps «ادامه»
	usePauseWhenHidden(!paused, () => {
		const current = stateRef.current;
		if (current.phase.kind === 'play') onState({ ...current, phase: { ...current.phase, clock: pauseClock(current.phase.clock) } });
	});

	const respond = (outcome: Outcome) => {
		if (flashing.current || stateRef.current.phase.kind !== 'play') return;
		flashing.current = true;
		playSound(outcome === 'correct' ? 'correct' : 'pass');
		vibrate(outcome === 'correct' ? 60 : [40, 40, 40]);
		setFlash(outcome);
		window.setTimeout(() => {
			flashing.current = false;
			setFlash(null);
		}, 650);
		onState(answer(stateRef.current, outcome, draw(stateRef.current.used)));
	};
	const sensor = useTilt(!paused, { onTilt: respond });

	if (state.phase.kind !== 'play') return null;
	const { card, clock } = state.phase;
	if (paused) {
		return (
			<div className="hu-play">
				<div className="hu-top">
					<ClockFace left={left} total={total} paused size="small" />
				</div>
				<div className="wd-card wd-card-paused">
					<p className="gm-title-light">مکث</p>
					<p className="gm-muted-light">کلمه تا ادامه‌ی نوبت پنهانه.</p>
				</div>
				<button
					type="button"
					className="gm-btn gm-btn-light gm-btn-big"
					onClick={() => {
						enterFullscreen();
						onState({ ...state, phase: { ...state.phase, clock: resumeClock(clock) } as WordState['phase'] });
					}}
				>
					ادامه
				</button>
			</div>
		);
	}
	return (
		<div className={`hu-play${flash ? ` flash-${flash}` : ''}`}>
			<div className="hu-top">
				<ClockFace left={left} total={total} size="small" />
			</div>
			<div className="hu-word-wrap">
				{flash ? (
					<p className="hu-flash">{flash === 'correct' ? 'گفت!' : 'رد'}</p>
				) : (
					<p className="hu-word" key={card.id}>
						{card.text}
					</p>
				)}
			</div>
			{sensor === 'off' ? (
				<div className="hu-buttons">
					<button type="button" className="wd-btn wd-btn-pass" onClick={() => respond('pass')}>
						{UI_ICONS.skip}
						<span>رد</span>
					</button>
					<button type="button" className="wd-btn wd-btn-correct" onClick={() => respond('correct')}>
						{UI_ICONS.check}
						<span>گفت</span>
					</button>
				</div>
			) : (
				<p className="hu-hint">پایین: گفت · بالا: رد</p>
			)}
		</div>
	);
}

// ─── After a turn, end of the game ───────────────────────────────────────────

const OUTCOME_FA: Record<Outcome, string> = { correct: 'درست', pass: 'رد', buzz: 'خطا' };

function Review({ mode, side, results, onToggle, onDone }: { mode: WordMode; side: string; results: WordResult[]; onToggle: (index: number) => void; onDone: () => void }) {
	const points = turnPoints(results);
	return (
		<div className="gm-panel">
			<p className="gm-eyebrow">نوبت «{side}» تموم شد</p>
			<p className="wd-points" dir="ltr">
				{points > 0 ? '+' : ''}
				{fa(points)}
			</p>
			{results.length > 0 ? (
				<>
					<p className="gm-muted">{mode === 'heads_up' ? 'اگه چیزی اشتباه ثبت شده، روی کلمه بزنید تا عوض شه.' : 'اگه اشتباهی دکمه‌ای زدید، روی کلمه بزنید تا عوض شه.'}</p>
					<ul className="wd-results">
						{results.map((result, index) => (
							<li key={`${result.id}-${index}`}>
								<button type="button" className={`wd-result wd-result-${result.outcome}`} onClick={() => onToggle(index)}>
									<span className="wd-result-text">{result.text}</span>
									<span className="wd-result-mark">
										{result.outcome === 'correct' ? UI_ICONS.check : result.outcome === 'buzz' ? UI_ICONS.buzz : UI_ICONS.skip}
										{OUTCOME_FA[result.outcome]}
									</span>
								</button>
							</li>
						))}
					</ul>
				</>
			) : (
				<p className="gm-muted">کلمه‌ای بازی نشد.</p>
			)}
			<div className="gm-sticky">
				<button type="button" className="gm-btn gm-btn-primary gm-btn-big" onClick={onDone}>
					ثبت امتیاز
				</button>
			</div>
		</div>
	);
}

function Over({ state, teams, onAgain, onSetup }: { state: WordState; teams: boolean; onAgain: () => void; onSetup: () => void }) {
	const winners = leaders(state.scores);
	const names = winners.map((i) => state.settings.sides[i]);
	const tie = winners.length > 1;
	return (
		<div className="gm-panel">
			<div className="gm-banner gm-banner-win">
				<span className="gm-banner-icon" aria-hidden="true">
					{UI_ICONS.trophy}
				</span>
				<h2>{tie ? 'مساوی شد!' : `${teams ? `«${names[0]}»` : names[0]} برد!`}</h2>
				<p>{tie ? `${joinNames(names)} با ${fa(state.scores[winners[0]])} امتیاز` : `با ${fa(state.scores[winners[0]])} امتیاز در ${fa(totalTurns(state) / state.settings.sides.length)} دور`}</p>
			</div>
			<Scoreboard names={state.settings.sides} scores={state.scores} colored={teams} />
			<div className="gm-sticky">
				<button type="button" className="gm-btn gm-btn-primary gm-btn-big" onClick={onAgain}>
					یه بازی دیگه با همین‌ها
				</button>
				<button type="button" className="gm-btn gm-btn-ghost" onClick={onSetup}>
					تغییر بازیکن‌ها یا تنظیمات
				</button>
			</div>
		</div>
	);
}
