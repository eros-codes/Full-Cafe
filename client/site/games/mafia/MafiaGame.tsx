import { useEffect, useMemo, useState } from 'react';
import { isInt, isRecord } from '../board/kit';
import { clockLeft, isPaused, pauseClock, resumeClock, startClock, type Clock } from '../kit/clock';
import { GAME_ICONS, UI_ICONS } from '../kit/icons';
import { rememberNames, rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { playSound, unlockAudio, vibrate } from '../kit/sound';
import { ClockFace, Field, GameFrame, Handoff, NamesEditor, Choices, Stepper, fa, finalNames, joinNames, sideColor } from '../kit/ui';
import { useNow } from '../kit/useNow';
import {
	MAFIA_PLAYERS,
	ROLE_FA,
	alive,
	canAct,
	chooseAtNight,
	defaultMafiaCount,
	fitSettings,
	initialMafiaState,
	isMafiaRole,
	looksMafia,
	maxMafia,
	nightSteps,
	playAgain,
	rolesFor,
	startDay,
	startMafia,
	teammates,
	voteOut,
	type MafiaEvent,
	type MafiaPlayer,
	type MafiaSettings,
	type MafiaState,
	type NightStep,
	type Role,
} from './engine';

// «مافیا»: the phone deals the roles (passed around, each card seen by its owner only), then goes to the
// narrator, who leads the nights and the days with it. The narrator is not a player.

const VERSION = 1;
const playerPlaceholder = (index: number) => `بازیکن ${fa(index + 1)}`;
const ROLES: readonly Role[] = ['godfather', 'mafia', 'doctor', 'detective', 'sniper', 'citizen'];

const RULES = (
	<>
		<p>یه نفر گرداننده‌ست و بازی نمی‌کنه. بقیه نقش می‌گیرن: یا مافیا، یا شهروند.</p>
		<ul>
			<li>گوشی دست‌به‌دست می‌چرخه و هر کی نقشش رو می‌بینه. مافیاها هم‌تیمی‌هاشون رو هم می‌بینن. بعد گوشی می‌ره دست گرداننده.</li>
			<li>روز: همه حرف می‌زنن و با رأی‌گیری یه نفر رو بیرون می‌کنن (یا هیچ‌کس رو).</li>
			<li>شب: همه چشم‌ها رو می‌بندن؛ گرداننده نقش‌ها رو یکی‌یکی بیدار می‌کنه و انتخابشون رو توی گوشی می‌زنه.</li>
			<li>مافیا هر شب یه نفر رو هدف می‌گیره. دکتر یه نفر رو نجات می‌ده (خودش رو فقط یک بار). کارآگاه از یه نفر استعلام می‌گیره؛ پدرخوانده به کارآگاه شهروند نشون داده می‌شه.</li>
			<li>تک‌تیرانداز فقط یک تیر داره: اگه به مافیا بزنه، مافیا می‌میره؛ اگه به شهروند بزنه، خودش می‌میره.</li>
			<li>شهروندها وقتی می‌برن که مافیایی نمونه. مافیا وقتی می‌بره که تعدادشون با شهروندها برابر بشه.</li>
		</ul>
	</>
);

const ROLE_TEXT: Record<Role, string> = {
	godfather: 'رئیس مافیا. شب‌ها با تیمت یه نفر رو هدف می‌گیری؛ اگه کارآگاه ازت استعلام بگیره، شهروند نشون داده می‌شی.',
	mafia: 'شب‌ها با تیمت یه نفر رو هدف می‌گیری. روزها طوری حرف بزن که شک نکنن.',
	doctor: 'هر شب یه نفر رو نجات می‌دی. خودت رو فقط یک بار می‌تونی نجات بدی.',
	detective: 'هر شب از یه نفر استعلام می‌گیری: مافیاست یا نه. پدرخوانده رو شهروند می‌بینی.',
	sniper: 'یک تیر داری. اگه به مافیا بزنی، مافیا می‌میره؛ اگه به شهروند بزنی، خودت می‌میری.',
	citizen: 'نقش خاصی نداری؛ با دقت و حرف زدن مافیا رو پیدا کن.',
};

const STEP_TEXT: Record<NightStep, { call: string; note: string; question: string }> = {
	mafia: { call: 'مافیا بیدار شن', note: 'به هم اشاره کنن و یه نفر رو نشون بدن.', question: 'مافیا کی رو هدف گرفت؟' },
	doctor: { call: 'دکتر بیدار شه', note: 'یه نفر رو برای نجات نشون بده.', question: 'دکتر کی رو نجات داد؟' },
	detective: { call: 'کارآگاه بیدار شه', note: 'یه نفر رو برای استعلام نشون بده.', question: 'کارآگاه از کی استعلام گرفت؟' },
	sniper: { call: 'تک‌تیرانداز بیدار شه', note: 'اگه می‌خواد شلیک کنه، یه نفر رو نشون بده.', question: 'تک‌تیرانداز به کی شلیک کرد؟' },
};

const ROLE_OF_STEP: Record<NightStep, string> = { mafia: 'مافیا', doctor: 'دکتر', detective: 'کارآگاه', sniper: 'تک‌تیرانداز' };

// ─── saved state check ───────────────────────────────────────────────────────

const isRole = (value: unknown): value is Role => typeof value === 'string' && (ROLES as readonly string[]).includes(value);

function isMafiaState(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.settings) || !isRecord(value.phase)) return false;
	const s = value.settings;
	if (!Array.isArray(s.players) || !s.players.every((n) => typeof n === 'string') || !isInt(s.mafia)) return false;
	if (!['godfather', 'doctor', 'detective', 'sniper', 'revealRoles'].every((k) => typeof s[k] === 'boolean')) return false;
	if (!Array.isArray(value.players) || !value.players.every((p) => isRecord(p) && typeof p.name === 'string' && isRole(p.role) && typeof p.alive === 'boolean')) return false;
	if (!isInt(value.day) || typeof value.doctorSelfSaved !== 'boolean' || typeof value.sniperBullet !== 'boolean' || !Array.isArray(value.log)) return false;
	const kind = value.phase.kind;
	if (kind === 'setup') return true;
	if (value.players.length < MAFIA_PLAYERS.min) return false;
	if (kind === 'deal') return isInt(value.phase.index) && (value.phase.index as number) < value.players.length;
	if (kind === 'night') return isRecord(value.phase.night) && typeof value.phase.night.step === 'string';
	if (kind === 'over') return value.phase.winner === 'mafia' || value.phase.winner === 'town';
	return kind === 'handover' || kind === 'day' || kind === 'vote';
}

