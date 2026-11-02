import { useMemo, useState } from 'react';
import { BoardSetup, PlayersBar, RoundResult, endSound, isBoardMatch, isInt, isIntArray, isRecord, useBotTurn, type BoardSettings } from '../board/kit';
import { GAME_ICONS } from '../kit/icons';
import { rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { playSound } from '../kit/sound';
import { Choices, Field, GameFrame, Sheet, fa } from '../kit/ui';
import {
	PROMOTIONS,
	botMove,
	captured,
	inCheck,
	kingSquare,
	legalMoves,
	outcomeOf,
	replay,
	san,
	squareName,
	type Color,
	type Move,
	type Outcome,
	type Promo,
} from './engine';
import { Piece } from './pieces';

// «شطرنج»: two players on one phone, or one against the bot. Tap a piece, then where it goes. The game is
// kept as its list of moves (rebuilt, and checked, when the page opens again).

const VERSION = 1;

interface ChessSettings extends BoardSettings {
	/** Against the bot: the player's colour, or a different one each round. */
	color: 'w' | 'b' | 'alternate';
	/** Two players facing each other: the board turns to whoever is to move. */
	turnBoard: boolean;
}

interface ChessMatch {
	settings: ChessSettings;
	wins: number[];
	draws: number;
	round: number;
	phase: 'setup' | 'play' | 'over';
	/** Who plays white this round (0 = the first name). */
	white: number;
	moves: Move[];
	outcome: Outcome | null;
	/** For the shared board-game save shape: the player to move. */
	turn: number;
}

const RULES = (
	<>
		<p>شطرنج با همه‌ی قانون‌هاش: قلعه، آن‌پاسان، ارتقای سرباز، کیش و مات.</p>
		<ul>
			<li>روی یه مهره بزن تا خونه‌هایی که می‌تونه بره نشون داده بشه، بعد روی مقصد بزن.</li>
			<li>بازی مساوی می‌شه با پات، تکرار سه‌باره‌ی یک وضعیت، ۵۰ حرکت پشت هم بدون زدن مهره یا حرکت سرباز، یا وقتی مهره‌ی کافی برای مات نمونده.</li>
			<li>«برگردون» آخرین حرکت رو پس می‌گیره (با ربات، حرکت خودت و جواب ربات رو).</li>
			<li>ربات «آسون» زیاد اشتباه می‌کنه؛ «سخت» مثل یه بازیکن باشگاهیِ تازه‌کار بازی می‌کنه.</li>
		</ul>
	</>
);

const OUTCOME_TEXT: Record<Outcome['kind'], string> = {
	checkmate: 'کیش و مات',
	stalemate: 'پات شد؛ مساوی',
	fifty: '۵۰ حرکت بدون زدن مهره و حرکت سرباز؛ مساوی',
	material: 'مهره‌ی کافی برای مات نمونده؛ مساوی',
	repetition: 'یه وضعیت سه بار تکرار شد؛ مساوی',
	resign: 'تسلیم شد',
	agreed: 'مساوی با توافق',
};

const COLOR_FA: Record<Color, string> = { w: 'سفید', b: 'سیاه' };

const isMove = (value: unknown) =>
	isRecord(value) && isInt(value.from) && isInt(value.to) && (value.promo === undefined || (PROMOTIONS as readonly unknown[]).includes(value.promo));

/** A save this build can play: the shape, and every move legal from the start. */
function isChessMatch(value: unknown): boolean {
	if (!isBoardMatch(value, 2)) return false;
	const s = value.settings as unknown as Record<string, unknown>;
	if (!['w', 'b', 'alternate'].includes(s.color as string) || typeof s.turnBoard !== 'boolean') return false;
	if (!isIntArray(value.wins, 2) || !isInt(value.draws) || (value.white !== 0 && value.white !== 1)) return false;
	if (!Array.isArray(value.moves) || !value.moves.every(isMove)) return false;
	if (value.outcome !== null && !(isRecord(value.outcome) && typeof value.outcome.kind === 'string' && value.outcome.kind in OUTCOME_TEXT)) return false;
	return replay(value.moves as Move[]) !== null;
}

/** Who plays white in round `round`. */
function whiteOf(settings: ChessSettings, round: number): number {
	if (settings.bot && settings.color !== 'alternate') return settings.color === 'w' ? 0 : 1;
	return (round - 1) % 2;
}

const newRound = (match: ChessMatch, round: number): ChessMatch => ({
	...match,
	round,
	phase: 'play',
	white: whiteOf(match.settings, round),
	moves: [],
	outcome: null,
	turn: whiteOf(match.settings, round),
});

export default function ChessGame({ onExit }: { onExit: () => void }) {
	const [match, setMatch] = useSavedGame<ChessMatch>(
		'chess',
		VERSION,
		() => ({
			settings: { bot: true, level: 'easy', names: rememberedNames('players', 2, 2), color: 'w', turnBoard: false },
			wins: [0, 0],
			draws: 0,
			round: 0,
			phase: 'setup',
			white: 0,
			moves: [],
			outcome: null,
			turn: 0,
		}),
		(m) => m.phase !== 'setup',
		{ isValid: isChessMatch },
	);
	const { settings, phase } = match;

	return (
		<GameFrame title="شطرنج" theme="light" live={phase !== 'setup'} onExit={onExit} rules={RULES}>
			{phase === 'setup' ? (
				<BoardSetup
					intro="شطرنج دونفره روی یه گوشی، یا با ربات. ربات «سخت» هم شکست‌ناپذیر نیست!"
					icon={GAME_ICONS.chess}
					settings={settings}
					maxPlayers={2}
					onChange={(s) => setMatch({ ...match, settings: { ...settings, ...s } })}
					onStart={(s) => setMatch(newRound({ ...match, settings: { ...settings, ...s }, wins: [0, 0], draws: 0 }, 1))}
				>
					{settings.bot ? (
						<Field label="رنگ شما" hint={settings.color === 'alternate' ? 'هر دست رنگ‌ها عوض می‌شه؛ سفید شروع می‌کنه.' : 'سفید شروع می‌کنه.'}>
							<Choices
								label="رنگ شما"
								value={settings.color}
								onChange={(color) => setMatch({ ...match, settings: { ...settings, color } })}
								options={[
									{ value: 'w', label: 'سفید' },
									{ value: 'b', label: 'سیاه' },
									{ value: 'alternate', label: 'یکی در میون' },
								]}
							/>
						</Field>
					) : (
						<Field label="صفحه" hint={settings.turnBoard ? 'برای وقتی روبه‌روی هم نشستید: صفحه همیشه رو به کسیه که نوبتشه.' : 'برای وقتی کنار هم نشستید.'}>
							<Choices
								label="صفحه"
								value={settings.turnBoard}
								onChange={(turnBoard) => setMatch({ ...match, settings: { ...settings, turnBoard } })}
								options={[
									{ value: false, label: 'ثابت' },
									{ value: true, label: 'بچرخه سمت نوبتی' },
								]}
							/>
						</Field>
					)}
				</BoardSetup>
			) : (
				<ChessPlay match={match} setMatch={setMatch} />
			)}
		</GameFrame>
	);
}

function ChessPlay({ match, setMatch }: { match: ChessMatch; setMatch: (m: ChessMatch) => void }) {
	const { settings, moves, phase } = match;
	const positions = useMemo(() => replay(moves) ?? [], [moves]);
	const notation = useMemo(() => moves.map((m, i) => san(positions[i], m)), [moves, positions]);
	const pos = positions[positions.length - 1];
	const legal = useMemo(() => (phase === 'play' ? legalMoves(pos) : []), [pos, phase]);
	const colorOfPlayer = (player: number): Color => (player === match.white ? 'w' : 'b');
	const playerOf = (color: Color) => (color === 'w' ? match.white : 1 - match.white);
	const toMove = playerOf(pos.turn);
	const botTurn = phase === 'play' && settings.bot && toMove === 1;
	const [selected, setSelected] = useState<number | null>(null);
	const [promotion, setPromotion] = useState<{ from: number; to: number } | null>(null);
	const [sheet, setSheet] = useState<'menu' | null>(null);

	// the player's own colour at the bottom; two players: fixed for white, or turned to the side to move
	const bottom: Color = settings.bot ? colorOfPlayer(0) : settings.turnBoard ? pos.turn : 'w';
	const flipped = bottom === 'b';

	const finish = (next: ChessMatch, outcome: Outcome) => {
		const winner = 'winner' in outcome ? playerOf(outcome.winner) : null;
		const winners = winner === null ? [] : [winner];
		endSound(winners, settings.bot);
		setMatch({
			...next,
			phase: 'over',
			outcome,
			wins: next.wins.map((w, i) => (i === winner ? w + 1 : w)),
			draws: winner === null ? next.draws + 1 : next.draws,
		});
	};

	const play = (m: Move) => {
		const nextMoves = [...match.moves, m];
		const nextPositions = replay(nextMoves);
		if (!nextPositions) return;
		setSelected(null);
		const next = { ...match, moves: nextMoves, turn: playerOf(nextPositions[nextPositions.length - 1].turn) };
		const outcome = outcomeOf(nextPositions);
		if (outcome) return finish(next, outcome);
		const after = nextPositions[nextPositions.length - 1];
		playSound(inCheck(after) ? 'buzz' : pos.board[m.to] !== '.' ? 'correct' : 'tap');
		setMatch(next);
	};

	useBotTurn(
		botTurn,
		() => {
			const m = botMove(pos, settings.level);
			if (m) play(m);
		},
		650,
	);

	const tap = (sq: number) => {
		if (phase !== 'play' || botTurn) return;
		if (selected !== null) {
			const options = legal.filter((m) => m.from === selected && m.to === sq);
			if (options.length > 1) return setPromotion({ from: selected, to: sq });
			if (options.length === 1) return play(options[0]);
		}
		const piece = pos.board[sq];
		const own = piece !== '.' && (piece === piece.toUpperCase() ? 'w' : 'b') === pos.turn;
		setSelected(own && selected !== sq ? sq : null);
	};

	const undo = () => {
		// against the bot: back to the player's last turn (their move and the bot's answer)
		let back = 1;
		if (settings.bot) back = playerOf(pos.turn) === 0 ? 2 : 1;
		const count = Math.max(0, moves.length - back);
		setSelected(null);
		setMatch({ ...match, moves: moves.slice(0, count), turn: playerOf(positions[count].turn) });
	};

	const targets = new Map<number, boolean>();
	// a capture shows a ring, a quiet move a dot (en passant: a pawn moving sideways is a capture)
	if (selected !== null)
		for (const m of legal) if (m.from === selected) targets.set(m.to, pos.board[m.to] !== '.' || (pos.board[m.from].toLowerCase() === 'p' && (m.to & 7) !== (m.from & 7)));
	const last = moves.length ? moves[moves.length - 1] : null;
	const checked = phase !== 'setup' && inCheck(pos) ? kingSquare(pos.board, pos.turn) : -1;
	const lost = captured(pos.board);
	const names = settings.names;

	let status: string;
	if (phase === 'over' && match.outcome) status = OUTCOME_TEXT[match.outcome.kind];
	else if (botTurn) status = 'ربات داره فکر می‌کنه…';
	else status = `${checked >= 0 ? 'کیش! ' : ''}نوبت ${names[toMove]} (${COLOR_FA[pos.turn]})`;

	const pieces = [0, 1].map((player) => (
		<span key={player} className="ch-bar-piece">
			<Piece kind="k" color={colorOfPlayer(player)} />
		</span>
	));

	const lostRow = (color: Color) => {
		// what `color` has taken: the other side's lost pieces, and the lead in pawns
		const taken = color === 'w' ? lost.b : lost.w;
		const lead = color === 'w' ? lost.balance : -lost.balance;
		return (
			<div className="ch-taken" aria-label={`مهره‌هایی که ${COLOR_FA[color]} زده`}>
				{taken.map((kind, i) => (
					<span key={i} className="ch-taken-piece">
						<Piece kind={kind} color={color === 'w' ? 'b' : 'w'} />
					</span>
				))}
				{lead > 0 && <span className="ch-lead">+{fa(lead)}</span>}
			</div>
		);
	};

	const cells = Array.from({ length: 64 }, (_, i) => (flipped ? 63 - i : i));

	return (
		<div className="bd-play ch-play">
			<PlayersBar names={names} pieces={pieces} current={phase === 'play' ? toMove : null} scores={match.wins} scoreLabel="برد" bot={settings.bot} />
			<p className="bd-status" aria-live="polite">
				{status}
			</p>
			{lostRow(flipped ? 'w' : 'b')}
			<div className={`ch-board${flipped ? ' flipped' : ''}`} role="grid" aria-label="صفحه‌ی شطرنج">
				{cells.map((sq) => {
					const piece = pos.board[sq];
					const dark = ((sq >> 3) + (sq & 7)) % 2 === 1;
					const isTarget = targets.has(sq);
					const classes = [
						'ch-sq',
						dark ? 'dark' : 'light',
						selected === sq ? 'selected' : '',
						last && (last.from === sq || last.to === sq) ? 'last' : '',
						sq === checked ? 'check' : '',
						isTarget ? (targets.get(sq) ? 'capture' : 'target') : '',
					]
						.filter(Boolean)
						.join(' ');
					const col = flipped ? 7 - (sq & 7) : sq & 7;
					const row = flipped ? 7 - (sq >> 3) : sq >> 3;
					return (
						<button
							key={sq}
							type="button"
							className={classes}
							aria-label={`${squareName(sq)}${piece !== '.' ? ` ${pieceName(piece)}` : ''}`}
							disabled={phase !== 'play' || botTurn}
							onClick={() => tap(sq)}
						>
							{col === 0 && <span className="ch-rank">{8 - (sq >> 3)}</span>}
							{row === 7 && <span className="ch-file">{'abcdefgh'[sq & 7]}</span>}
							{piece !== '.' && <Piece kind={piece.toLowerCase()} color={piece === piece.toUpperCase() ? 'w' : 'b'} />}
						</button>
					);
				})}
			</div>
			{lostRow(flipped ? 'b' : 'w')}
			{notation.length > 0 && <MoveList notation={notation} />}
			{phase === 'play' && (
				<div className="ch-tools">
					<button type="button" className="gm-btn gm-btn-ghost" disabled={!moves.length || botTurn} onClick={undo}>
						برگردون
					</button>
					<button type="button" className="gm-btn gm-btn-ghost" disabled={botTurn} onClick={() => setSheet('menu')}>
						{settings.bot ? 'تسلیم' : 'تسلیم یا مساوی'}
					</button>
				</div>
			)}
			{phase === 'over' && (
				<RoundResult
					winners={match.outcome && 'winner' in match.outcome ? [playerOf(match.outcome.winner)] : []}
					names={names}
					bot={settings.bot}
					sub={match.outcome ? `${OUTCOME_TEXT[match.outcome.kind]} · دست ${fa(match.round)}` : undefined}
					onNext={() => setMatch(newRound(match, match.round + 1))}
					onSetup={() => setMatch({ ...match, phase: 'setup' })}
				/>
			)}
			{promotion && (
				<Sheet title="سرباز تبدیل بشه به…" onClose={() => setPromotion(null)}>
					<div className="ch-promo">
						{PROMOTIONS.map((promo: Promo) => (
							<button
								key={promo}
								type="button"
								className="ch-promo-btn"
								aria-label={PIECE_FA[promo]}
								onClick={() => {
									const chosen = legal.find((m) => m.from === promotion.from && m.to === promotion.to && m.promo === promo);
									setPromotion(null);
									if (chosen) play(chosen);
								}}
							>
								<Piece kind={promo} color={pos.turn} />
							</button>
						))}
					</div>
				</Sheet>
			)}
			{sheet === 'menu' && (
				<Sheet
					title={settings.bot ? 'تسلیم می‌شی؟' : `${names[toMove]}، تسلیم یا مساوی؟`}
					onClose={() => setSheet(null)}
					actions={
						<>
							<button
								type="button"
								className="gm-btn gm-btn-danger"
								onClick={() => {
									setSheet(null);
									finish(match, { kind: 'resign', winner: pos.turn === 'w' ? 'b' : 'w' });
								}}
							>
								{settings.bot ? 'آره، تسلیم' : `${names[toMove]} تسلیم می‌شه`}
							</button>
							{!settings.bot && (
								<button
									type="button"
									className="gm-btn gm-btn-ghost"
									onClick={() => {
										setSheet(null);
										finish(match, { kind: 'agreed' });
									}}
								>
									هر دو قبول داریم: مساوی
								</button>
							)}
						</>
					}
				>
					<p className="gm-muted">{settings.bot ? 'دست رو به ربات می‌بازی و دست بعدی شروع می‌شه.' : 'تسلیم یعنی این دست رو حریف می‌بره. مساوی رو هر دو باید قبول داشته باشید.'}</p>
				</Sheet>
			)}
		</div>
	);
}

const PIECE_FA: Record<string, string> = { p: 'سرباز', n: 'اسب', b: 'فیل', r: 'رخ', q: 'وزیر', k: 'شاه' };
/** «اسب سفید», «سرباز سیاه» (board letters: upper case = white). */
const pieceName = (piece: string) => `${PIECE_FA[piece.toLowerCase()]} ${piece === piece.toLowerCase() ? 'سیاه' : 'سفید'}`;

/** The moves so far, numbered, scrolled to the last one. */
function MoveList({ notation }: { notation: string[] }) {
	const pairs: string[][] = [];
	for (let i = 0; i < notation.length; i += 2) pairs.push(notation.slice(i, i + 2));
	return (
		<ol
			className="ch-moves"
			dir="ltr"
			ref={(el) => {
				if (el) el.scrollLeft = el.scrollWidth;
			}}
		>
			{pairs.map((pair, i) => (
				<li key={i} className={i === pairs.length - 1 ? 'now' : ''}>
					<span className="ch-move-no">{i + 1}.</span>
					{pair.join(' ')}
				</li>
			))}
		</ol>
	);
}
