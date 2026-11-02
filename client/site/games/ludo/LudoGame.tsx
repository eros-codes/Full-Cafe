import { useEffect, useState, type CSSProperties } from 'react';
import { useLatest } from '../../../shared/useLatest';
import { PlayersBar, RoundResult, isInt, isIntArray, isRecord, playerPlaceholder, starterOf } from '../board/kit';
import { GAME_ICONS } from '../kit/icons';
import { rememberNames, rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { playSound, unlockAudio } from '../kit/sound';
import { Choices, Field, GameFrame, fa, finalNames } from '../kit/ui';
import {
	DEFAULT_RULES,
	HOME,
	HOME_CELLS,
	PAWNS,
	SEATS,
	STAR_CELLS,
	TRACK_CELLS,
	YARD_CELLS,
	applyMove,
	botMove,
	distinctMoves,
	hasWon,
	legalMoves,
	newBoard,
	pawnCell,
	rollDie,
	rollsAgain,
	seatsFor,
	startIndex,
	type Level,
	type LudoBoard,
	type LudoMove,
	type LudoRules,
} from './engine';

// «منچ»: 2–4 players on one phone, any of them (but the first) can be the bot. Tap the die, then the pawn to
// move (a single possible move is made by itself). The board is drawn with absolute positions on a 15 × 15
// grid, left to right whatever the page direction, so it matches the engine's geometry.

const VERSION = 1;

/** Seat colours (seat 0 top left, then clockwise). */
const SEAT_COLORS = ['#d0533c', '#3d9a52', '#d9a441', '#2f7fbf'];
const COLOR_FA = ['قرمز', 'سبز', 'زرد', 'آبی'];

const RULES = (
	<>
		<p>هر کی چهار مهره داره که باید یه دور کامل دور صفحه بزنن و از ستون رنگ خودشون به وسط برسن.</p>
		<ul>
			<li>به نوبت تاس بندازید و یکی از مهره‌ها رو به اندازه‌ی تاس جلو ببرید. اگه فقط یه حرکت ممکن باشه، خودش انجام می‌شه.</li>
			<li>مهره با ۶ از خونه بیرون میاد (اگه قانون «ورود فقط با ۶» خاموش باشه، با ۱ هم میاد).</li>
			<li>اگه روی مهره‌ی حریف فرود بیای، اون مهره برمی‌گرده خونه‌ش؛ روی خونه‌های امن (شروع هر رنگ و ستاره‌ها) نمی‌شه زد.</li>
			<li>با ۶ یه تاس دیگه می‌ندازی (اگه این قانون روشن باشه).</li>
			<li>برای رسیدن به وسط، تاس باید دقیقاً به اندازه باشه. اولین کسی که هر چهار مهره‌اش برسه، برنده‌ست.</li>
		</ul>
	</>
);

interface LudoSettings {
	/** 2–4. */
	players: number;
	/** The typed names, one per player slot (4). */
	names: string[];
	/** Which player slots are the bot (the first one never is). */
	bots: boolean[];
	level: Level;
	rules: LudoRules;
}

interface LudoMatch {
	settings: LudoSettings;
	phase: 'setup' | 'play' | 'over';
	round: number;
	/** Wins per player. */
	wins: number[];
	board: LudoBoard;
	/** The player (index into board.seats) whose turn it is. */
	turn: number;
	/** The die, once rolled this turn. */
	roll: number | null;
	winner: number | null;
	/** The pawn moved last, [seat, pawn]: it stands out. */
	last: [number, number] | null;
}

/** The names on the board: typed (or «بازیکن ۲») for people, «ربات سبز» for the bots. */
function playerNames(settings: LudoSettings): string[] {
	const seats = seatsFor(settings.players);
	const names = finalNames(settings.names.slice(0, settings.players), playerPlaceholder);
	return names.map((name, i) => (settings.bots[i] ? `ربات ${COLOR_FA[seats[i]]}` : name));
}

// ─── saved state check ───────────────────────────────────────────────────────

const isBoolArray = (value: unknown, length: number): value is boolean[] => Array.isArray(value) && value.length === length && value.every((v) => typeof v === 'boolean');

function isLudoMatch(value: unknown): boolean {
	if (!isRecord(value) || !isRecord(value.settings) || !isRecord(value.board)) return false;
	const s = value.settings;
	if (!isInt(s.players) || s.players < 2 || s.players > SEATS) return false;
	if (!Array.isArray(s.names) || s.names.length !== SEATS || !s.names.every((n) => typeof n === 'string') || !isBoolArray(s.bots, SEATS)) return false;
	if ((s.level !== 'easy' && s.level !== 'hard') || !isRecord(s.rules)) return false;
	if (!['sixToEnter', 'sixAgain', 'safeCells'].every((k) => typeof (s.rules as Record<string, unknown>)[k] === 'boolean')) return false;
	if (value.phase !== 'setup' && value.phase !== 'play' && value.phase !== 'over') return false;
	const { seats, progress } = value.board;
	if (!isIntArray(seats) || !Array.isArray(progress) || progress.length !== SEATS) return false;
	if (!progress.every((pawns) => isIntArray(pawns, PAWNS) && pawns.every((p) => p >= -1 && p <= HOME))) return false;
	if (!isInt(value.round) || !isIntArray(value.wins, SEATS) || !isInt(value.turn)) return false;
	if (value.roll !== null && !(isInt(value.roll) && value.roll >= 1 && value.roll <= 6)) return false;
	if (value.winner !== null && !isInt(value.winner)) return false;
	if (value.last !== null && !isIntArray(value.last, 2)) return false;
	if (value.phase === 'setup') return true;
	return seats.join() === seatsFor(s.players).join() && value.turn >= 0 && value.turn < s.players;
}

function newRound(match: LudoMatch, round: number): LudoMatch {
	const { players } = match.settings;
	return { ...match, phase: 'play', round, board: newBoard(seatsFor(players)), turn: starterOf(round, players), roll: null, winner: null, last: null };
}

export default function LudoGame({ onExit }: { onExit: () => void }) {
	const [match, setMatch] = useSavedGame<LudoMatch>(
		'ludo',
		VERSION,
		() => ({
			settings: { players: 2, names: rememberedNames('players', SEATS, SEATS), bots: [false, false, false, false], level: 'easy', rules: DEFAULT_RULES },
			phase: 'setup',
			round: 0,
			wins: [0, 0, 0, 0],
			board: newBoard(seatsFor(2)),
			turn: 0,
			roll: null,
			winner: null,
			last: null,
		}),
		(m) => m.phase !== 'setup',
		{ isValid: isLudoMatch },
	);
	const { settings, phase } = match;

	return (
		<GameFrame title="منچ" theme="light" live={phase !== 'setup'} onExit={onExit} rules={RULES}>
			{phase === 'setup' ? (
				<LudoSetup
					settings={settings}
					onChange={(s) => setMatch({ ...match, settings: s })}
					onStart={(s) => setMatch(newRound({ ...match, settings: s, wins: [0, 0, 0, 0] }, 1))}
				/>
			) : (
				<LudoPlay match={match} setMatch={setMatch} />
			)}
		</GameFrame>
	);
}

// ─── Setup ────────────────────────────────────────────────────────────────────

function LudoSetup({ settings, onChange, onStart }: { settings: LudoSettings; onChange: (s: LudoSettings) => void; onStart: (s: LudoSettings) => void }) {
	const seats = seatsFor(settings.players);
	const anyBot = settings.bots.slice(0, settings.players).some(Boolean);
	const setRule = (key: keyof LudoRules) => onChange({ ...settings, rules: { ...settings.rules, [key]: !settings.rules[key] } });
	const RULE_LABELS: [keyof LudoRules, string][] = [
		['sixToEnter', 'ورود فقط با ۶'],
		['sixAgain', '۶ = یه تاس دیگه'],
		['safeCells', 'خونه‌های امن'],
	];

	return (
		<div className="gm-setup">
			<div className="gm-intro">
				<span className="gm-intro-icon" aria-hidden="true">
					{GAME_ICONS.ludo}
				</span>
				<p>تاس بنداز، مهره‌هات رو دور صفحه ببر و مهره‌ی حریف رو بزن؛ هر کی زودتر هر چهارتا رو به وسط برسونه، برده.</p>
			</div>
			<Field label="تعداد بازیکن" hint={settings.players === 2 ? 'دو نفره روبه‌روی هم می‌شینید.' : undefined}>
				<Choices
					label="تعداد بازیکن"
					value={settings.players}
					onChange={(players) => onChange({ ...settings, players })}
					options={[2, 3, 4].map((n) => ({ value: n, label: `${fa(n)} نفر` }))}
				/>
			</Field>
			<Field label="بازیکن‌ها" hint="به ترتیب همین فهرست بازی می‌کنن. هر کدوم (جز اولی) می‌تونه ربات باشه.">
				<ol className="gm-names-list">
					{seats.map((seat, i) => (
						<li key={seat} className="ld-seat-row">
							<span className="gm-avatar" style={{ background: SEAT_COLORS[seat] }} aria-hidden="true">
								{fa(i + 1)}
							</span>
							{settings.bots[i] ? (
								<span className="ld-bot-name">ربات {COLOR_FA[seat]}</span>
							) : (
								<input
									value={settings.names[i]}
									maxLength={20}
									placeholder={playerPlaceholder(i)}
									aria-label={`اسم ${COLOR_FA[seat]}`}
									enterKeyHint="next"
									onChange={(event) => onChange({ ...settings, names: settings.names.map((n, j) => (j === i ? event.target.value : n)) })}
								/>
							)}
							{i > 0 && (
								<button
									type="button"
									className={`gm-chip ld-bot-toggle${settings.bots[i] ? ' on' : ''}`}
									aria-pressed={settings.bots[i]}
									aria-label={`${COLOR_FA[seat]} ربات باشه`}
									onClick={() => onChange({ ...settings, bots: settings.bots.map((b, j) => (j === i ? !b : b)) })}
								>
									ربات
								</button>
							)}
						</li>
					))}
				</ol>
			</Field>
			{anyBot && (
				<Field label="سطح ربات" hint={settings.level === 'easy' ? 'شانسی بازی می‌کنه.' : 'حساب‌شده بازی می‌کنه: می‌زنه، فرار می‌کنه و خونه‌ی امن رو بلده.'}>
					<Choices
						label="سطح ربات"
						value={settings.level}
						onChange={(level) => onChange({ ...settings, level })}
						options={[
							{ value: 'easy', label: 'آسون' },
							{ value: 'hard', label: 'سخت' },
						]}
					/>
				</Field>
			)}
			<Field label="قانون‌ها" hint="هر کدوم رو که سر میزتون جور دیگه بازی می‌کنید، خاموش کنید.">
				<div className="gm-choices">
					{RULE_LABELS.map(([key, label]) => (
						<button key={key} type="button" aria-pressed={settings.rules[key]} className={`gm-chip${settings.rules[key] ? ' on' : ''}`} onClick={() => setRule(key)}>
							{label}
						</button>
					))}
				</div>
			</Field>
			<div className="gm-sticky">
				<button
					type="button"
					className="gm-btn gm-btn-primary gm-btn-big"
					onClick={() => {
						unlockAudio();
						rememberNames(
							'players',
							settings.names.slice(0, settings.players).filter((_, i) => !settings.bots[i]),
						);
						onStart({ ...settings, bots: settings.bots.map((b, i) => i > 0 && i < settings.players && b) });
					}}
				>
					شروع بازی
				</button>
			</div>
		</div>
	);
}

// ─── Playing ──────────────────────────────────────────────────────────────────

interface Moving {
	seat: number;
	move: LudoMove;
	/** The progress shown for the moving pawn (−1 → 0, then one cell at a time). */
	at: number;
}

const pct = (cells: number) => `${(cells * 100) / 15}%`;

/** Where the pawns sharing a cell sit within it (in cells from its centre). */
function stackOffsets(count: number): [number, number][] {
	if (count <= 1) return [[0, 0]];
	if (count === 2) return [[-0.17, -0.17], [0.17, 0.17]];
	if (count === 3) return [[-0.19, -0.17], [0.19, -0.17], [0, 0.19]];
	return [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]];
}

