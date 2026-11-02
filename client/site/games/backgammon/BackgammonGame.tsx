import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { BoardSetup, PlayersBar, RoundResult, endSound, isBoardMatch, isInt, isIntArray, isRecord, type BoardSettings } from '../board/kit';
import { GAME_ICONS } from '../kit/icons';
import { rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { playSound, unlockAudio } from '../kit/sound';
import { Choices, Field, GameFrame, fa } from '../kit/ui';
import {
	CHECKERS,
	applyBgMove,
	boardKey,
	botPlay,
	countAt,
	diceLeft,
	diceOf,
	gamePoints,
	hasWon,
	newBgBoard,
	nextMoves,
	openingRoll,
	plays,
	rollDie,
	type BgBoard,
	type BgMove,
	type Player,
} from './engine';

// «تخته نرد»: two players on one phone, or one against the bot (the bot has the dark checkers). Roll, tap a
// checker, then where it goes; the moves of a turn can be taken back until «تموم». No doubling cube; a
// «مارس» is worth 2 points; a match goes to 1, 3, 5 or 7 points.

const VERSION = 1;

interface BgSettings extends BoardSettings {
	/** Points that win the match. */
	target: number;
}

interface BgMatch {
	settings: BgSettings;
	/** Points of the current match. */
	wins: number[];
	round: number;
	phase: 'setup' | 'play' | 'over';
	/** opening = the first throw (one die each) decides who starts. */
	stage: 'opening' | 'turn';
	turn: number;
	board: BgBoard;
	/** The board when this turn began (taking the moves back). */
	start: BgBoard;
	roll: [number, number] | null;
	made: BgMove[];
	/** The opening throw, shown until the starter has played it. */
	opening: [number, number] | null;
	result: { winner: Player; points: number; matchOver: boolean } | null;
}

const RULES = (
	<>
		<p>هر کی زودتر هر ۱۵ مهره‌اش رو دور بزنه و از خونه‌ی خودش بیرون ببره، برنده‌ست.</p>
		<ul>
			<li>شروع: هر کدوم یه تاس می‌ندازید؛ عدد بزرگ‌تر شروع می‌کنه و با همون دو عدد بازی می‌کنه.</li>
			<li>هر عدد تاس یه حرکته؛ جفت یعنی چهار حرکت. تا جایی که می‌شه باید هر دو عدد بازی بشه؛ اگه فقط یکی جا بشه، عدد بزرگ‌تر.</li>
			<li>روی خونه‌ای که حریف دو مهره یا بیشتر داره نمی‌شه نشست. مهره‌ی تکِ حریف رو بزنی، می‌ره روی بار و باید اول از خونه‌ی تو وارد بشه.</li>
			<li>وقتی همه‌ی مهره‌ها توی خونه‌ی خودت باشن، می‌تونی بیرون ببری. عدد بزرگ‌تر فقط وقتی از دورترین مهره بیرون می‌بره که پشتش مهره‌ای نباشه.</li>
			<li>برد یک امتیازه؛ اگه حریف هنوز هیچ مهره‌ای بیرون نبرده باشه «مارس» شده و دو امتیاز. تاس دوبرابرکن نداریم.</li>
		</ul>
	</>
);

// ─── saved state check ───────────────────────────────────────────────────────

function isBgBoard(value: unknown): value is BgBoard {
	if (!isRecord(value) || !isIntArray(value.points, 24) || !isIntArray(value.bar, 2) || !isIntArray(value.off, 2)) return false;
	const board = value as unknown as BgBoard;
	return ([0, 1] as const).every((p) => {
		let n = board.bar[p] + board.off[p];
		for (let i = 0; i < 24; i++) n += countAt(board, p, i);
		return n === CHECKERS && board.bar[p] >= 0 && board.off[p] >= 0;
	});
}

const isBgMove = (value: unknown) =>
	isRecord(value) && (value.from === 'bar' || isInt(value.from)) && (value.to === 'off' || isInt(value.to)) && isInt(value.die);

function isBgMatch(value: unknown): boolean {
	if (!isBoardMatch(value, 2)) return false;
	const target = (value.settings as unknown as Record<string, unknown>).target;
	if (![1, 3, 5, 7].includes(target as number) || !isIntArray(value.wins, 2)) return false;
	if (value.stage !== 'opening' && value.stage !== 'turn') return false;
	if (!isBgBoard(value.board) || !isBgBoard(value.start)) return false;
	if (value.roll !== null && !(isIntArray(value.roll, 2) && value.roll.every((d) => d >= 1 && d <= 6))) return false;
	if (value.opening !== null && !isIntArray(value.opening, 2)) return false;
	if (!Array.isArray(value.made) || !value.made.every(isBgMove)) return false;
	if (value.result !== null && !(isRecord(value.result) && (value.result.winner === 0 || value.result.winner === 1))) return false;
	// the moves of this turn, played from its start, must give the board (and be allowed)
	if (value.roll && value.phase === 'play') {
		const turn = value.turn as Player;
		const turnPlays = plays(value.start, turn, diceOf(value.roll as [number, number]));
		let board = value.start;
		const made = value.made as BgMove[];
		for (let k = 0; k < made.length; k++) {
			if (!nextMoves(turnPlays, made.slice(0, k)).some((m) => m.from === made[k].from && m.to === made[k].to && m.die === made[k].die)) return false;
			board = applyBgMove(board, turn, made[k]);
		}
		if (boardKey(board) !== boardKey(value.board)) return false;
	}
	return true;
}

function newGame(match: BgMatch, round: number): BgMatch {
	const board = newBgBoard();
	return { ...match, round, phase: 'play', stage: 'opening', turn: 0, board, start: board, roll: null, made: [], opening: null, result: null };
}

export default function BackgammonGame({ onExit }: { onExit: () => void }) {
	const [match, setMatch] = useSavedGame<BgMatch>(
		'backgammon',
		VERSION,
		() => {
			const board = newBgBoard();
			return {
				settings: { bot: true, level: 'easy', names: rememberedNames('players', 2, 2), target: 3 },
				wins: [0, 0],
				round: 0,
				phase: 'setup',
				stage: 'opening',
				turn: 0,
				board,
				start: board,
				roll: null,
				made: [],
				opening: null,
				result: null,
			};
		},
		(m) => m.phase !== 'setup',
		{ isValid: isBgMatch },
	);
	const { settings, phase } = match;

	return (
		<GameFrame title="تخته نرد" theme="light" live={phase !== 'setup'} onExit={onExit} rules={RULES}>
			{phase === 'setup' ? (
				<BoardSetup
					intro="تخته نرد با قانون‌های خودمون: بدون تاس دوبرابرکن، با مارس. دونفره روی یه گوشی یا با ربات."
					icon={GAME_ICONS.backgammon}
					settings={settings}
					maxPlayers={2}
					onChange={(s) => setMatch({ ...match, settings: { ...settings, ...s } })}
					onStart={(s) => setMatch(newGame({ ...match, settings: { ...settings, ...s }, wins: [0, 0] }, 1))}
				>
					<Field label="بازی تا چند امتیاز" hint="هر برد ۱ امتیاز، مارس ۲ امتیاز.">
						<Choices
							label="بازی تا چند امتیاز"
							value={settings.target}
							onChange={(target) => setMatch({ ...match, settings: { ...settings, target } })}
							options={[1, 3, 5, 7].map((n) => ({ value: n, label: fa(n) }))}
						/>
					</Field>
				</BoardSetup>
			) : (
				<BgPlay match={match} setMatch={setMatch} />
			)}
		</GameFrame>
	);
}

// ─── Playing ──────────────────────────────────────────────────────────────────

type Spot = number | 'bar';

function BgPlay({ match, setMatch }: { match: BgMatch; setMatch: (m: BgMatch) => void }) {
	const { settings, board, roll, made, phase, stage } = match;
	const turn = match.turn as Player;
	const names = settings.names;
	const dice = useMemo(() => (roll ? diceOf(roll) : []), [roll]);
	const turnPlays = useMemo(() => (roll && phase === 'play' ? plays(match.start, turn, dice) : []), [match.start, turn, dice, roll, phase]);
	const allowed = useMemo(() => nextMoves(turnPlays, made), [turnPlays, made]);
	const blocked = roll !== null && turnPlays.every((play) => play.length === 0);
	const complete = roll !== null && !blocked && allowed.length === 0;
	const botTurn = phase === 'play' && stage === 'turn' && settings.bot && turn === 1;
	const [selected, setSelected] = useState<Spot | null>(null);
	const plan = useRef<{ key: string; moves: BgMove[] } | null>(null);
	const left = roll ? diceLeft(dice, made) : [];

	// a checker on the bar is the only one that can move: picked by itself
	const source: Spot | null = board.bar[turn] > 0 && allowed.some((m) => m.from === 'bar') ? 'bar' : selected;

	const pass = (m: BgMatch) => setMatch({ ...m, turn: m.turn === 0 ? 1 : 0, roll: null, made: [], start: m.board, opening: null });

	const move = (m: BgMove) => {
		const nextBoard = applyBgMove(board, turn, m);
		setSelected(null);
		const next = { ...match, board: nextBoard, made: [...made, m] };
		if (hasWon(nextBoard, turn)) {
			const points = gamePoints(nextBoard, turn);
			const wins = match.wins.map((w, i) => (i === turn ? w + points : w));
			const matchOver = wins[turn] >= settings.target;
			endSound([turn], settings.bot);
			setMatch({ ...next, phase: 'over', wins, result: { winner: turn, points, matchOver } });
			return;
		}
		const hit = nextBoard.bar[turn === 0 ? 1 : 0] > board.bar[turn === 0 ? 1 : 0];
		playSound(hit ? 'buzz' : m.to === 'off' ? 'correct' : 'tick');
		setMatch(next);
	};

	const throwDice = () => {
		unlockAudio();
		playSound('tap');
		setSelected(null);
		if (stage === 'opening') {
			const first = openingRoll();
			setMatch({ ...match, stage: 'turn', turn: first.starter, roll: first.dice, opening: first.dice, made: [], start: board });
		} else setMatch({ ...match, roll: [rollDie(), rollDie()], made: [], start: board });
	};

	// what happens by itself: the bot's turn, and a turn with no possible move
	useEffect(() => {
		if (phase !== 'play' || stage !== 'turn') return;
		let timer: number | undefined;
		if (blocked) timer = window.setTimeout(() => pass(match), 1500);
		else if (botTurn) {
			if (roll === null) timer = window.setTimeout(throwDice, 700);
			else if (complete) timer = window.setTimeout(() => pass(match), 700);
			else {
				const key = `${match.round}|${boardKey(match.start)}|${roll.join()}`;
				if (plan.current?.key !== key) plan.current = { key, moves: botPlay(match.start, turn, dice, settings.level) };
				const next = plan.current.moves[made.length];
				if (next) timer = window.setTimeout(() => move(next), made.length ? 550 : 800);
			}
		}
		return () => window.clearTimeout(timer);
		// one step per situation; the functions read the current match
	}, [phase, stage, blocked, botTurn, roll, complete, made.length, match.round]);

	const tapSpot = (spot: Spot) => {
		if (phase !== 'play' || botTurn || roll === null) return;
		if (source !== null && spot !== 'bar') {
			const m = allowed.find((a) => a.from === source && a.to === spot);
			if (m) return move(m);
		}
		const movable = allowed.some((a) => a.from === spot);
		setSelected(movable && selected !== spot ? spot : null);
	};

	const bearOff = () => {
		if (source === null) return;
		// the smallest die that bears this checker off (the bigger one stays for later)
		const options = allowed.filter((a) => a.from === source && a.to === 'off').sort((a, b) => a.die - b.die);
		if (options[0]) move(options[0]);
	};

	const destinations = new Set<number | 'off'>(source !== null ? allowed.filter((a) => a.from === source).map((a) => a.to) : []);
	const sources = new Set<Spot>(roll && !botTurn && !complete ? allowed.map((a) => a.from) : []);
	const lastTo = new Set(made.map((m) => m.to));

	let status: string;
	if (phase === 'over') status = `دست ${fa(match.round)} · ${fa(match.wins[0])} – ${fa(match.wins[1])}`;
	else if (stage === 'opening') status = 'تاس اول: هر کی عدد بزرگ‌تر بیاره شروع می‌کنه';
	else if (match.opening && !made.length) status = `${names[turn]} شروع می‌کنه (${fa(match.opening[turn])} در برابر ${fa(match.opening[turn === 0 ? 1 : 0])})`;
	else if (roll === null) status = botTurn ? 'ربات داره تاس می‌ندازه…' : `نوبت ${names[turn]}: تاس بنداز`;
	else if (blocked) status = `${fa(roll[0])} و ${fa(roll[1])} اومد؛ حرکتی نداری`;
	else if (complete) status = botTurn ? 'ربات بازی کرد' : 'تموم شد؟ «تموم» رو بزن، یا برگردون';
	else if (botTurn) status = 'ربات داره بازی می‌کنه…';
	else status = `نوبت ${names[turn]}: ${left.map((d) => fa(d)).join(' و ')} مونده`;

	const checker = (p: Player) => <span className={`bg-checker bg-p${p}`} />;

	const point = (i: number, top: boolean) => {
		const n = Math.abs(board.points[i]);
		const owner: Player | null = board.points[i] > 0 ? 0 : board.points[i] < 0 ? 1 : null;
		const shown = Math.min(n, 5);
		const classes = [
			'bg-point',
			top ? 'top' : 'bottom',
			i % 2 ? 'odd' : 'even',
			source === i ? 'selected' : '',
			destinations.has(i) ? 'dest' : '',
			sources.has(i) && source === null ? 'movable' : '',
		].join(' ');
		return (
			<button key={i} type="button" className={classes} aria-label={`خونه‌ی ${fa(turn === 0 ? i + 1 : 24 - i)}${n ? `، ${fa(n)} مهره‌ی ${names[owner ?? 0]}` : ''}`} onClick={() => tapSpot(i)}>
				<span className="bg-stack">
					{Array.from({ length: shown }, (_, k) => (
						<span key={k} className={`bg-checker bg-p${owner}${k === shown - 1 && lastTo.has(i) ? ' last' : ''}`}>
							{k === shown - 1 && n > 5 ? <b>{fa(n)}</b> : null}
						</span>
					))}
				</span>
			</button>
		);
	};

	const bar = (p: Player) => (
		<button
			type="button"
			className={`bg-bar ${p === 1 ? 'top' : 'bottom'}${source === 'bar' && turn === p ? ' selected' : ''}`}
			aria-label={`بار ${names[p]}: ${fa(board.bar[p])} مهره`}
			onClick={() => tapSpot('bar')}
		>
			{Array.from({ length: Math.min(board.bar[p], 3) }, (_, k) => (
				<span key={k} className={`bg-checker bg-p${p}`}>
					{k === Math.min(board.bar[p], 3) - 1 && board.bar[p] > 3 ? <b>{fa(board.bar[p])}</b> : null}
				</span>
			))}
		</button>
	);

	const tray = (p: Player) => {
		const canOff = p === turn && destinations.has('off');
		return (
			<button
				type="button"
				className={`bg-tray${canOff ? ' dest' : ''}`}
				disabled={!canOff}
				aria-label={canOff ? 'بیرون بردن مهره' : `${names[p]}: ${fa(board.off[p])} مهره بیرون`}
				onClick={bearOff}
			>
				<span className="bg-tray-name">{names[p]}</span>
				<span className="bg-tray-stack" aria-hidden="true">
					{Array.from({ length: board.off[p] }, (_, k) => (
						<span key={k} className={`bg-off bg-p${p}`} />
					))}
				</span>
				<span className="bg-tray-count">{canOff ? 'بیرون ببر' : `${fa(board.off[p])} از ۱۵`}</span>
			</button>
		);
	};

	const diceView: ReactNode =
		stage === 'opening' ? (
			<button type="button" className="bg-roll" onClick={throwDice} disabled={phase !== 'play'}>
				تاس اول رو بنداز
			</button>
		) : roll === null ? (
			<button type="button" className="bg-roll" onClick={throwDice} disabled={botTurn || phase !== 'play'}>
				<Die value={6} player={turn} />
				<Die value={3} player={turn} />
				<span>تاس بنداز</span>
			</button>
		) : (
			<div className="bg-dice" aria-label={`تاس‌ها: ${fa(roll[0])} و ${fa(roll[1])}`}>
				{dice.map((d, k) => (
					<Die key={k} value={d} player={turn} used={!leftHas(left, d, dice, k)} />
				))}
			</div>
		);

	return (
		<div className="bd-play bg-play">
			<PlayersBar
				names={names}
				pieces={[checker(0), checker(1)]}
				current={phase === 'play' && stage === 'turn' ? turn : null}
				scores={match.wins}
				scoreLabel={`از ${fa(settings.target)}`}
				bot={settings.bot}
			/>
			<p className="bd-status" aria-live="polite">
				{status}
			</p>
			<div className="bg-board">
				{tray(1)}
				<div className="bg-field">
					{[12, 13, 14, 15, 16, 17].map((i) => point(i, true))}
					{bar(1)}
					{[18, 19, 20, 21, 22, 23].map((i) => point(i, true))}
					<div className="bg-middle">{phase === 'play' && diceView}</div>
					{[11, 10, 9, 8, 7, 6].map((i) => point(i, false))}
					{bar(0)}
					{[5, 4, 3, 2, 1, 0].map((i) => point(i, false))}
				</div>
				{tray(0)}
			</div>
			{phase === 'play' && stage === 'turn' && !botTurn && roll !== null && !blocked && (
				<div className="bg-tools">
					<button
						type="button"
						className="gm-btn gm-btn-ghost"
						disabled={!made.length}
						onClick={() => {
							setSelected(null);
							setMatch({ ...match, board: match.start, made: [] });
						}}
					>
						برگردون
					</button>
					<button type="button" className="gm-btn gm-btn-primary" disabled={!complete} onClick={() => pass(match)}>
						تموم
					</button>
				</div>
			)}
			{phase === 'over' && match.result && (
				<RoundResult
					winners={[match.result.winner]}
					names={names}
					bot={settings.bot}
					sub={
						match.result.matchOver
							? `${match.result.points === 2 ? 'مارس! ' : ''}بازی تموم شد: ${fa(match.wins[match.result.winner])} به ${fa(match.wins[match.result.winner === 0 ? 1 : 0])}`
							: `${match.result.points === 2 ? 'مارس! ۲ امتیاز' : '۱ امتیاز'} · ${fa(match.wins[0])} – ${fa(match.wins[1])} (تا ${fa(settings.target)})`
					}
					onNext={() => setMatch(newGame(match.result?.matchOver ? { ...match, wins: [0, 0] } : match, match.round + 1))}
					onSetup={() => setMatch({ ...match, phase: 'setup' })}
				/>
			)}
		</div>
	);
}

/** Whether die k of the roll is still to be played (used dice are greyed, from the first ones). */
function leftHas(left: readonly number[], d: number, dice: readonly number[], k: number): boolean {
	// the same number twice (a double): the last ones stay lit
	const sameBefore = dice.slice(0, k).filter((x) => x === d).length;
	const usedOfThis = dice.filter((x) => x === d).length - left.filter((x) => x === d).length;
	return sameBefore >= usedOfThis;
}

const PIPS: Record<number, [number, number][]> = {
	1: [[50, 50]],
	2: [[30, 30], [70, 70]],
	3: [[28, 28], [50, 50], [72, 72]],
	4: [[30, 30], [70, 30], [30, 70], [70, 70]],
	5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
	6: [[30, 26], [70, 26], [30, 50], [70, 50], [30, 74], [70, 74]],
};

function Die({ value, player, used }: { value: number; player: Player; used?: boolean }) {
	return (
		<svg className={`bg-die bg-die-${player}${used ? ' used' : ''}`} viewBox="0 0 100 100" aria-hidden="true">
			<rect x="5" y="5" width="90" height="90" rx="20" />
			{PIPS[value].map(([x, y], i) => (
				<circle key={i} cx={x} cy={y} r="9" />
			))}
		</svg>
	);
}
