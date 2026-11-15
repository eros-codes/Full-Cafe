import { useMemo, useState } from 'react';
import { GAME_ICONS } from '../kit/icons';
import { rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { playSound } from '../kit/sound';
import { GameFrame, fa } from '../kit/ui';
import {
	BoardSetup,
	PlayersBar,
	RoundResult,
	endSound,
	isBoardMatch,
	isInt,
	isIntArray,
	starterOf,
	useBotTurn,
	type BoardSettings,
} from './kit';
import {
	DRAW_PLIES,
	SIZE,
	applyMove,
	botMove,
	countPieces,
	isDark,
	isKing,
	isProgress,
	legalMoves,
	ownerOf,
	startBoard,
	winnerOf,
	type Cell,
	type CheckersBoard,
	type Move,
	type Side,
} from './checkers-rules';

// «چکرز»: tap a piece, then the square it goes to (for a chain of captures, each landing square in turn).
// Two players on one phone, or one against the bot. Player 0 plays from the bottom; the starter changes every round.

const VERSION = 1;

interface CheckersMatch {
	settings: BoardSettings;
	wins: number[];
	draws: number;
	round: number;
	phase: 'setup' | 'play' | 'over';
	board: CheckersBoard;
	turn: Side;
	/** Moves in a row without a capture or a man's move (a draw at DRAW_PLIES). */
	quiet: number;
	/** The squares of the last move (start and landings), marked on the board. */
	last: number[];
	winner: Side | null;
}

const RULES = (
	<>
		<p>مهره‌ها فقط روی خونه‌های تیره و به‌صورت مورب حرکت می‌کنن.</p>
		<ul>
			<li>مهره‌ی معمولی یک خونه رو به جلو می‌ره.</li>
			<li>اگه مهره‌ی حریف کنارته و خونه‌ی پشتش خالیه، از روش می‌پری و می‌زنیش.</li>
			<li>زدن اجباریه؛ اگه بعد از زدن باز هم می‌شه زد، همون مهره باید ادامه بده.</li>
			<li>مهره‌ای که به ردیف آخر برسه «شاه» می‌شه و به عقب هم می‌تونه بره و بزنه.</li>
			<li>کسی که مهره‌ای براش نمونه یا نتونه حرکت کنه، می‌بازه.</li>
			<li>اگه هر دو طرف {fa(DRAW_PLIES / 2)} حرکت پشت هم بدون زدن و فقط با شاه بازی کنن، مساویه.</li>
		</ul>
	</>
);

const isBoard = (value: unknown): boolean =>
	Array.isArray(value) &&
	value.length === SIZE * SIZE &&
	value.every((cell, index) => cell === null || (isInt(cell) && cell >= 0 && cell <= 3 && isDark(index)));

/** A save this build can play (anything else starts the game fresh). */
const isCheckersMatch = (value: unknown): boolean =>
	isBoardMatch(value, 2) &&
	isBoard(value.board) &&
	isIntArray(value.wins, 2) &&
	isInt(value.draws) &&
	isInt(value.quiet) &&
	isIntArray(value.last) &&
	(value.winner === null || value.winner === 0 || value.winner === 1);

const newRound = (match: CheckersMatch, round: number): CheckersMatch => ({
	...match,
	round,
	phase: 'play',
	board: startBoard(),
	turn: starterOf(round, 2) as Side,
	quiet: 0,
	last: [],
	winner: null,
});

const startsWith = (path: readonly number[], prefix: readonly number[]) => prefix.every((square, i) => path[i] === square);

function Piece({ cell }: { cell: Cell }) {
	if (cell === null) return null;
	return (
		<span className={`ck-piece ck-p${ownerOf(cell)}${isKing(cell) ? ' king' : ''}`}>
			{isKing(cell) && (
				<svg viewBox="0 0 24 24" aria-hidden="true">
					<path d="M5 17.5h14l1.2-8.6-4.6 3.4L12 6.5l-3.6 5.8-4.6-3.4z" />
				</svg>
			)}
		</span>
	);
}

export default function Checkers({ onExit }: { onExit: () => void }) {
	const [match, setMatch] = useSavedGame<CheckersMatch>(
		'checkers',
		VERSION,
		() => ({
			settings: { bot: false, level: 'easy', names: rememberedNames('players', 2, 2) },
			wins: [0, 0],
			draws: 0,
			round: 0,
			phase: 'setup',
			board: startBoard(),
			turn: 0,
			quiet: 0,
			last: [],
			winner: null,
		}),
		(m) => m.phase !== 'setup',
		{ isValid: isCheckersMatch },
	);
	const { settings, board, turn, phase } = match;
	const botTurn = phase === 'play' && settings.bot && turn === 1;
	/** The piece picked up and the landing squares tapped so far (a chain of captures is tapped square by square). */
	const [picked, setPicked] = useState<{ from: number; path: number[] } | null>(null);

	const moves = useMemo(() => (phase === 'play' ? legalMoves(board, turn) : []), [board, turn, phase]);
	const mustCapture = moves.length > 0 && moves[0].captured.length > 0;
	const candidates = picked ? moves.filter((m) => m.from === picked.from && startsWith(m.path, picked.path)) : [];
	const targets = new Set(candidates.map((m) => m.path[picked!.path.length]));
	const movable = new Set(moves.map((m) => m.from));
	// in the middle of a chain of captures the board shows the jumps made so far
	const shown = picked && picked.path.length && candidates.length ? applyMove(board, candidates[0], picked.path.length) : board;
	const at = picked ? (picked.path.at(-1) ?? picked.from) : null;

	const play = (move: Move) => {
		if (match.phase !== 'play') return;
		const next = applyMove(match.board, move);
		const other = (1 - match.turn) as Side;
		const quiet = isProgress(match.board, move) ? 0 : match.quiet + 1;
		const winner = winnerOf(next, other);
		const last = [move.from, ...move.path];
		setPicked(null);
		if (winner !== null || quiet >= DRAW_PLIES) {
			endSound(winner === null ? [] : [winner], settings.bot);
			setMatch({
				...match,
				board: next,
				last,
				quiet,
				phase: 'over',
				winner,
				wins: match.wins.map((w, i) => (i === winner ? w + 1 : w)),
				draws: winner === null ? match.draws + 1 : match.draws,
			});
			return;
		}
		playSound(move.captured.length ? 'reveal' : 'tap');
		setMatch({ ...match, board: next, last, quiet, turn: other });
	};

	const tap = (index: number) => {
		if (phase !== 'play' || botTurn) return;
		if (picked && targets.has(index)) {
			const path = [...picked.path, index];
			const done = candidates.find((m) => m.path.length === path.length && startsWith(m.path, path));
			if (done) play(done);
			else {
				playSound('tap');
				setPicked({ from: picked.from, path });
			}
			return;
		}
		// another piece can be picked until the first jump is made
		if (movable.has(index) && !(picked && picked.path.length)) setPicked(picked?.from === index ? null : { from: index, path: [] });
		else if (picked && !picked.path.length) setPicked(null);
	};

	useBotTurn(
		botTurn,
		() => {
			const move = botMove(board, 1, settings.level);
			if (move) play(move);
		},
		700,
	);

	const pieces = useMemo(() => [<span key="0" className="ck-piece ck-p0" />, <span key="1" className="ck-piece ck-p1" />], []);
	const status =
		phase === 'over'
			? `دست ${fa(match.round)} · مساوی‌ها: ${fa(match.draws)}`
			: botTurn
				? 'ربات داره فکر می‌کنه…'
				: picked?.path.length
					? 'ادامه بده؛ باید باز هم بزنی.'
					: `نوبت ${settings.names[turn]}${mustCapture ? ' · باید بزنی' : ''}`;

	return (
		<GameFrame title="چکرز" theme="light" live={phase !== 'setup'} onExit={onExit} rules={RULES}>
			{phase === 'setup' ? (
				<BoardSetup
					intro="مورب برو جلو، از روی مهره‌ی حریف بپر و بزنش؛ به ردیف آخر برسی شاه می‌شی."
					icon={GAME_ICONS.checkers}
					settings={settings}
					maxPlayers={2}
					onChange={(s) => setMatch({ ...match, settings: s })}
					onStart={(s) => {
						setPicked(null);
						setMatch(newRound({ ...match, settings: s, wins: [0, 0], draws: 0 }, 1));
					}}
				/>
			) : (
				<div className="bd-play">
					<PlayersBar
						names={settings.names}
						pieces={pieces}
						current={phase === 'play' ? turn : null}
						scores={match.wins}
						scoreLabel="برد"
						bot={settings.bot}
					/>
					<p className="bd-status" aria-live="polite">
						{status}
					</p>
					<p className="ck-count">{`${settings.names[1]}: ${fa(countPieces(shown, 1))} مهره · ${settings.names[0]}: ${fa(countPieces(shown, 0))} مهره`}</p>
					<div className="ck-board" role="group" aria-label="صفحه‌ی چکرز">
						{shown.map((cell, index) => {
							if (!isDark(index)) return <span key={index} className="ck-sq light" />;
							const owner = ownerOf(cell);
							const target = targets.has(index);
							const canPick = phase === 'play' && !botTurn && movable.has(index) && !picked?.path.length;
							const label = `ردیف ${fa((index >> 3) + 1)} ستون ${fa((index & 7) + 1)}${
								owner === null ? '، خالی' : `، ${isKing(cell) ? 'شاه' : 'مهره'}‌ی ${settings.names[owner]}`
							}${target ? '، می‌تونی بیای اینجا' : ''}`;
							return (
								<button
									key={index}
									type="button"
									className={`ck-sq dark${index === at ? ' selected' : ''}${target ? ' target' : ''}${canPick && !picked ? ' movable' : ''}${
										match.last.includes(index) ? ' last' : ''
									}`}
									aria-label={label}
									aria-pressed={index === at || undefined}
									disabled={!(target || canPick)}
									onClick={() => tap(index)}
								>
									<Piece cell={cell} />
								</button>
							);
						})}
					</div>
					{phase === 'over' && (
						<RoundResult
							winners={match.winner === null ? [] : [match.winner]}
							names={settings.names}
							bot={settings.bot}
							sub={match.winner === null ? `${fa(DRAW_PLIES / 2)} حرکت بدون زدن؛ کسی جلو نیفتاد.` : undefined}
							onNext={() => {
								setPicked(null);
								setMatch(newRound(match, match.round + 1));
							}}
							onSetup={() => setMatch({ ...match, phase: 'setup' })}
						/>
					)}
				</div>
			)}
		</GameFrame>
	);
}
