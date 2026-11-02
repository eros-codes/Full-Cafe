import { useMemo } from 'react';
import { GAME_ICONS } from '../kit/icons';
import { rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { playSound } from '../kit/sound';
import { GameFrame, fa } from '../kit/ui';
import { BoardSetup, PlayersBar, RoundResult, endSound, isBoardMatch, isCells, isInt, isIntArray, isRecord, starterOf, useBotTurn, type BoardSettings } from './kit';
import { botMove, emptyBoard, isFull, play, winnerOf, type Mark, type TttBoard } from './tictactoe-rules';

// «دوز»: two players on one phone, or one against the bot. Whoever started the last round plays second in
// the next one. The wins and draws of the evening are counted on the bar.

const VERSION = 1;

interface TttMatch {
	settings: BoardSettings;
	wins: number[];
	draws: number;
	round: number;
	phase: 'setup' | 'play' | 'over';
	board: TttBoard;
	turn: Mark;
	/** The winner and their line; null for a draw (when the phase is over). */
	won: { player: Mark; line: number[] } | null;
}

const RULES = (
	<>
		<p>به نوبت یه خونه رو علامت بزنید. اولین کسی که سه علامتش توی یک ردیف (افقی، عمودی یا مورب) بیفته برنده‌ست.</p>
		<ul>
			<li>اگه همه‌ی خونه‌ها پر بشه و کسی سه‌تا نکرده باشه، مساویه.</li>
			<li>هر دست، اون که دست قبل اول بازی کرده، دوم بازی می‌کنه.</li>
			<li>ربات سخت هیچ‌وقت نمی‌بازه؛ بهترین نتیجه در برابرش مساویه.</li>
		</ul>
	</>
);

export function XMark({ className }: { className?: string }) {
	return (
		<svg className={`ttt-x ${className ?? ''}`} viewBox="0 0 40 40" aria-hidden="true">
			<path d="M10 10l20 20M30 10L10 30" />
		</svg>
	);
}

export function OMark({ className }: { className?: string }) {
	return (
		<svg className={`ttt-o ${className ?? ''}`} viewBox="0 0 40 40" aria-hidden="true">
			<circle cx="20" cy="20" r="11" />
		</svg>
	);
}

/** A save this build can play (anything else starts the game fresh). */
const isTttMatch = (value: unknown): boolean =>
	isBoardMatch(value, 2) &&
	isCells(value.board, 9, 2) &&
	isIntArray(value.wins, 2) &&
	isInt(value.draws) &&
	(value.won === null || (isRecord(value.won) && (value.won.player === 0 || value.won.player === 1) && isIntArray(value.won.line, 3)));

const newRound = (match: TttMatch, round: number): TttMatch => ({
	...match,
	round,
	phase: 'play',
	board: emptyBoard(),
	turn: starterOf(round, 2) as Mark,
	won: null,
});

export default function TicTacToe({ onExit }: { onExit: () => void }) {
	const [match, setMatch] = useSavedGame<TttMatch>(
		'tic_tac_toe',
		VERSION,
		() => ({
			settings: { bot: false, level: 'easy', names: rememberedNames('players', 2, 2) },
			wins: [0, 0],
			draws: 0,
			round: 0,
			phase: 'setup',
			board: emptyBoard(),
			turn: 0,
			won: null,
		}),
		(m) => m.phase !== 'setup',
		{ isValid: isTttMatch },
	);
	const { settings, board, turn, phase } = match;
	const botTurn = phase === 'play' && settings.bot && turn === 1;

	const place = (cell: number, player: Mark) => {
		if (match.phase !== 'play' || match.board[cell] !== null || match.turn !== player) return;
		const next = play(match.board, cell, player);
		const won = winnerOf(next);
		if (won || isFull(next)) {
			const winners = won ? [won.player] : [];
			endSound(winners, settings.bot);
			setMatch({
				...match,
				board: next,
				phase: 'over',
				won,
				wins: match.wins.map((w, i) => (won?.player === i ? w + 1 : w)),
				draws: won ? match.draws : match.draws + 1,
			});
			return;
		}
		playSound('tap');
		setMatch({ ...match, board: next, turn: (1 - player) as Mark });
	};

	useBotTurn(botTurn, () => place(botMove(board, 1, settings.level), 1));

	const pieces = useMemo(() => [<XMark key="x" />, <OMark key="o" />], []);
	const winLine = match.won?.line ?? [];

	return (
		<GameFrame title="دوز" theme="light" live={phase !== 'setup'} onExit={onExit} rules={RULES}>
			{phase === 'setup' ? (
				<BoardSetup
					intro="سه‌تا در یک ردیف؛ ساده، سریع و همیشگی. با دوستت یا با ربات."
					icon={GAME_ICONS.tic_tac_toe}
					settings={settings}
					maxPlayers={2}
					onChange={(s) => setMatch({ ...match, settings: s })}
					onStart={(s) => setMatch(newRound({ ...match, settings: s, wins: [0, 0], draws: 0 }, 1))}
				/>
			) : (
				<div className="bd-play">
					<PlayersBar names={settings.names} pieces={pieces} current={phase === 'play' ? turn : null} scores={match.wins} scoreLabel="برد" bot={settings.bot} />
					<p className="bd-status" aria-live="polite">
						{phase === 'over' ? `دست ${fa(match.round)} · مساوی‌ها: ${fa(match.draws)}` : botTurn ? 'ربات داره فکر می‌کنه…' : `نوبت ${settings.names[turn]}`}
					</p>
					<div className={`ttt-board${phase === 'over' ? ' done' : ''}`} role="grid" aria-label="صفحه‌ی دوز">
						{board.map((cell, i) => (
							<button
								key={i}
								type="button"
								role="gridcell"
								className={`ttt-cell${winLine.includes(i) ? ' win' : ''}`}
								aria-label={`خانه‌ی ${fa(i + 1)}${cell === null ? '، خالی' : cell === 0 ? '، ضربدر' : '، دایره'}`}
								disabled={cell !== null || phase !== 'play' || botTurn}
								onClick={() => place(i, turn)}
							>
								{cell === 0 && <XMark />}
								{cell === 1 && <OMark />}
							</button>
						))}
					</div>
					{phase === 'over' && (
						<RoundResult
							winners={match.won ? [match.won.player] : []}
							names={settings.names}
							bot={settings.bot}
							onNext={() => setMatch(newRound(match, match.round + 1))}
							onSetup={() => setMatch({ ...match, phase: 'setup' })}
						/>
					)}
				</div>
			)}
		</GameFrame>
	);
}
