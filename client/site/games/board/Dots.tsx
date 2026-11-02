import { useMemo, type KeyboardEvent } from 'react';
import { GAME_ICONS } from '../kit/icons';
import { rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { playSound } from '../kit/sound';
import { Choices, Field, GameFrame, fa } from '../kit/ui';
import { BoardSetup, PlayersBar, RoundResult, endSound, isBoardMatch, isCells, isIntArray, isRecord, starterOf, useBotTurn, type BoardSettings } from './kit';
import { botLine, drawLine, emptyDots, isDrawn, isOver, lineOwner, scoresOf, type DotsBoard, type Line } from './dots-rules';

// «نقطه‌بازی»: draw a line between two dots; the fourth side of a box makes it yours and you draw again.
// 2–4 friends on one phone, or one player against the bot; three board sizes.

// 2: each line remembers who drew it (version 1 saves only knew whether it was drawn)
const VERSION = 2;
const SIZES = [3, 4, 5] as const;
type Size = (typeof SIZES)[number];

interface DotsMatch {
	settings: BoardSettings & { size: Size };
	/** Rounds won by each player. */
	wins: number[];
	round: number;
	phase: 'setup' | 'play' | 'over';
	board: DotsBoard;
	turn: number;
	/** The last move closed a box: the same player goes again. */
	again: boolean;
	winners: number[];
}

const RULES = (
	<>
		<p>به نوبت بین دو نقطه‌ی کنار هم یه خط بکشید.</p>
		<ul>
			<li>هر کی ضلع چهارم یه خونه رو بکشه، اون خونه مال اونه و باید دوباره خط بکشه.</li>
			<li>مراقب باش ضلع سوم یه خونه رو نکشی؛ نفر بعدی اون خونه رو می‌گیره.</li>
			<li>وقتی همه‌ی خط‌ها کشیده شد، هر کی خونه‌ی بیشتری داشته باشه برنده‌ست.</li>
		</ul>
	</>
);

/** Each player's colour: their lines, their boxes and their dot on the bar. Clearly different from each other and
 * from the brown of the page (the shared team colours start with a brown). */
const PLAYER_COLORS = ['#d0533c', '#2f7fbf', '#3d9a52', '#8b54b5'];
const playerColor = (index: number) => PLAYER_COLORS[index % PLAYER_COLORS.length];

/**
 * The mark of each player in their boxes and on their dot in the bar: the first letter of the name, or the
 * player's number when two names start with the same letter («بازیکن ۱» / «بازیکن ۲», «سارا» / «سهیل»), so the
 * boxes can be told apart without relying on the colour alone.
 */
function playerMarks(names: readonly string[]): string[] {
	const firsts = names.map((name) => name.trim().charAt(0));
	return firsts.map((first, i) => (first && firsts.filter((f) => f === first).length === 1 ? first : fa(i + 1)));
}

/** The board in SVG units: dots GAP apart, MARGIN around. */
const GAP = 64;
const MARGIN = 18;
/** The invisible area that takes the tap: thick, and a little shorter than the gap so it never covers a dot. */
const HIT_WIDTH = 30;
const HIT_INSET = 12;

/** A save this build can play (anything else starts the game fresh). */
function isDotsMatch(value: unknown): boolean {
	if (!isBoardMatch(value, 4)) return false;
	const size = (value.settings as { size?: unknown }).size;
	if (!SIZES.includes(size as Size)) return false;
	const board = value.board;
	if (!isRecord(board) || !SIZES.includes(board.n as Size)) return false;
	const n = board.n as number;
	const players = value.settings.names.length;
	return (
		isCells(board.h, (n + 1) * n, players) &&
		isCells(board.v, n * (n + 1), players) &&
		isCells(board.boxes, n * n, players) &&
		isIntArray(value.wins) &&
		isIntArray(value.winners) &&
		typeof value.again === 'boolean'
	);
}

const newRound = (match: DotsMatch, round: number): DotsMatch => ({
	...match,
	round,
	phase: 'play',
	board: emptyDots(match.settings.size),
	turn: starterOf(round, match.settings.names.length),
	again: false,
	winners: [],
});

function lineEnds(line: Line): [number, number, number, number] {
	const x = MARGIN + line.c * GAP;
	const y = MARGIN + line.r * GAP;
	return line.kind === 'h' ? [x, y, x + GAP, y] : [x, y, x, y + GAP];
}

export default function Dots({ onExit }: { onExit: () => void }) {
	const [match, setMatch] = useSavedGame<DotsMatch>(
		'dots',
		VERSION,
		() => ({
			settings: { bot: false, level: 'easy', names: rememberedNames('players', 2, 4).slice(0, 2), size: 4 },
			wins: [],
			round: 0,
			phase: 'setup',
			board: emptyDots(4),
			turn: 0,
			again: false,
			winners: [],
		}),
		(m) => m.phase !== 'setup',
		{ isValid: isDotsMatch },
	);
	const { settings, board, turn, phase } = match;
	const players = settings.names.length;
	const botTurn = phase === 'play' && settings.bot && turn === 1;
	const boxes = scoresOf(board, players);

	const draw = (line: Line, player: number) => {
		if (match.phase !== 'play' || match.turn !== player || isDrawn(match.board, line)) return;
		const step = drawLine(match.board, line, player);
		if (isOver(step.board)) {
			const scores = scoresOf(step.board, players);
			const best = Math.max(...scores);
			const winners = scores.flatMap((s, i) => (s === best ? [i] : []));
			endSound(winners.length === players ? [] : winners, settings.bot);
			setMatch({
				...match,
				board: step.board,
				phase: 'over',
				winners: winners.length === players ? [] : winners,
				wins: match.wins.map((w, i) => (winners.length === 1 && winners[0] === i ? w + 1 : w)),
			});
			return;
		}
		playSound(step.closed ? 'correct' : 'tap');
		setMatch({ ...match, board: step.board, turn: step.closed ? player : (player + 1) % players, again: step.closed > 0 });
	};

	useBotTurn(botTurn, () => draw(botLine(board, settings.level), 1), match.again ? 450 : 600);

	const marks = useMemo(() => playerMarks(settings.names), [settings.names]);
	const pieces = useMemo(
		() =>
			marks.map((mark, i) => (
				<span key={i} className="dots-dot" style={{ background: playerColor(i) }}>
					{mark}
				</span>
			)),
		[marks],
	);
	const size = MARGIN * 2 + board.n * GAP;

	const lines: Line[] = [];
	for (let r = 0; r <= board.n; r++) for (let c = 0; c < board.n; c++) lines.push({ kind: 'h', r, c });
	for (let r = 0; r < board.n; r++) for (let c = 0; c <= board.n; c++) lines.push({ kind: 'v', r, c });
	const canPlay = phase === 'play' && !botTurn;

	const status =
		phase === 'over'
			? `دست ${fa(match.round)}`
			: botTurn
				? 'ربات داره فکر می‌کنه…'
				: match.again
					? `${settings.names[turn]} یه خونه گرفت؛ دوباره نوبت خودشه`
					: `نوبت ${settings.names[turn]}`;

	return (
		<GameFrame title="نقطه‌بازی" theme="light" live={phase !== 'setup'} onExit={onExit} rules={RULES}>
			{phase === 'setup' ? (
				<BoardSetup
					intro="خط بکش، خونه ببند، و حواست باشه ضلع سوم رو دست حریف ندی."
					icon={GAME_ICONS.dots}
					settings={settings}
					maxPlayers={4}
					onChange={(s) => setMatch({ ...match, settings: { ...settings, ...s } })}
					onStart={(s) => {
						const next = { ...match, settings: { ...settings, ...s }, wins: s.names.map(() => 0) };
						setMatch(newRound(next, 1));
					}}
				>
					<Field label="اندازه‌ی صفحه">
						<Choices
							label="اندازه‌ی صفحه"
							value={settings.size}
							onChange={(size) => setMatch({ ...match, settings: { ...settings, size } })}
							options={SIZES.map((n) => ({ value: n, label: `${n === 3 ? 'کوچیک' : n === 4 ? 'متوسط' : 'بزرگ'} ${fa(n)}×${fa(n)}` }))}
						/>
					</Field>
				</BoardSetup>
			) : (
				<div className="bd-play">
					<PlayersBar
						names={settings.names}
						pieces={pieces}
						current={phase === 'play' ? turn : null}
						scores={phase === 'over' ? match.wins : boxes}
						scoreLabel={phase === 'over' ? 'برد' : 'خونه'}
						bot={settings.bot}
					/>
					<p className="bd-status" aria-live="polite">
						{status}
					</p>
					<svg className={`dots-board dots-${board.n}`} viewBox={`0 0 ${size} ${size}`} role="group" aria-label="صفحه‌ی نقطه‌بازی">
						{board.boxes.map((owner, i) => {
							if (owner === null) return null;
							const r = Math.floor(i / board.n);
							const c = i % board.n;
							return (
								<g key={`b${i}`} className="dots-box">
									<rect x={MARGIN + c * GAP + 5} y={MARGIN + r * GAP + 5} width={GAP - 10} height={GAP - 10} rx="8" fill={playerColor(owner)} />
									<text x={MARGIN + c * GAP + GAP / 2} y={MARGIN + r * GAP + GAP / 2} dy="0.35em" textAnchor="middle">
										{marks[owner]}
									</text>
								</g>
							);
						})}
						{lines.map((line) => {
							const [x1, y1, x2, y2] = lineEnds(line);
							const owner = lineOwner(board, line);
							const drawn = owner !== null;
							const label = `خط ${line.kind === 'h' ? 'افقی' : 'عمودی'}، ردیف ${fa(line.r + 1)}، ستون ${fa(line.c + 1)}`;
							// the tap area: a rectangle along the line, short of the dots at its ends
							const hit =
								line.kind === 'h'
									? { x: x1 + HIT_INSET, y: y1 - HIT_WIDTH / 2, width: GAP - 2 * HIT_INSET, height: HIT_WIDTH }
									: { x: x1 - HIT_WIDTH / 2, y: y1 + HIT_INSET, width: HIT_WIDTH, height: GAP - 2 * HIT_INSET };
							return (
								<g key={`${line.kind}${line.r}-${line.c}`}>
									<line
										className={`dots-line${drawn ? ' drawn' : ''}`}
										style={drawn ? { stroke: playerColor(owner) } : undefined}
										x1={x1}
										y1={y1}
										x2={x2}
										y2={y2}
									/>
									{!drawn && canPlay && (
										<rect
											className="dots-hit"
											{...hit}
											rx={HIT_WIDTH / 2}
											role="button"
											tabIndex={0}
											aria-label={label}
											onClick={() => draw(line, turn)}
											onKeyDown={(event: KeyboardEvent) => {
												if (event.key === 'Enter' || event.key === ' ') {
													event.preventDefault();
													draw(line, turn);
												}
											}}
										/>
									)}
								</g>
							);
						})}
						{Array.from({ length: (board.n + 1) ** 2 }, (_, i) => (
							<circle key={`d${i}`} className="dots-dot-svg" cx={MARGIN + (i % (board.n + 1)) * GAP} cy={MARGIN + Math.floor(i / (board.n + 1)) * GAP} r="6" />
						))}
					</svg>
					{phase === 'over' && (
						<RoundResult
							winners={match.winners}
							names={settings.names}
							bot={settings.bot}
							sub={settings.names.map((name, i) => `${name}: ${fa(boxes[i])}`).join(' · ')}
							onNext={() => setMatch(newRound(match, match.round + 1))}
							onSetup={() => setMatch({ ...match, phase: 'setup' })}
						/>
					)}
				</div>
			)}
		</GameFrame>
	);
}
