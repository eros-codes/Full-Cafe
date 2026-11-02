import { useEffect, useRef, type ReactNode } from 'react';
import { useLatest } from '../../../shared/useLatest';
import { UI_ICONS } from '../kit/icons';
import { rememberNames } from '../kit/memory';
import { playSound, unlockAudio } from '../kit/sound';
import { Choices, Field, NamesEditor, fa, finalNames, joinNames } from '../kit/ui';

// What the board games (دوز، چهار در یک ردیف، نقطه‌بازی) share: the setup (friends or the bot, its level,
// the names), the bar with the players and their wins, the line under the board, the bot's turn and the
// result of a round. Styles: style/board.css.

export type Level = 'easy' | 'hard';

export interface BoardSettings {
	/** One player against the bot (player 1). */
	bot: boolean;
	level: Level;
	/** The players' names; with the bot: [the player, «ربات»]. */
	names: string[];
}

export const BOT_NAME = 'ربات';
export const playerPlaceholder = (index: number) => `بازیکن ${fa(index + 1)}`;

// ─── Checking a save restored from the phone (see useSavedGame) ──────────────

export const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
export const isInt = (value: unknown): value is number => Number.isInteger(value);
export const isIntArray = (value: unknown, length?: number): value is number[] =>
	Array.isArray(value) && (length === undefined || value.length === length) && value.every(isInt);
/** A board of cells that are null or a player number (0 … players − 1). */
export const isCells = (value: unknown, length: number, players: number): boolean =>
	Array.isArray(value) && value.length === length && value.every((cell) => cell === null || (isInt(cell) && cell >= 0 && cell < players));

/** The shared part of a board game's save: settings with 2–`maxPlayers` names, the phase, the round and the turn. */
export function isBoardMatch(value: unknown, maxPlayers: number): value is Record<string, unknown> & { settings: BoardSettings } {
	if (!isRecord(value) || !isRecord(value.settings)) return false;
	const { bot, level, names } = value.settings;
	if (typeof bot !== 'boolean' || (level !== 'easy' && level !== 'hard')) return false;
	if (!Array.isArray(names) || names.length < 1 || names.length > maxPlayers || !names.every((n) => typeof n === 'string')) return false;
	if (value.phase !== 'setup' && value.phase !== 'play' && value.phase !== 'over') return false;
	// while playing, every player needs a name (the setup screen fills the missing ones in)
	if (value.phase !== 'setup' && names.length < 2) return false;
	return isInt(value.round) && isInt(value.turn) && (value.phase === 'setup' || ((value.turn as number) >= 0 && (value.turn as number) < names.length));
}

/** Who starts round `round` (1, 2, …): everyone in turn. */
export const starterOf = (round: number, players: number) => (round - 1) % players;

export function BoardSetup({
	intro,
	icon,
	settings,
	maxPlayers,
	onChange,
	onStart,
	children,
}: {
	intro: string;
	icon: ReactNode;
	settings: BoardSettings;
	maxPlayers: number;
	onChange: (settings: BoardSettings) => void;
	onStart: (settings: BoardSettings) => void;
	/** Settings of this game (board size, …). */
	children?: ReactNode;
}) {
	const set = (patch: Partial<BoardSettings>) => onChange({ ...settings, ...patch });
	return (
		<div className="gm-setup">
			<div className="gm-intro">
				<span className="gm-intro-icon" aria-hidden="true">
					{icon}
				</span>
				<p>{intro}</p>
			</div>
			<Field label="حریف">
				<Choices
					label="حریف"
					value={settings.bot}
					// back to friends after a game with the bot: its name is not a player's
					onChange={(bot) => set({ bot, names: bot ? settings.names : settings.names.map((n, i) => (i > 0 && n === BOT_NAME ? '' : n)) })}
					options={[
						{ value: false, label: maxPlayers > 2 ? 'با دوستان' : 'دو نفره' },
						{ value: true, label: 'با ربات' },
					]}
				/>
			</Field>
			{settings.bot ? (
				<>
					<Field label="سطح ربات" hint={settings.level === 'easy' ? 'گاهی اشتباه می‌کنه.' : 'جدی بازی می‌کنه؛ بردنش کار راحتی نیست.'}>
						<Choices
							label="سطح ربات"
							value={settings.level}
							onChange={(level) => set({ level })}
							options={[
								{ value: 'easy', label: 'آسون' },
								{ value: 'hard', label: 'سخت' },
							]}
						/>
					</Field>
					<Field label="اسم شما">
						<NamesEditor
							names={settings.names.slice(0, 1)}
							min={1}
							max={1}
							placeholder={playerPlaceholder}
							addLabel=""
							onChange={(names) => set({ names: [names[0] ?? '', ...settings.names.slice(1)] })}
						/>
					</Field>
				</>
			) : (
				<Field label="بازیکن‌ها" hint={maxPlayers > 2 ? `۲ تا ${fa(maxPlayers)} نفر؛ به ترتیب این فهرست بازی می‌کنن.` : undefined}>
					<NamesEditor
						names={settings.names.slice(0, Math.max(2, Math.min(maxPlayers, settings.names.length)))}
						min={2}
						max={maxPlayers}
						placeholder={playerPlaceholder}
						addLabel="بازیکن تازه"
						onChange={(names) => set({ names })}
					/>
				</Field>
			)}
			{children}
			<div className="gm-sticky">
				<button
					type="button"
					className="gm-btn gm-btn-primary gm-btn-big"
					onClick={() => {
						unlockAudio();
						const typed = settings.bot ? settings.names.slice(0, 1) : settings.names.slice(0, Math.max(2, Math.min(maxPlayers, settings.names.length)));
						rememberNames('players', typed);
						const names = finalNames(typed, playerPlaceholder);
						onStart({ ...settings, names: settings.bot ? [names[0], BOT_NAME] : names });
					}}
				>
					شروع بازی
				</button>
			</div>
		</div>
	);
}