function LudoPlay({ match, setMatch }: { match: LudoMatch; setMatch: (update: (m: LudoMatch) => LudoMatch) => void }) {
	const { settings, board, turn, roll, phase } = match;
	const { rules } = settings;
	const names = playerNames(settings);
	const seat = board.seats[turn];
	const botTurn = phase === 'play' && settings.bots[turn];
	const [rolling, setRolling] = useState(false);
	const [face, setFace] = useState(roll ?? 6);
	const [moving, setMoving] = useState<Moving | null>(null);
	const busy = rolling || moving !== null;
	const latest = useLatest(match);
	const moves = phase === 'play' && roll !== null ? legalMoves(board, seat, roll, rules) : [];
	const choices = distinctMoves(moves);
	const humanChoosing = phase === 'play' && !botTurn && roll !== null && !busy && choices.length > 1;

	// the die spins for a moment, then settles on the roll
	useEffect(() => {
		if (!rolling) return;
		const spin = window.setInterval(() => setFace(rollDie()), 75);
		const stop = window.setTimeout(() => {
			window.clearInterval(spin);
			const value = rollDie();
			setFace(value);
			setRolling(false);
			playSound('tap');
			setMatch((m) => ({ ...m, roll: value }));
		}, 520);
		return () => {
			window.clearInterval(spin);
			window.clearTimeout(stop);
		};
	}, [rolling, setMatch]);

	// the pawn walks cell by cell, and the move is kept once it has arrived
	useEffect(() => {
		if (!moving) return;
		const { move } = moving;
		if (moving.at === move.to) {
			const done = window.setTimeout(() => {
				const next = afterMove(latest.current, moving.seat, move);
				moveSound(latest.current, next, move);
				setMoving(null);
				setMatch(() => next);
			}, 140);
			return () => window.clearTimeout(done);
		}
		const step = window.setTimeout(() => setMoving({ ...moving, at: moving.at < 0 ? 0 : moving.at + 1 }), 130);
		return () => window.clearTimeout(step);
	}, [moving, setMatch, latest]);

	// what happens by itself: the bot's roll and move, a single possible move, a turn with no move
	useEffect(() => {
		if (phase !== 'play' || busy) return;
		let timer: number | undefined;
		if (roll === null) {
			if (botTurn) timer = window.setTimeout(() => setRolling(true), 700);
		} else if (!choices.length) {
			timer = window.setTimeout(() => setMatch((m) => ({ ...m, roll: null, turn: rollsAgain(roll, m.settings.rules) ? m.turn : (m.turn + 1) % m.board.seats.length })), 1100);
		} else if (botTurn || choices.length === 1) {
			const move = botTurn ? botMove(board, seat, roll, rules, settings.level) : choices[0];
			if (move) timer = window.setTimeout(() => setMoving({ seat, move, at: move.from }), botTurn ? 550 : 400);
		}
		return () => window.clearTimeout(timer);
		// once per situation: the rest (moves, seat, rules) follows from these
	}, [phase, busy, roll, turn, board, botTurn]);

	const rollTheDie = () => {
		if (phase !== 'play' || roll !== null || busy || botTurn) return;
		unlockAudio();
		setRolling(true);
	};

	const choosePawn = (pawn: number) => {
		if (!humanChoosing) return;
		const move = moves.find((m) => m.pawn === pawn);
		if (move) setMoving({ seat, move, at: move.from });
	};

	let status: string;
	if (phase === 'over') status = `دست ${fa(match.round)}`;
	else if (rolling) status = 'تاس داره می‌چرخه…';
	else if (moving) status = names[turn];
	else if (botTurn) status = `${names[turn]} داره بازی می‌کنه…`;
	else if (roll === null) status = `نوبت ${names[turn]}: تاس بنداز`;
	else if (!choices.length) status = `${fa(roll)} اومد؛ حرکتی نداری${rollsAgain(roll, rules) ? '، دوباره بنداز' : ''}`;
	else if (choices.length > 1) status = `${fa(roll)} اومد؛ یه مهره رو انتخاب کن`;
	else status = `${fa(roll)} اومد`;

	const pieces = board.seats.map((s) => <span key={s} className="ld-piece-dot" style={{ background: SEAT_COLORS[s] }} />);
	const movable = new Set(humanChoosing ? moves.map((m) => m.pawn) : []);

	// every pawn's place, with pawns sharing a cell set side by side
	const pawns = board.seats.flatMap((s) =>
		board.progress[s].map((p, pawn) => {
			const progress = moving && moving.seat === s && moving.move.pawn === pawn ? moving.at : p;
			const [row, col] = pawnCell(s, pawn, progress);
			return { seat: s, pawn, progress, row, col };
		}),
	);
	const byCell = new Map<string, number>();
	const placed = pawns.map((p) => {
		const key = `${p.row},${p.col}`;
		const index = byCell.get(key) ?? 0;
		byCell.set(key, index + 1);
		return { ...p, index };
	});

	return (
		<div className="bd-play ld-play">
			<PlayersBar names={names} pieces={pieces} current={phase === 'play' ? turn : null} scores={match.wins} scoreLabel="برد" bot={settings.bots.slice(0, settings.players)} />
			<p className="bd-status" aria-live="polite">
				{status}
			</p>
			<div className="ld-board" role="group" aria-label="صفحه‌ی منچ">
				{[0, 1, 2, 3].map((s) => {
					const [row, col] = [s === 2 || s === 3 ? 9 : 0, s === 1 || s === 2 ? 9 : 0];
					return (
						<span
							key={`yard${s}`}
							className={`ld-yard ld-yard-${s}${board.seats.includes(s) ? '' : ' off'}${phase === 'play' && seat === s ? ' now' : ''}`}
							style={{ top: pct(row), left: pct(col), background: SEAT_COLORS[s] }}
						/>
					);
				})}
				{YARD_CELLS.map((spots, s) =>
					spots.map(([row, col], i) => (
						<span key={`y${s}-${i}`} className={`ld-spot${board.seats.includes(s) ? '' : ' off'}`} style={{ top: pct(row), left: pct(col), borderColor: SEAT_COLORS[s] }} />
					)),
				)}
				{TRACK_CELLS.map(([row, col], index) => {
					const startOf = index % 13 === 0 ? index / 13 : -1;
					const star = rules.safeCells && STAR_CELLS.includes(index);
					return (
						<span
							key={`t${index}`}
							className={`ld-cell${startOf >= 0 ? ' start' : ''}`}
							style={{ top: pct(row), left: pct(col), ...(startOf >= 0 ? { background: SEAT_COLORS[startOf] } : null) }}
						>
							{(star || (startOf >= 0 && rules.safeCells)) && <StarMark />}
						</span>
					);
				})}
				{HOME_CELLS.map((cells, s) =>
					cells.map(([row, col], i) => <span key={`h${s}-${i}`} className="ld-cell home" style={{ top: pct(row), left: pct(col), background: SEAT_COLORS[s] }} />),
				)}
				<span
					className="ld-center"
					style={{
						top: pct(6),
						left: pct(6),
						background: `conic-gradient(from -45deg, ${SEAT_COLORS[1]} 0 90deg, ${SEAT_COLORS[2]} 90deg 180deg, ${SEAT_COLORS[3]} 180deg 270deg, ${SEAT_COLORS[0]} 270deg 360deg)`,
					}}
				/>
				{[0, 1, 2, 3].map((s) => (
					<span key={`a${s}`} className="ld-entry" style={{ ...entryPlace(s), color: SEAT_COLORS[s] }} aria-hidden="true" />
				))}
				{placed.map((p) => {
					const [dx, dy] = stackOffsets(byCell.get(`${p.row},${p.col}`) ?? 1)[p.index % 4];
					const style = {
						top: pct(p.row + 0.5 + dy),
						left: pct(p.col + 0.5 + dx),
						'--pawn': SEAT_COLORS[p.seat],
					} as CSSProperties;
					const isMoving = moving?.seat === p.seat && moving.move.pawn === p.pawn;
					const isLast = !moving && match.last?.[0] === p.seat && match.last[1] === p.pawn;
					const stacked = (byCell.get(`${p.row},${p.col}`) ?? 1) > 1;
					const className = `ld-pawn${stacked ? ' small' : ''}${isMoving ? ' moving' : ''}${isLast ? ' last' : ''}${p.progress >= HOME ? ' home' : ''}`;
					if (p.seat === seat && movable.has(p.pawn)) {
						return (
							<button
								key={`p${p.seat}-${p.pawn}`}
								type="button"
								className={`${className} movable`}
								style={style}
								aria-label={`مهره‌ی ${fa(p.pawn + 1)} ${COLOR_FA[p.seat]}${p.progress < 0 ? '، توی خونه' : ''}`}
								onClick={() => choosePawn(p.pawn)}
							/>
						);
					}
					return <span key={`p${p.seat}-${p.pawn}`} className={className} style={style} aria-hidden="true" />;
				})}
			</div>
			{phase === 'play' && (
				<div className="ld-dice-row">
					<button
						type="button"
						className={`ld-die${rolling ? ' rolling' : ''}${roll === null && !busy && !botTurn ? ' ready' : ''}`}
						style={{ '--seat': SEAT_COLORS[seat] } as CSSProperties}
						aria-label={roll === null ? 'تاس بنداز' : `تاس: ${fa(roll)}`}
						disabled={roll !== null || busy || botTurn}
						onClick={rollTheDie}
					>
						<DieFace value={rolling ? face : (roll ?? face)} />
					</button>
				</div>
			)}
			{phase === 'over' && match.winner !== null && (
				<RoundResult
					winners={[match.winner]}
					names={names}
					bot={false}
					sub={`هر چهار مهره‌ی ${COLOR_FA[board.seats[match.winner]]} رسید.`}
					onNext={() => setMatch((m) => newRound(m, m.round + 1))}
					onSetup={() => setMatch((m) => ({ ...m, phase: 'setup' }))}
				/>
			)}
		</div>
	);
}