export default function MafiaGame({ onExit }: { onExit: () => void }) {
	const [state, setState] = useSavedGame<MafiaState>(
		'mafia',
		VERSION,
		() => initialMafiaState(rememberedNames('players', MAFIA_PLAYERS.min, MAFIA_PLAYERS.max)),
		(s) => s.phase.kind !== 'setup',
		{
			isValid: isMafiaState,
			// a role card that was open when the page went away stays closed
			restore: (s) => (s.phase.kind === 'deal' ? { ...s, phase: { ...s.phase, showing: false } } : s),
		},
	);
	const { phase } = state;
	const dark = phase.kind === 'deal' || phase.kind === 'handover' || phase.kind === 'night';

	return (
		<GameFrame title="مافیا" theme={dark ? 'dark' : 'light'} live={phase.kind !== 'setup'} onExit={onExit} rules={RULES}>
			{phase.kind === 'setup' && (
				<MafiaSetup
					settings={state.settings}
					onChange={(settings) => setState({ ...state, settings })}
					onStart={(settings) => {
						rememberNames('players', state.settings.players);
						setState(startMafia(settings));
					}}
				/>
			)}
			{phase.kind === 'deal' && (
				<Deal
					key={phase.index}
					players={state.players}
					index={phase.index}
					showing={phase.showing}
					onShow={() => setState({ ...state, phase: { ...phase, showing: true } })}
					onNext={() =>
						setState({
							...state,
							phase: phase.index + 1 < state.players.length ? { kind: 'deal', index: phase.index + 1, showing: false } : { kind: 'handover' },
						})
					}
				/>
			)}
			{phase.kind === 'handover' && (
				<div className="gm-center">
					<span className="mf-mask" aria-hidden="true">
						{GAME_ICONS.mafia}
					</span>
					<p className="gm-title-light">همه نقششون رو دیدن</p>
					<p className="gm-muted-light">حالا گوشی رو بدید به گرداننده. از اینجا به بعد فقط گرداننده صفحه رو می‌بینه.</p>
					<button
						type="button"
						className="gm-btn gm-btn-light gm-btn-big"
						onClick={() => {
							unlockAudio();
							playSound('reveal');
							setState(startDay(state));
						}}
					>
						من گرداننده‌ام
					</button>
				</div>
			)}
			{phase.kind === 'day' && <Day state={state} onVote={() => setState({ ...state, phase: { kind: 'vote' } })} />}
			{phase.kind === 'vote' && (
				<Vote
					state={state}
					onBack={() => setState({ ...state, phase: { kind: 'day' } })}
					onOut={(out) => {
						const next = voteOut(state, out);
						playSound(next.phase.kind === 'over' ? 'win' : 'tap');
						setState(next);
					}}
				/>
			)}
			{phase.kind === 'night' && <NightStepView state={state} onState={setState} />}
			{phase.kind === 'over' && (
				<Over
					state={state}
					winner={phase.winner}
					onAgain={() => setState(playAgain(state))}
					onSetup={() => setState({ ...initialMafiaState(state.settings.players), settings: state.settings })}
				/>
			)}
		</GameFrame>
	);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function MafiaSetup({ settings, onChange, onStart }: { settings: MafiaSettings; onChange: (s: MafiaSettings) => void; onStart: (s: MafiaSettings) => void }) {
	const fitted = fitSettings(settings);
	const roles = rolesFor(fitted);
	const count = (role: Role) => roles.filter((r) => r === role).length;
	const n = settings.players.length;
	const toggle = (key: 'godfather' | 'doctor' | 'detective' | 'sniper') => onChange(fitSettings({ ...fitted, [key]: !fitted[key] }));
	const summary = ROLES.filter((r) => count(r) > 0)
		.map((r) => (count(r) > 1 ? `${fa(count(r))} ${ROLE_FA[r]}` : ROLE_FA[r]))
		.join('، ');

	return (
		<div className="gm-setup">
			<div className="gm-intro">
				<span className="gm-intro-icon" aria-hidden="true">
					{GAME_ICONS.mafia}
				</span>
				<p>شب‌ها مافیا شکار می‌کنه، روزها شهر رأی می‌ده. یه نفر گرداننده‌ست و گوشی بعد از پخش نقش‌ها دست اونه.</p>
			</div>
			<Field label="بازیکن‌ها" hint={`${fa(MAFIA_PLAYERS.min)} تا ${fa(MAFIA_PLAYERS.max)} نفر، بدون گرداننده.`}>
				<NamesEditor
					names={settings.players}
					min={MAFIA_PLAYERS.min}
					max={MAFIA_PLAYERS.max}
					placeholder={playerPlaceholder}
					addLabel="بازیکن تازه"
					onChange={(players) => {
						// the mafia count follows the table (a third) until it is set by hand
						const followed = settings.mafia === defaultMafiaCount(settings.players.length);
						onChange(fitSettings({ ...settings, players, mafia: followed ? defaultMafiaCount(players.length) : settings.mafia }));
					}}
				/>
			</Field>
			<Field label="تعداد مافیا" hint="پدرخوانده هم جزو همین تعداده.">
				<Stepper label="تعداد مافیا" value={fitted.mafia} min={1} max={maxMafia(n)} onChange={(mafia) => onChange(fitSettings({ ...fitted, mafia }))} />
			</Field>
			<Field label="نقش‌های ویژه" hint="بقیه شهروند ساده‌ان.">
				<div className="gm-choices">
					{(['godfather', 'doctor', 'detective', 'sniper'] as const).map((key) => (
						<button key={key} type="button" aria-pressed={fitted[key]} className={`gm-chip${fitted[key] ? ' on' : ''}`} onClick={() => toggle(key)}>
							{ROLE_FA[key]}
						</button>
					))}
				</div>
			</Field>
			<Field label="وقتی کسی بیرون می‌ره">
				<Choices
					label="وقتی کسی بیرون می‌ره"
					value={fitted.revealRoles}
					onChange={(revealRoles) => onChange({ ...fitted, revealRoles })}
					options={[
						{ value: false, label: 'نقشش گفته نشه' },
						{ value: true, label: 'نقشش اعلام بشه' },
					]}
				/>
			</Field>
			<p className="mf-summary">{summary}</p>
			<div className="gm-sticky">
				<button
					type="button"
					className="gm-btn gm-btn-primary gm-btn-big"
					onClick={() => {
						unlockAudio();
						onStart(fitSettings({ ...fitted, players: finalNames(settings.players, playerPlaceholder) }));
					}}
				>
					پخش نقش‌ها
				</button>
			</div>
		</div>
	);
}

// ─── Dealing ─────────────────────────────────────────────────────────────────

function RoleCard({ players, index }: { players: MafiaPlayer[]; index: number }) {
	const { role } = players[index];
	const mafia = isMafiaRole(role);
	const mates = teammates(players, index).map((i) => `${players[i].name}${players[i].role === 'godfather' ? ' (پدرخوانده)' : ''}`);
	return (
		<div className={`mf-card${mafia ? ' mf-card-mafia' : ''}`}>
			<p className="mf-card-team">{mafia ? 'تیم مافیا' : 'تیم شهروندها'}</p>
			<p className="mf-card-role">{ROLE_FA[role]}</p>
			<p className="mf-card-text">{ROLE_TEXT[role]}</p>
			{mafia && <p className="mf-card-mates">{mates.length ? `هم‌تیمی‌هات: ${joinNames(mates)}` : 'تنها مافیای بازی تویی.'}</p>}
		</div>
	);
}

function Deal({ players, index, showing, onShow, onNext }: { players: MafiaPlayer[]; index: number; showing: boolean; onShow: () => void; onNext: () => void }) {
	return (
		<div className="gm-center">
			<div className="gm-dots" aria-label={`نفر ${fa(index + 1)} از ${fa(players.length)}`}>
				{players.map((_, i) => (
					<span key={i} className={i < index ? 'done' : i === index ? 'now' : ''} />
				))}
			</div>
			{showing ? (
				<div className="gm-reveal">
					<RoleCard players={players} index={index} />
					<button type="button" className="gm-btn gm-btn-light gm-btn-big" onClick={onNext}>
						{index === players.length - 1 ? 'فهمیدم، گوشی رو بدید به گرداننده' : 'فهمیدم، کارت رو ببند'}
					</button>
				</div>
			) : (
				<Handoff
					name={players[index].name}
					color={sideColor(index)}
					note={index === 0 ? 'اول گوشی دست' : 'گوشی رو بده به'}
					action="نقشم رو نشون بده"
					onReady={() => {
						playSound('reveal');
						onShow();
					}}
				/>
			)}
		</div>
	);
}

// ─── The narrator's day ───────────────────────────────────────────────────────

function eventText(event: MafiaEvent, players: MafiaPlayer[], reveal: boolean): string {
	const who = (i: number) => (reveal ? `${players[i].name} (${ROLE_FA[players[i].role]})` : players[i].name);
	if (event.kind === 'vote') return event.out === null ? `روز ${fa(event.day)}: کسی بیرون نرفت.` : `روز ${fa(event.day)}: ${who(event.out)} با رأی بیرون رفت.`;
	return event.died.length ? `شب ${fa(event.day)}: ${joinNames(event.died.map(who))} کشته ${event.died.length > 1 ? 'شدن' : 'شد'}.` : `شب ${fa(event.day)}: کسی کشته نشد.`;
}

/** The roles, for the narrator's eyes only (closed by default, in case someone looks over the shoulder). */
function RolesPanel({ players }: { players: MafiaPlayer[] }) {
	const [open, setOpen] = useState(false);
	return (
		<div className="mf-roles">
			<button type="button" className="mf-roles-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
				{UI_ICONS.eye}
				<span>{open ? 'بستن نقش‌ها' : 'نقش‌ها (فقط گرداننده ببینه)'}</span>
			</button>
			{open && (
				<ul className="mf-roles-list">
					{players.map((p, i) => (
						<li key={i} className={`${p.alive ? '' : 'dead'}${isMafiaRole(p.role) ? ' mafia' : ''}`}>
							<span>{p.name}</span>
							<strong>{ROLE_FA[p.role]}</strong>
						</li>
					))}
				</ul>
			)}
		</div>
	);
}

function SpeechTimer() {
	const [seconds, setSeconds] = useState(60);
	const [clock, setClock] = useState<Clock | null>(null);
	const running = Boolean(clock && !isPaused(clock));
	const now = useNow(running, 250);
	const left = clock ? clockLeft(clock, now) : seconds * 1000;
	const timeUp = clock !== null && left <= 0;
	// time's up: a buzz, and the clock stays on ۰:۰۰ until the next speaker
	useEffect(() => {
		if (!clock || !running || left > 0) return;
		playSound('buzz');
		vibrate(200);
		setClock(pauseClock(clock));
	}, [left, clock, running]);
	const nextSpeaker = () => {
		unlockAudio();
		playSound('tap');
		setClock(startClock(seconds * 1000));
	};
	return (
		<div className="mf-timer">
			<ClockFace left={left} total={seconds * 1000} paused={!running} size="small" />
			<div className="mf-timer-side">
				<Choices
					label="زمان صحبت"
					value={seconds}
					onChange={(s) => {
						setSeconds(s);
						setClock(null);
					}}
					options={[
						{ value: 30, label: '۳۰ ثانیه' },
						{ value: 60, label: '۱ دقیقه' },
						{ value: 90, label: '۱:۳۰' },
					]}
				/>
				<div className="mf-timer-actions">
					{!clock || timeUp ? (
						<button type="button" className="gm-btn gm-btn-primary" onClick={nextSpeaker}>
							{clock ? 'نفر بعد' : 'شروع صحبت'}
						</button>
					) : (
						<>
							<button
								type="button"
								className="gm-btn gm-btn-primary"
								onClick={() => setClock(running ? pauseClock(clock) : resumeClock(clock))}
							>
								{running ? 'مکث' : 'ادامه'}
							</button>
							<button type="button" className="gm-btn gm-btn-ghost" onClick={nextSpeaker}>
								نفر بعد
							</button>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function Day({ state, onVote }: { state: MafiaState; onVote: () => void }) {
	const living = alive(state.players);
	const lastNight = [...state.log].reverse().find((e) => e.kind === 'night');
	return (
		<div className="gm-panel">
			<p className="gm-eyebrow">گرداننده</p>
			<h2 className="gm-title mf-day-title">روز {fa(state.day)}</h2>
			{state.day === 1 ? (
				<p className="mf-announce">بازی شروع شد. بذار بازیکن‌ها خودشون رو معرفی کنن و حرف بزنن.</p>
			) : (
				lastNight && <p className="mf-announce">{eventText(lastNight, state.players, state.settings.revealRoles)} اعلامش کن.</p>
			)}
			<Field label="زمان صحبت هر نفر">
				<SpeechTimer />
			</Field>
			<Field label={`زنده‌ها (${fa(living.length)})`}>
				<div className="mf-alive">
					{living.map((i) => (
						<span key={i} className="mf-alive-name">
							{state.players[i].name}
						</span>
					))}
				</div>
			</Field>
			<RolesPanel players={state.players} />
			{state.log.length > 0 && (
				<details className="mf-log">
					<summary>اتفاق‌های بازی</summary>
					<ul>
						{state.log.map((event, i) => (
							<li key={i}>{eventText(event, state.players, true)}</li>
						))}
					</ul>
				</details>
			)}
			<div className="gm-sticky">
				<button type="button" className="gm-btn gm-btn-primary gm-btn-big" onClick={onVote}>
					رأی‌گیری
				</button>
			</div>
		</div>
	);
}

function PlayerPicker({ players, options, chosen, onChoose, dark }: { players: MafiaPlayer[]; options: number[]; chosen: number | null; onChoose: (i: number) => void; dark?: boolean }) {
	return (
		<div className={`gm-player-grid${dark ? ' mf-dark-grid' : ''}`}>
			{options.map((i) => (
				<button key={i} type="button" aria-pressed={chosen === i} className={`gm-player-btn${chosen === i ? ' on' : ''}`} onClick={() => onChoose(i)}>
					<span className="gm-avatar" style={{ background: sideColor(i) }} aria-hidden="true">
						{players[i].name.trim().charAt(0)}
					</span>
					{players[i].name}
				</button>
			))}
		</div>
	);
}

function Vote({ state, onBack, onOut }: { state: MafiaState; onBack: () => void; onOut: (out: number | null) => void }) {
	const [chosen, setChosen] = useState<number | null>(null);
	return (
		<div className="gm-panel">
			<h2 className="gm-title">رأی‌گیری روز {fa(state.day)}</h2>
			<p className="gm-muted">بازیکن‌ها رأی بدن؛ کسی که بیرون می‌ره رو انتخاب کن.</p>
			<PlayerPicker players={state.players} options={alive(state.players)} chosen={chosen} onChoose={setChosen} />
			<div className="gm-sticky">
				<button type="button" className="gm-btn gm-btn-primary gm-btn-big" disabled={chosen === null} onClick={() => chosen !== null && onOut(chosen)}>
					{chosen === null ? 'یه نفر رو انتخاب کن' : `${state.players[chosen].name} بیرون می‌ره`}
				</button>
				<button type="button" className="gm-btn gm-btn-ghost" onClick={() => onOut(null)}>
					کسی بیرون نمی‌ره؛ برو به شب
				</button>
				<button type="button" className="gm-btn gm-btn-ghost" onClick={onBack}>
					برگرد
				</button>
			</div>
		</div>
	);
}

// ─── The night ────────────────────────────────────────────────────────────────

function nightOptions(state: MafiaState, step: NightStep): number[] {
	const living = alive(state.players);
	const self = (role: Role) => state.players.findIndex((p) => p.role === role);
	if (step === 'mafia') return living.filter((i) => !isMafiaRole(state.players[i].role));
	if (step === 'doctor') return living.filter((i) => !(i === self('doctor') && state.doctorSelfSaved));
	return living.filter((i) => i !== self(step));
}

function NightStepView({ state, onState }: { state: MafiaState; onState: (s: MafiaState) => void }) {
	if (state.phase.kind !== 'night') return null;
	const { night } = state.phase;
	return <NightStepInner key={`${state.day}-${night.step}`} state={state} step={night.step} onState={onState} />;
}

function NightStepInner({ state, step, onState }: { state: MafiaState; step: NightStep; onState: (s: MafiaState) => void }) {
	const [chosen, setChosen] = useState<number | null>(null);
	const [answer, setAnswer] = useState<boolean | null>(null);
	const steps = nightSteps(state);
	const text = STEP_TEXT[step];
	const active = canAct(state, step);
	const holders = useMemo(
		() =>
			state.players
				.filter((p) => (step === 'mafia' ? isMafiaRole(p.role) : p.role === step))
				.map((p) => `${p.name}${p.role === 'godfather' ? ' (پدرخوانده)' : ''}${p.alive ? '' : ' (بیرون)'}`),
		[state.players, step],
	);
	const finish = (choice: number | null) => {
		playSound('tap');
		onState(chooseAtNight(state, choice));
	};

	if (answer !== null && chosen !== null) {
		return (
			<div className="gm-center">
				<p className="gm-eyebrow">استعلام {state.players[chosen].name}</p>
				<p className={`mf-answer${answer ? ' yes' : ''}`}>{answer ? 'مافیاست' : 'مافیا نیست'}</p>
				<p className="gm-muted-light">{answer ? 'با شست بالا به کارآگاه نشون بده.' : 'با شست پایین به کارآگاه نشون بده.'}</p>
				<button type="button" className="gm-btn gm-btn-light gm-btn-big" onClick={() => finish(chosen)}>
					بعدی
				</button>
			</div>
		);
	}

	return (
		<div className="gm-panel mf-night">
			<div className="mf-night-head">
				<p className="gm-eyebrow">شب {fa(state.day)}</p>
				<div className="gm-dots" aria-label={`مرحله‌ی ${fa(steps.indexOf(step) + 1)} از ${fa(steps.length)}`}>
					{steps.map((s, i) => (
						<span key={s} className={i < steps.indexOf(step) ? 'done' : s === step ? 'now' : ''} />
					))}
				</div>
			</div>
			{step === 'mafia' && <p className="mf-script-small">همه چشم‌ها رو ببندن.</p>}
			<p className="mf-script">{text.call}</p>
			<p className="mf-holders">
				{ROLE_OF_STEP[step]}: {holders.join('، ')}
			</p>
			{active ? (
				<>
					<p className="gm-muted-light">{text.note}</p>
					<p className="mf-question">{text.question}</p>
					<PlayerPicker players={state.players} options={nightOptions(state, step)} chosen={chosen} onChoose={setChosen} dark />
					<div className="gm-sticky">
						<button
							type="button"
							className="gm-btn gm-btn-light gm-btn-big"
							disabled={chosen === null}
							onClick={() => {
								if (chosen === null) return;
								if (step === 'detective') {
									playSound('reveal');
									setAnswer(looksMafia(state.players[chosen]));
								} else finish(chosen);
							}}
						>
							{chosen === null ? 'یه نفر رو انتخاب کن' : step === 'detective' ? 'جواب استعلام' : `ثبت: ${state.players[chosen].name}`}
						</button>
						{step !== 'detective' && (
							<button type="button" className="gm-btn gm-btn-ghost-light" onClick={() => finish(null)}>
								{step === 'sniper' ? 'شلیک نکرد' : 'هیچ‌کس'}
							</button>
						)}
					</div>
				</>
			) : (
				<>
					<p className="mf-inactive">
						{step === 'sniper' && state.players.some((p) => p.role === 'sniper' && p.alive)
							? 'تک‌تیرانداز تیرش رو زده. '
							: `${ROLE_OF_STEP[step]} دیگه توی بازی نیست. `}
						باز هم صداش کن و چند ثانیه صبر کن، تا کسی نفهمه.
					</p>
					<div className="gm-sticky">
						<button type="button" className="gm-btn gm-btn-light gm-btn-big" onClick={() => finish(null)}>
							بعدی
						</button>
					</div>
				</>
			)}
			{steps.indexOf(step) === steps.length - 1 && <p className="gm-muted-light mf-next-hint">بعد از این مرحله صبح می‌شه و نتیجه‌ی شب رو می‌بینی.</p>}
		</div>
	);
}

// ─── End ──────────────────────────────────────────────────────────────────────

function Over({ state, winner, onAgain, onSetup }: { state: MafiaState; winner: 'mafia' | 'town'; onAgain: () => void; onSetup: () => void }) {
	const last = state.log.at(-1);
	return (
		<div className="gm-panel">
			<div className={`gm-banner ${winner === 'mafia' ? 'gm-banner-dark' : 'gm-banner-win'}`}>
				<span className="gm-banner-icon" aria-hidden="true">
					{winner === 'mafia' ? GAME_ICONS.mafia : UI_ICONS.trophy}
				</span>
				<h2>{winner === 'mafia' ? 'مافیا برد!' : 'شهروندها بردن!'}</h2>
				{last && <p>{eventText(last, state.players, true)}</p>}
			</div>
			<ul className="mf-roles-list mf-final">
				{state.players.map((p, i) => (
					<li key={i} className={`${p.alive ? '' : 'dead'}${isMafiaRole(p.role) ? ' mafia' : ''}`}>
						<span>{p.name}</span>
						<strong>{ROLE_FA[p.role]}</strong>
					</li>
				))}
			</ul>
			<div className="gm-sticky">
				<button type="button" className="gm-btn gm-btn-primary gm-btn-big" onClick={onAgain}>
					دوباره با همین‌ها (نقش‌های تازه)
				</button>
				<button type="button" className="gm-btn gm-btn-ghost" onClick={onSetup}>
					تغییر بازیکن‌ها یا نقش‌ها
				</button>
			</div>
		</div>
	);
}
