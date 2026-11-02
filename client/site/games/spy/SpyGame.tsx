import { useEffect, useMemo, useRef, useState } from 'react';
import { decksFor, type Deck } from '../data';
import { clockLeft, isPaused, pauseClock, resumeClock } from '../kit/clock';
import { useNow } from '../kit/useNow';
import { cardPool, readSeen, rememberSeen } from '../kit/deck';
import { GAME_ICONS, UI_ICONS } from '../kit/icons';
import { rememberDecks, rememberNames, rememberedDecks, rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { usePauseWhenHidden } from '../kit/screen';
import { playSound, unlockAudio, vibrate } from '../kit/sound';
import {
	ClockFace,
	DeckPicker,
	Field,
	GameFrame,
	Handoff,
	Scoreboard,
	Sheet,
	Stepper,
	Choices,
	NamesEditor,
	fa,
	finalNames,
	joinNames,
	sideColor,
} from '../kit/ui';
import {
	SPY_MINUTES,
	SPY_PLAYERS,
	TWO_SPIES_FROM,
	accuse,
	declareGuess,
	defaultMinutes,
	guessPlace,
	initialSpyState,
	isSpy,
	nextSpyRound,
	startQuestions,
	startSpyGame,
	type SpyOutcome,
	type SpyRound,
	type SpyState,
} from './engine';

// 2: a spy who stops the game is checked first (new phase «declare», the guesser is kept in the outcome)
const VERSION = 2;
const MIN_PLACES = 10;
const playerPlaceholder = (index: number) => `بازیکن ${fa(index + 1)}`;

export const SPY_RULES = (
	<>
		<p>همه یه مکان مشترک می‌بینن، به‌جز جاسوس که نمی‌دونه کجایید.</p>
		<ul>
			<li>گوشی دست‌به‌دست می‌چرخه و هر کی کارت خودش رو می‌بینه، طوری که بقیه نبینن.</li>
			<li>
				به نوبت از هم سؤال بپرسید؛ هر کی جواب داد، نفر بعدی رو انتخاب می‌کنه و ازش می‌پرسه. سؤال نه اون‌قدر واضح باشه که جاسوس بفهمه کجایید، نه
				اون‌قدر مبهم که خودتون مشکوک بشید.
			</li>
			<li>هر وقت به یه نفر شک کردید یا وقت تموم شد، رأی بدید جاسوس کیه.</li>
			<li>اگه جاسوس رو بگیرید، یه شانس آخر داره: اگه مکان رو درست بگه، باز هم جاسوس‌ها می‌برن.</li>
			<li>
				جاسوس هر وقت بخواد می‌تونه بازی رو نگه داره و مکان رو حدس بزنه. درست بگه می‌بره، اشتباه بگه می‌بازه. گوشی اول کارتش رو بهش نشون می‌ده تا
				مطمئن بشه واقعاً جاسوسه.
			</li>
		</ul>
		<p className="gm-muted">امتیاز: اگه جاسوس‌ها ببرن، هر جاسوس ۲ امتیاز؛ اگه شهروندها ببرن، هر شهروند ۱ امتیاز.</p>
	</>
);

function outcomeText(outcome: SpyOutcome, round: SpyRound, players: readonly string[]): { title: string; line: string } {
	const spies = joinNames(round.spies.map((i) => players[i]));
	const many = round.spies.length > 1;
	switch (outcome.how) {
		case 'wrong':
			return { title: many ? 'جاسوس‌ها بردن!' : 'جاسوس برد!', line: `${players[outcome.accused]} جاسوس نبود! ${many ? 'جاسوس‌ها' : 'جاسوس'}: ${spies}` };
		case 'escaped':
			return { title: many ? 'جاسوس‌ها بردن!' : 'جاسوس برد!', line: `${players[outcome.accused]} گیر افتاد، ولی مکان رو درست گفت.` };
		case 'caught':
			return { title: 'شهروندها بردن!', line: `${players[outcome.accused]} جاسوس بود و مکان رو اشتباه گفت («${outcome.guess}»).` };
		case 'guessed':
			return { title: many ? 'جاسوس‌ها بردن!' : 'جاسوس برد!', line: `${players[outcome.by]} مکان رو درست حدس زد.${many ? ` جاسوس‌ها: ${spies}` : ''}` };
		case 'missed':
			return {
				title: 'شهروندها بردن!',
				line: `${players[outcome.by]} گفت «${outcome.guess}»، ولی اشتباه بود.${many ? ` جاسوس‌ها: ${spies}` : ''}`,
			};
	}
}

export default function SpyGame({ decks, onExit }: { decks: Deck[]; onExit: () => void }) {
	const spyDecks = useMemo(() => decksFor(decks, 'spy'), [decks]);
	const [state, setState] = useSavedGame<SpyState>(
		'spy',
		VERSION,
		() => initialSpyState(rememberedNames('players', SPY_PLAYERS.min, SPY_PLAYERS.max), rememberedDecks('spy')),
		(s) => s.phase.kind !== 'setup',
		{
			// a card that was open when the page went away stays closed: whoever holds the phone now may not be its owner
			restore: (s) =>
				s.phase.kind === 'deal' || s.phase.kind === 'peek' || s.phase.kind === 'declare' ? { ...s, phase: { ...s.phase, showing: false } } : s,
		},
	);
	const pool = useMemo(() => cardPool(spyDecks, 'spy', state.settings.deckIds), [spyDecks, state.settings.deckIds]);
	const { phase, round, settings } = state;

	const newRoundFrom = (next: (avoid: Set<number>) => SpyState) => {
		const fresh = next(new Set(readSeen('spy')));
		if (fresh.round) rememberSeen('spy', [fresh.round.placeId], pool.length);
		setState(fresh);
	};

	const live = phase.kind !== 'setup';
	const dark = phase.kind === 'deal' || phase.kind === 'play' || phase.kind === 'peek' || phase.kind === 'declare';

	return (
		<GameFrame title="جاسوس" theme={dark ? 'dark' : 'light'} live={live} onExit={onExit} rules={SPY_RULES}>
			{phase.kind === 'setup' && (
				<SpySetup
					state={state}
					decks={spyDecks}
					poolSize={pool.length}
					onChange={setState}
					onStart={(settings) => {
						rememberNames('players', state.settings.players);
						rememberDecks('spy', settings.deckIds);
						const chosenPool = cardPool(spyDecks, 'spy', settings.deckIds);
						const fresh = startSpyGame(settings, chosenPool, new Set(readSeen('spy')));
						if (fresh.round) rememberSeen('spy', [fresh.round.placeId], chosenPool.length);
						setState(fresh);
					}}
				/>
			)}
			{phase.kind === 'deal' && round && (
				<Deal
					key={`${state.roundNo}-${phase.index}`}
					round={round}
					players={settings.players}
					index={phase.index}
					showing={phase.showing}
					onShow={() => setState({ ...state, phase: { ...phase, showing: true } })}
					onNext={() =>
						setState(
							phase.index + 1 < settings.players.length ? { ...state, phase: { kind: 'deal', index: phase.index + 1, showing: false } } : startQuestions(state),
						)
					}
				/>
			)}
			{(phase.kind === 'play' || phase.kind === 'peek' || phase.kind === 'declare') && round && state.clock && (
				<Play state={state} round={round} onState={setState} />
			)}
			{phase.kind === 'vote' && round && (
				<Vote
					players={settings.players}
					canGoBack={Boolean(state.clock && clockLeft(state.clock) > 0)}
					onBack={() => setState({ ...state, clock: state.clock && resumeClock(state.clock), phase: { kind: 'play' } })}
					onAccuse={(player) => {
						const next = accuse(state, player);
						playSound(next.phase.kind === 'guess' ? 'reveal' : 'buzz');
						setState(next);
					}}
				/>
			)}
			{phase.kind === 'guess' && round && (
				<Guess
					round={round}
					accusedName={phase.accused === null ? null : settings.players[phase.accused]}
					onGuess={(place) => {
						const next = guessPlace(state, place);
						if (next.phase.kind === 'result') playSound(next.phase.outcome.winner === 'spies' ? 'buzz' : 'win');
						setState(next);
					}}
				/>
			)}
			{phase.kind === 'result' && round && (
				<Result
					state={state}
					round={round}
					outcome={phase.outcome}
					canContinue={pool.length >= MIN_PLACES}
					onNext={() => newRoundFrom((avoid) => nextSpyRound(state, pool, avoid))}
					onSetup={() => setState({ ...initialSpyState(settings.players, settings.deckIds), settings: { ...settings } })}
				/>
			)}
		</GameFrame>
	);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function SpySetup({
	state,
	decks,
	poolSize,
	onChange,
	onStart,
}: {
	state: SpyState;
	decks: Deck[];
	poolSize: number;
	onChange: (state: SpyState) => void;
	onStart: (settings: SpyState['settings']) => void;
}) {
	const { settings } = state;
	const set = (patch: Partial<SpyState['settings']>) => onChange({ ...state, settings: { ...settings, ...patch } });
	const canTwo = settings.players.length >= TWO_SPIES_FROM;
	const enough = poolSize >= MIN_PLACES;

	return (
		<div className="gm-setup">
			<div className="gm-intro">
				<span className="gm-intro-icon" aria-hidden="true">
					{GAME_ICONS.spy}
				</span>
				<p>همه یه مکان رو می‌دونن، جز جاسوس. با سؤال و جواب جاسوس رو پیدا کنید، قبل از اینکه بفهمه کجایید.</p>
			</div>
			<Field label="بازیکن‌ها" hint={`${fa(SPY_PLAYERS.min)} تا ${fa(SPY_PLAYERS.max)} نفر`}>
				<NamesEditor
					names={settings.players}
					min={SPY_PLAYERS.min}
					max={SPY_PLAYERS.max}
					placeholder={playerPlaceholder}
					addLabel="بازیکن تازه"
					onChange={(players) =>
						set({
							players,
							minutes: settings.minutes === defaultMinutes(settings.players.length) ? defaultMinutes(players.length) : settings.minutes,
							spies: players.length >= TWO_SPIES_FROM ? settings.spies : 1,
						})
					}
				/>
			</Field>
			{canTwo && (
				<Field label="تعداد جاسوس" hint="دو جاسوس همدیگه رو نمی‌شناسن.">
					<Choices
						label="تعداد جاسوس"
						value={settings.spies}
						onChange={(spies) => set({ spies })}
						options={[
							{ value: 1, label: 'یک جاسوس' },
							{ value: 2, label: 'دو جاسوس' },
						]}
					/>
				</Field>
			)}
			<Field label="زمان سؤال‌ها">
				<Stepper label="زمان سؤال‌ها" value={settings.minutes} min={SPY_MINUTES.min} max={SPY_MINUTES.max} unit="دقیقه" onChange={(minutes) => set({ minutes })} />
			</Field>
			{decks.length > 1 && (
				<Field label="مکان‌ها از کجا بیاد؟">
					<DeckPicker decks={decks} value={settings.deckIds} onChange={(deckIds) => set({ deckIds })} countOf={(deck) => deck.cards.length} />
				</Field>
			)}
			{!enough && <p className="gm-warn">برای این بازی حداقل {fa(MIN_PLACES)} مکان لازمه؛ دسته‌های بیشتری انتخاب کن.</p>}
			<div className="gm-sticky">
				<button
					type="button"
					className="gm-btn gm-btn-primary gm-btn-big"
					disabled={!enough}
					onClick={() => {
						unlockAudio();
						const players = finalNames(settings.players, playerPlaceholder);
						onStart({ ...settings, players, spies: players.length >= TWO_SPIES_FROM ? settings.spies : 1 });
					}}
				>
					شروع بازی
				</button>
			</div>
		</div>
	);
}

// ─── Dealing the cards ────────────────────────────────────────────────────────

function RoleCard({ round, player, spies }: { round: SpyRound; player: number; spies: number }) {
	if (isSpy(round, player)) {
		return (
			<div className="spy-card spy-card-spy">
				<span className="spy-card-icon" aria-hidden="true">
					{GAME_ICONS.spy}
				</span>
				<p className="spy-card-big">تو جاسوسی!</p>
				<p className="spy-card-note">
					مکان رو نمی‌دونی. از سؤال‌ها بفهم کجایید و لو نرو.
					{spies > 1 && ' یه جاسوس دیگه هم هست، ولی نمی‌دونی کیه.'}
				</p>
			</div>
		);
	}
	return (
		<div className="spy-card">
			<p className="spy-card-label">مکان</p>
			<p className="spy-card-big">{round.place}</p>
			<p className="spy-card-note">{spies > 1 ? 'دو جاسوس بین شماست.' : 'جاسوس بین شماست.'} طوری جواب بده که لو نره کجایید.</p>
		</div>
	);
}

function Deal({
	round,
	players,
	index,
	showing,
	onShow,
	onNext,
}: {
	round: SpyRound;
	players: string[];
	index: number;
	showing: boolean;
	onShow: () => void;
	onNext: () => void;
}) {
	const last = index === players.length - 1;
	return (
		<div className="gm-center">
			<div className="gm-dots" aria-label={`نفر ${fa(index + 1)} از ${fa(players.length)}`}>
				{players.map((_, i) => (
					<span key={i} className={i < index ? 'done' : i === index ? 'now' : ''} />
				))}
			</div>
			{showing ? (
				<div className="gm-reveal">
					<RoleCard round={round} player={index} spies={round.spies.length} />
					<button type="button" className="gm-btn gm-btn-light gm-btn-big" onClick={onNext}>
						{last ? 'فهمیدم، بریم سراغ سؤال‌ها' : 'فهمیدم، کارت رو ببند'}
					</button>
				</div>
			) : (
				<Handoff
					name={players[index]}
					color={sideColor(index)}
					note={index === 0 ? 'اول گوشی دست' : 'گوشی رو بده به'}
					action="کارتم رو نشون بده"
					onReady={() => {
						playSound('reveal');
						onShow();
					}}
				/>
			)}
		</div>
	);
}

// ─── Questions ────────────────────────────────────────────────────────────────

function Play({ state, round, onState }: { state: SpyState; round: SpyRound; onState: (state: SpyState) => void }) {
	const clock = state.clock!;
	const paused = isPaused(clock);
	const now = useNow(!paused, 250);
	const left = clockLeft(clock, now);
	const total = state.settings.minutes * 60_000;
	const [sheet, setSheet] = useState<'places' | 'peek' | 'declare' | null>(null);
	const ended = useRef(false);
	const lastTick = useRef<number | null>(null);
	// a call or another app: the clock waits for the players («ادامه» starts it again)
	usePauseWhenHidden(!paused, () => onState({ ...state, clock: pauseClock(clock) }));

	// last ten seconds: a tick each second; zero: the vote
	useEffect(() => {
		if (paused) return;
		const seconds = Math.ceil(left / 1000);
		if (left > 0 && seconds <= 10 && lastTick.current !== seconds) {
			lastTick.current = seconds;
			playSound('tick');
		}
		if (left <= 0 && !ended.current && state.phase.kind === 'play') {
			ended.current = true;
			playSound('buzz');
			vibrate([200, 80, 200]);
			onState({ ...state, phase: { kind: 'vote' } });
		}
	}, [left, paused, state, onState]);

	const declare = state.phase.kind === 'declare' ? state.phase : null;
	if (declare) {
		const back = () => onState({ ...state, clock: resumeClock(clock), phase: { kind: 'play' } });
		if (declare.index === null) {
			return (
				<div className="gm-center">
					<p className="gm-title-light">کی می‌خواد مکان رو حدس بزنه؟</p>
					<p className="gm-muted-light">گوشی اول کارتش رو بهش نشون می‌ده؛ فقط جاسوس می‌تونه حدس بزنه.</p>
					<div className="gm-player-grid">
						{state.settings.players.map((name, i) => (
							<button key={i} type="button" className="gm-player-btn" onClick={() => onState({ ...state, phase: { kind: 'declare', index: i, showing: false } })}>
								<span className="gm-avatar" style={{ background: sideColor(i) }} aria-hidden="true">
									{name.charAt(0)}
								</span>
								{name}
							</button>
						))}
					</div>
					<button type="button" className="gm-btn gm-btn-ghost-light" onClick={back}>
						برگرد به بازی
					</button>
				</div>
			);
		}
		const spy = isSpy(round, declare.index);
		return (
			<div className="gm-center">
				{declare.showing ? (
					<div className="gm-reveal">
						<RoleCard round={round} player={declare.index} spies={round.spies.length} />
						{spy ? (
							<button type="button" className="gm-btn gm-btn-light gm-btn-big" onClick={() => onState(declareGuess(state, declare.index!))}>
								حدس می‌زنم
							</button>
						) : (
							<>
								<p className="gm-muted-light">تو جاسوس نیستی؛ فقط جاسوس می‌تونه مکان رو حدس بزنه.</p>
								<button type="button" className="gm-btn gm-btn-light gm-btn-big" onClick={back}>
									برگرد به بازی
								</button>
							</>
						)}
					</div>
				) : (
					<Handoff
						name={state.settings.players[declare.index]}
						color={sideColor(declare.index)}
						note="گوشی رو بده به"
						action="کارتم رو نشون بده"
						onReady={() => onState({ ...state, phase: { kind: 'declare', index: declare.index, showing: true } })}
					/>
				)}
			</div>
		);
	}

	const peek = state.phase.kind === 'peek' ? state.phase : null;
	if (peek) {
		const back = () => onState({ ...state, phase: { kind: 'play' } });
		if (peek.index === null) {
			return (
				<div className="gm-center">
					<p className="gm-title-light">کارت کی رو دوباره نشون بدم؟</p>
					<div className="gm-player-grid">
						{state.settings.players.map((name, i) => (
							<button key={i} type="button" className="gm-player-btn" onClick={() => onState({ ...state, phase: { kind: 'peek', index: i, showing: false } })}>
								<span className="gm-avatar" style={{ background: sideColor(i) }} aria-hidden="true">
									{name.charAt(0)}
								</span>
								{name}
							</button>
						))}
					</div>
					<button type="button" className="gm-btn gm-btn-ghost-light" onClick={back}>
						برگرد
					</button>
				</div>
			);
		}
		return (
			<div className="gm-center">
				{peek.showing ? (
					<div className="gm-reveal">
						<RoleCard round={round} player={peek.index} spies={round.spies.length} />
						<button type="button" className="gm-btn gm-btn-light gm-btn-big" onClick={back}>
							دیدم، کارت رو ببند
						</button>
					</div>
				) : (
					<Handoff
						name={state.settings.players[peek.index]}
						color={sideColor(peek.index)}
						note="گوشی رو بده به"
						action="کارتم رو نشون بده"
						onReady={() => onState({ ...state, phase: { kind: 'peek', index: peek.index, showing: true } })}
					/>
				)}
			</div>
		);
	}

	return (
		<div className="spy-play">
			<p className="gm-eyebrow">دست {fa(state.roundNo)}</p>
			<ClockFace left={left} total={total} paused={paused} />
			<p className="spy-starter">
				اولین سؤال رو <strong>{state.settings.players[round.starter]}</strong> می‌پرسه.
			</p>
			<div className="spy-actions">
				<button
					type="button"
					className="gm-btn gm-btn-light gm-btn-big"
					onClick={() => {
						playSound('tap');
						onState({ ...state, clock: pauseClock(clock), phase: { kind: 'vote' } });
					}}
				>
					رأی‌گیری: جاسوس کیه؟
				</button>
				<button type="button" className="gm-btn gm-btn-outline-light" onClick={() => setSheet('declare')}>
					جاسوس می‌خواد مکان رو حدس بزنه
				</button>
			</div>
			<div className="gm-tools">
				<button type="button" className="gm-tool" onClick={() => setSheet('places')}>
					{UI_ICONS.list}
					<span>لیست مکان‌ها</span>
				</button>
				<button type="button" className="gm-tool" onClick={() => onState({ ...state, phase: { kind: 'peek', index: null, showing: false } })}>
					{UI_ICONS.eye}
					<span>کارتم یادم رفت</span>
				</button>
				<button type="button" className="gm-tool" onClick={() => onState({ ...state, clock: paused ? resumeClock(clock) : pauseClock(clock) })}>
					{paused ? UI_ICONS.play : UI_ICONS.pause}
					<span>{paused ? 'ادامه' : 'مکث'}</span>
				</button>
			</div>
			{sheet === 'places' && (
				<Sheet title="مکان‌های این دست" onClose={() => setSheet(null)}>
					<p className="gm-muted">مکان واقعی یکی از این‌هاست.</p>
					<ul className="spy-place-list">
						{round.candidates.map((place) => (
							<li key={place}>{place}</li>
						))}
					</ul>
				</Sheet>
			)}
			{sheet === 'declare' && (
				<Sheet
					title="فقط جاسوس!"
					onClose={() => setSheet(null)}
					actions={
						<>
							<button
								type="button"
								className="gm-btn gm-btn-primary"
								onClick={() => {
									setSheet(null);
									onState({ ...state, clock: pauseClock(clock), phase: { kind: 'declare', index: null, showing: false } });
								}}
							>
								من جاسوسم، حدس می‌زنم
							</button>
							<button type="button" className="gm-btn gm-btn-ghost" onClick={() => setSheet(null)}>
								برگرد
							</button>
						</>
					}
				>
					<p className="gm-muted">جاسوس هر وقت بخواد می‌تونه بازی رو نگه داره و مکان رو حدس بزنه. درست بگه جاسوس می‌بره، اشتباه بگه شهروندها.</p>
				</Sheet>
			)}
		</div>
	);
}

// ─── Vote, guess, result ──────────────────────────────────────────────────────

function Vote({ players, canGoBack, onBack, onAccuse }: { players: string[]; canGoBack: boolean; onBack: () => void; onAccuse: (player: number) => void }) {
	const [chosen, setChosen] = useState<number | null>(null);
	return (
		<div className="gm-panel">
			<h2 className="gm-title">جاسوس کیه؟</h2>
			<p className="gm-muted">با هم حرف بزنید و روی یه نفر به توافق برسید.</p>
			<div className="gm-player-grid">
				{players.map((name, i) => (
					<button key={i} type="button" aria-pressed={chosen === i} className={`gm-player-btn${chosen === i ? ' on' : ''}`} onClick={() => setChosen(i)}>
						<span className="gm-avatar" style={{ background: sideColor(i) }} aria-hidden="true">
							{name.charAt(0)}
						</span>
						{name}
					</button>
				))}
			</div>
			<div className="gm-sticky">
				<button type="button" className="gm-btn gm-btn-primary gm-btn-big" disabled={chosen === null} onClick={() => chosen !== null && onAccuse(chosen)}>
					{chosen === null ? 'یه نفر رو انتخاب کنید' : `${players[chosen]} جاسوسه!`}
				</button>
				{canGoBack && (
					<button type="button" className="gm-btn gm-btn-ghost" onClick={onBack}>
						هنوز مطمئن نیستیم، برگرد
					</button>
				)}
			</div>
		</div>
	);
}

function Guess({ round, accusedName, onGuess }: { round: SpyRound; accusedName: string | null; onGuess: (place: string) => void }) {
	const [chosen, setChosen] = useState<string | null>(null);
	return (
		<div className="gm-panel">
			{accusedName ? (
				<>
					<h2 className="gm-title">{accusedName} جاسوس بود!</h2>
					<p className="gm-muted">یه شانس آخر: اگه مکان رو درست بگی، جاسوس‌ها می‌برن.</p>
				</>
			) : (
				<>
					<h2 className="gm-title">جاسوس، کجاییم؟</h2>
					<p className="gm-muted">درست بگی می‌بری، اشتباه بگی می‌بازی.</p>
				</>
			)}
			<div className="spy-guess-grid">
				{round.candidates.map((place) => (
					<button key={place} type="button" aria-pressed={chosen === place} className={`gm-chip${chosen === place ? ' on' : ''}`} onClick={() => setChosen(place)}>
						{place}
					</button>
				))}
			</div>
			<div className="gm-sticky">
				<button type="button" className="gm-btn gm-btn-primary gm-btn-big" disabled={!chosen} onClick={() => chosen && onGuess(chosen)}>
					{chosen ? `جواب من: ${chosen}` : 'یه مکان انتخاب کن'}
				</button>
			</div>
		</div>
	);
}

function Result({
	state,
	round,
	outcome,
	canContinue,
	onNext,
	onSetup,
}: {
	state: SpyState;
	round: SpyRound;
	outcome: SpyOutcome;
	canContinue: boolean;
	onNext: () => void;
	onSetup: () => void;
}) {
	const { title, line } = outcomeText(outcome, round, state.settings.players);
	return (
		<div className="gm-panel">
			<div className={`gm-banner ${outcome.winner === 'spies' ? 'gm-banner-dark' : 'gm-banner-win'}`}>
				<span className="gm-banner-icon" aria-hidden="true">
					{outcome.winner === 'spies' ? GAME_ICONS.spy : UI_ICONS.trophy}
				</span>
				<h2>{title}</h2>
				<p>{line}</p>
			</div>
			<p className="spy-reveal-place">
				مکان: <strong>{round.place}</strong>
			</p>
			<h3 className="gm-subtitle">امتیازها بعد از دست {fa(state.roundNo)}</h3>
			<Scoreboard names={state.settings.players} scores={state.scores} />
			{!canContinue && <p className="gm-warn">مکان‌های این دسته‌ها دیگه کافی نیست (احتمالاً کافه تغییرشون داده)؛ از «تنظیمات» دسته‌های دیگه‌ای انتخاب کن.</p>}
			<div className="gm-sticky">
				<button type="button" className="gm-btn gm-btn-primary gm-btn-big" disabled={!canContinue} onClick={onNext}>
					دست بعد
				</button>
				<button type="button" className="gm-btn gm-btn-ghost" onClick={onSetup}>
					تغییر بازیکن‌ها یا تنظیمات
				</button>
			</div>
		</div>
	);
}