/** The players across the top: their piece, name and wins; the one whose turn it is stands out. */
export function PlayersBar({
	names,
	pieces,
	current,
	scores,
	scoreLabel,
	bot,
}: {
	names: readonly string[];
	pieces: readonly ReactNode[];
	current: number | null;
	scores: readonly number[];
	/** «برد» for wins, «خونه» for boxes. */
	scoreLabel: string;
	/** true = player 1 is the bot (the two-player games); a list = which players are bots (منچ). */
	bot: boolean | readonly boolean[];
}) {
	const isBot = (i: number) => (typeof bot === 'boolean' ? bot && i === 1 : Boolean(bot[i]));
	return (
		<ol className={`bd-players bd-players-${names.length}`}>
			{names.map((name, i) => (
				<li key={i} className={`bd-player${current === i ? ' current' : ''}`} aria-current={current === i ? 'true' : undefined}>
					<span className="bd-piece" aria-hidden="true">
						{pieces[i]}
					</span>
					<span className="bd-player-name">
						{isBot(i) && <span className="bd-bot-icon">{UI_ICONS.bot}</span>}
						{name}
					</span>
					<span className="bd-player-score">
						<strong>{fa(scores[i] ?? 0)}</strong> {scoreLabel}
					</span>
				</li>
			))}
		</ol>
	);
}

/** Runs the bot's move after a short pause while it is the bot's turn (a fresh pause after every change). */
export function useBotTurn(active: boolean, move: () => void, delay = 550) {
	const latest = useLatest(move);
	const pending = useRef<number | undefined>(undefined);
	useEffect(() => {
		if (!active) return;
		pending.current = window.setTimeout(() => latest.current(), delay);
		return () => window.clearTimeout(pending.current);
	});
}

export function RoundResult({
	winners,
	names,
	bot,
	sub,
	onNext,
	onSetup,
}: {
	/** Empty = a draw. */
	winners: readonly number[];
	names: readonly string[];
	bot: boolean;
	sub?: string;
	onNext: () => void;
	onSetup: () => void;
}) {
	let title: string;
	if (!winners.length) title = 'مساوی شد!';
	else if (winners.length > 1) title = `${joinNames(winners.map((i) => names[i]))} مساوی شدن!`;
	else if (bot) title = winners[0] === 1 ? 'ربات برد!' : 'بردی!';
	else title = `${names[winners[0]]} برد!`;
	return (
		<div className="bd-result" role="status">
			<p className="bd-result-title">{title}</p>
			{sub && <p className="bd-result-sub">{sub}</p>}
			<div className="bd-result-actions">
				<button
					type="button"
					className="gm-btn gm-btn-primary"
					onClick={() => {
						playSound('tap');
						onNext();
					}}
				>
					یه دست دیگه
				</button>
				<button type="button" className="gm-btn gm-btn-ghost" onClick={onSetup}>
					تنظیمات
				</button>
			</div>
		</div>
	);
}

/** The sound of the end of a round: a win, a draw, or (against the bot) a loss. */
export function endSound(winners: readonly number[], bot: boolean): void {
	if (!winners.length) playSound('reveal');
	else if (bot && winners.includes(1) && winners.length === 1) playSound('pass');
	else playSound('win');
}