/** After a pawn has arrived: the move is kept; a win ends the round; a 6 rolls again, otherwise the next player. */
function afterMove(match: LudoMatch, seat: number, move: LudoMove): LudoMatch {
	if (match.phase !== 'play' || match.roll === null) return match;
	const board = applyMove(match.board, seat, move);
	const last: [number, number] = [seat, move.pawn];
	if (hasWon(board, seat)) {
		return { ...match, board, last, roll: null, phase: 'over', winner: match.turn, wins: match.wins.map((w, i) => (i === match.turn ? w + 1 : w)) };
	}
	const again = rollsAgain(match.roll, match.settings.rules);
	return { ...match, board, last, roll: null, turn: again ? match.turn : (match.turn + 1) % board.seats.length };
}

function moveSound(before: LudoMatch, after: LudoMatch, move: LudoMove): void {
	if (after.phase === 'over') {
		// a bot beating the only person at the table sounds like a loss
		const humans = before.settings.bots.slice(0, before.settings.players).filter((b) => !b).length;
		playSound(before.settings.bots[before.turn] && humans === 1 ? 'pass' : 'win');
	} else playSound(move.captures.length ? 'buzz' : move.to >= HOME ? 'correct' : 'tick');
}

/** The little arrow where each colour turns into its home column. */
function entryPlace(seat: number): CSSProperties {
	const [row, col] = TRACK_CELLS[(startIndex(seat) + 50) % TRACK_CELLS.length];
	return { top: pct(row), left: pct(col), rotate: `${seat * 90}deg` };
}

function StarMark() {
	return (
		<svg className="ld-star" viewBox="0 0 24 24" aria-hidden="true">
			<path d="M12 3.2l2.6 5.5 6 .8-4.4 4.1 1.1 5.9L12 16.6l-5.3 2.9 1.1-5.9-4.4-4.1 6-.8z" />
		</svg>
	);
}

const PIPS: Record<number, [number, number][]> = {
	1: [[50, 50]],
	2: [[28, 28], [72, 72]],
	3: [[28, 28], [50, 50], [72, 72]],
	4: [[28, 28], [72, 28], [28, 72], [72, 72]],
	5: [[28, 28], [72, 28], [50, 50], [28, 72], [72, 72]],
	6: [[28, 26], [72, 26], [28, 50], [72, 50], [28, 74], [72, 74]],
};

function DieFace({ value }: { value: number }) {
	return (
		<svg viewBox="0 0 100 100" aria-hidden="true">
			<rect x="4" y="4" width="92" height="92" rx="20" className="ld-die-body" />
			{(PIPS[value] ?? PIPS[1]).map(([x, y], i) => (
				<circle key={i} cx={x} cy={y} r="8.5" className="ld-pip" />
			))}
		</svg>
	);
}
