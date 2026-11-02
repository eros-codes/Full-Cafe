import { useMemo, type CSSProperties } from 'react';
import { GAME_ICONS } from '../kit/icons';
import { rememberedNames } from '../kit/memory';
import { useSavedGame } from '../kit/persist';
import { playSound } from '../kit/sound';
import { GameFrame, fa } from '../kit/ui';
import { BoardSetup, PlayersBar, RoundResult, endSound, isBoardMatch, isCells, isInt, isIntArray, starterOf, useBotTurn, type BoardSettings } from './kit';
import { COLS, ROWS, botColumn, drop, emptyC4, isBoardFull, landingRow, winLineAt, type C4Board, type Disc } from './connect4';

// «چهار در یک ردیف»: tap a column and the disc falls to its lowest free cell. Two players on one phone, or one
// against the bot. The starter changes every round.

const VERSION = 1;

interface C4Match {
	settings: BoardSettings;
	wins: number[];
	draws: number;
	round: number;
	phase: 'setup' | 'play' | 'over';
	board: C4Board;
	turn: Disc;
	/** The disc just dropped (it falls in with an animation). */
	last: number | null;
	winner: Disc | null;
	line: number[];
}

const RULES = (
	<>
		<p>به نوبت یه ستون رو انتخاب کنید؛ مهره تا پایین‌ترین خونه‌ی خالیِ اون ستون می‌افته.</p>
		<ul>
			<li>اولین کسی که چهار مهره‌اش پشت هم بیفته (افقی، عمودی یا مورب) برنده‌ست.</li>
			<li>اگه صفحه پر بشه و کسی چهارتا نکرده باشه، مساویه.</li>
			<li>هر دست، شروع‌کننده عوض می‌شه.</li>
		</ul>
	</>
);

/** A save this build can play (anything else starts the game fresh). */
const isC4Match = (value: unknown): boolean =>
	isBoardMatch(value, 2) &&
	isCells(value.board, COLS * ROWS, 2) &&
	isIntArray(value.wins, 2) &&
	isInt(value.draws) &&
	(value.last === null || isInt(value.last)) &&
	(value.winner === null || value.winner === 0 || value.winner === 1) &&
	isIntArray(value.line);

const newRound = (match: C4Match, round: number): C4Match => ({
	...match,
	round,
	phase: 'play',
	board: emptyC4(),
	turn: starterOf(round, 2) as Disc,
	last: null,
	winner: null,
	line: [],
});

export default function ConnectFour({ onExit }: { onExit: () => void }) {
	const [match, setMatch] = useSavedGame<C4Match>(
		'connect_four',
		VERSION,
		() => ({
			settings: { bot: false, level: 'easy', names: rememberedNames('players', 2, 2) },
			wins: [0, 0],
			draws: 0,
			round: 0,
			phase: 'setup',
			board: emptyC4(),
			turn: 0,
			last: null,
			winner: null,
			line: [],
		}),
		(m) => m.phase !== 'setup',
		{ isValid: isC4Match },
	);
	const { settings, board, turn, phase } = match;
	const botTurn = phase === 'play' && settings.bot && turn === 1;

	const dropIn = (col: number, player: Disc) => {
		if (match.phase !== 'play' || match.turn !== player) return;
		const step = drop(match.board, col, player);
		if (!step) return;
		const line = winLineAt(step.board, step.index);
		if (line || isBoardFull(step.board)) {
			const winners = line ? [player] : [];
			endSound(winners, settings.bot);
			setMatch({
				...match,
				board: step.board,
				last: step.index,
				phase: 'over',
				winner: line ? player : null,
				line: line ?? [],
				wins: match.wins.map((w, i) => (line && i === player ? w + 1 : w)),
				draws: line ? match.draws : match.draws + 1,
			});
			return;
		}
		playSound('tap');
		setMatch({ ...match, board: step.board, last: step.index, turn: (1 - player) as Disc });
	};

	useBotTurn(botTurn, () => dropIn(botColumn(board, 1, settings.level), 1), 650);

	const pieces = useMemo(() => [<span key="0" className="c4-disc c4-p0" />, <span key="1" className="c4-disc c4-p1" />], []);

	return (
		<GameFrame title="چهار در یک ردیف" theme="light" live={phase !== 'setup'} onExit={onExit} rules={RULES}>
			{phase === 'setup' ? (
				<BoardSetup
					intro="مهره‌ها رو از بالا بنداز و چهارتا پشت هم بچین، قبل از اینکه حریف راهت رو ببنده."
					icon={GAME_ICONS.connect_four}
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
					<div className="c4-board" role="group" aria-label="صفحه‌ی چهار در یک ردیف">
						{Array.from({ length: COLS }, (_, col) => {
							const full = landingRow(board, col) < 0;
							return (
								<button
									key={col}
									type="button"
									className="c4-col"
									aria-label={`ستون ${fa(col + 1)}${full ? '، پر' : ''}`}
									disabled={full || phase !== 'play' || botTurn}
									onClick={() => dropIn(col, turn)}
								>
									{Array.from({ length: ROWS }, (_, row) => {
										const index = row * COLS + col;
										const disc = board[index];
										return (
											<span key={row} className={`c4-cell${match.line.includes(index) ? ' win' : ''}`}>
												{disc !== null && (
													<span
														className={`c4-disc c4-p${disc}${index === match.last ? ' falling' : ''}`}
														style={index === match.last ? ({ '--fall': row + 1 } as CSSProperties) : undefined}
													/>
												)}
											</span>
										);
									})}
								</button>
							);
						})}
					</div>
					{phase === 'over' && (
						<RoundResult
							winners={match.winner === null ? [] : [match.winner]}
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
