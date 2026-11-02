import { lazy, type ComponentType, type ReactNode } from 'react';
import type { Deck, GameKey } from './data';
import { GAME_ICONS } from './kit/icons';

// The games on the site, as the customer sees them in the list. Which of them are shown, and in what order,
// comes from the server (the admin panel); a game is only listed here once its code exists.

export interface GameProps {
	decks: Deck[];
	onExit: () => void;
}

export interface GameInfo {
	title: string;
	blurb: string;
	players: string;
	icon: ReactNode;
	Component: ComponentType<GameProps>;
}

const SpyGame = lazy(() => import('./spy/SpyGame'));
const WordGame = lazy(() => import('./words/WordGame'));
const TicTacToe = lazy(() => import('./board/TicTacToe'));
const ConnectFour = lazy(() => import('./board/ConnectFour'));
const Dots = lazy(() => import('./board/Dots'));
const MafiaGame = lazy(() => import('./mafia/MafiaGame'));
const LudoGame = lazy(() => import('./ludo/LudoGame'));
const ChessGame = lazy(() => import('./chess/ChessGame'));
const BackgammonGame = lazy(() => import('./backgammon/BackgammonGame'));

export const CATALOG: Record<GameKey, GameInfo> = {
	spy: {
		title: 'جاسوس',
		blurb: 'یکی بینتون جاسوسه؛ با سؤال و جواب پیداش کنید، قبل از اینکه بفهمه کجایید.',
		players: '۳ تا ۱۲ نفر',
		icon: GAME_ICONS.spy,
		Component: (props) => <SpyGame {...props} />,
	},
	heads_up: {
		title: 'گوشی رو پیشونی',
		blurb: 'گوشی رو پیشونیته و کلمه رو نمی‌بینی؛ بقیه توضیح می‌دن، تو حدس می‌زنی.',
		players: '۲ نفر به بالا',
		icon: GAME_ICONS.heads_up,
		Component: (props) => <WordGame mode="heads_up" {...props} />,
	},
	charades: {
		title: 'پانتومیم',
		blurb: 'بدون حرف، فقط با ادا و اشاره؛ تیمت باید حدس بزنه.',
		players: 'دو تیم یا بیشتر',
		icon: GAME_ICONS.charades,
		Component: (props) => <WordGame mode="charades" {...props} />,
	},
	taboo: {
		title: 'کلمات ممنوعه',
		blurb: 'کلمه رو برای تیمت توضیح بده، بدون گفتن کلمه‌های ممنوعِ زیرش.',
		players: 'دو تیم یا بیشتر',
		icon: GAME_ICONS.taboo,
		Component: (props) => <WordGame mode="taboo" {...props} />,
	},
	tic_tac_toe: {
		title: 'دوز',
		blurb: 'سه‌تا در یک ردیف؛ با دوستت یا با ربات.',
		players: '۱ یا ۲ نفر',
		icon: GAME_ICONS.tic_tac_toe,
		Component: ({ onExit }) => <TicTacToe onExit={onExit} />,
	},
	connect_four: {
		title: 'چهار در یک ردیف',
		blurb: 'مهره‌ها رو بنداز و چهارتا پشت هم بچین، قبل از اینکه حریف راهت رو ببنده.',
		players: '۱ یا ۲ نفر',
		icon: GAME_ICONS.connect_four,
		Component: ({ onExit }) => <ConnectFour onExit={onExit} />,
	},
	dots: {
		title: 'نقطه‌بازی',
		blurb: 'خط بکش و خونه ببند؛ ضلع سوم رو دست حریف نده.',
		players: '۱ تا ۴ نفر',
		icon: GAME_ICONS.dots,
		Component: ({ onExit }) => <Dots onExit={onExit} />,
	},
	mafia: {
		title: 'مافیا',
		blurb: 'شب‌ها مافیا شکار می‌کنه، روزها شهر رأی می‌ده؛ گوشی نقش‌ها رو پخش می‌کنه و دست گرداننده می‌مونه.',
		players: '۵ تا ۱۶ نفر + گرداننده',
		icon: GAME_ICONS.mafia,
		Component: ({ onExit }) => <MafiaGame onExit={onExit} />,
	},
	ludo: {
		title: 'منچ',
		blurb: 'تاس بنداز، مهره‌ها رو دور صفحه ببر و مهره‌ی حریف رو بزن؛ با دوستات یا با ربات.',
		players: '۲ تا ۴ نفر',
		icon: GAME_ICONS.ludo,
		Component: ({ onExit }) => <LudoGame onExit={onExit} />,
	},
	chess: {
		title: 'شطرنج',
		blurb: 'شطرنج کامل با همه‌ی قانون‌ها؛ دونفره روی یه گوشی، یا با ربات در دو سطح.',
		players: '۱ یا ۲ نفر',
		icon: GAME_ICONS.chess,
		Component: ({ onExit }) => <ChessGame onExit={onExit} />,
	},
	backgammon: {
		title: 'تخته نرد',
		blurb: 'تاس بریز، مهره‌ها رو به خونه برسون و بیرون ببر؛ با مارس و بدون تاس دوبرابرکن.',
		players: '۱ یا ۲ نفر',
		icon: GAME_ICONS.backgammon,
		Component: ({ onExit }) => <BackgammonGame onExit={onExit} />,
	},
};

export const isKnownGame = (key: string): key is GameKey => Object.hasOwn(CATALOG, key);

/** Loads a game's code ahead (when its card is touched), so it opens without a wait. */
const LOADERS: Record<GameKey, () => Promise<unknown>> = {
	spy: () => import('./spy/SpyGame'),
	heads_up: () => import('./words/WordGame'),
	charades: () => import('./words/WordGame'),
	taboo: () => import('./words/WordGame'),
	tic_tac_toe: () => import('./board/TicTacToe'),
	connect_four: () => import('./board/ConnectFour'),
	dots: () => import('./board/Dots'),
	mafia: () => import('./mafia/MafiaGame'),
	ludo: () => import('./ludo/LudoGame'),
	chess: () => import('./chess/ChessGame'),
	backgammon: () => import('./backgammon/BackgammonGame'),
};

export function preloadGame(key: GameKey): void {
	void LOADERS[key]().catch(() => undefined);
}
