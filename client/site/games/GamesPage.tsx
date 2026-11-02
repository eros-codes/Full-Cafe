import { Component, Suspense, useCallback, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { errorText } from '../../shared/api';
import { HamburgerButton, MobileDrawer, SiteFooter, useDrawer } from '../../shared/chrome/SiteChrome';
import { CATALOG, isKnownGame, preloadGame } from './catalog';
import { loadGames, type GameKey, type GamesData } from './data';
import { clearSave, hasLiveSave } from './kit/persist';
import { exitFullscreen } from './kit/screen';
import { installAudioUnlock } from './kit/sound';

// /games: the list of games, and the game being played. A game opens in place (its address gets #spy,
// #heads_up, …), so the phone's back button returns to the list and a reload stays in the game.

type Load = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; data: GamesData; offline: boolean };

/**
 * If a game crashes (most often: a save left on the phone by an older version of the game), React would
 * unmount the whole page and leave it blank, again on every visit while the save is there. Instead the
 * game's save is dropped and the game can start over from its setup screen.
 */
class GameBoundary extends Component<{ game: GameKey; onLeave: () => void; children: ReactNode }, { failed: boolean; attempt: number }> {
	state = { failed: false, attempt: 0 };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: unknown, info: ErrorInfo) {
		console.error(`بازی «${this.props.game}» خطا داد؛ بازی ذخیره‌شده‌اش پاک شد.`, error, info.componentStack);
		clearSave(this.props.game);
	}

	render() {
		if (!this.state.failed) return <div key={this.state.attempt} style={{ display: 'contents' }}>{this.props.children}</div>;
		return (
			<div className="gm-frame gm-light">
				<div className="gm-empty" role="alert">
					<p>این بازی درست باز نشد. دوباره امتحان کن یا برگرد به فهرست بازی‌ها.</p>
					<button type="button" className="gm-btn gm-btn-primary" onClick={() => this.setState((s) => ({ failed: false, attempt: s.attempt + 1 }))}>
						شروع دوباره
					</button>
					<button type="button" className="gm-btn gm-btn-ghost" onClick={this.props.onLeave}>
						برگشت به فهرست بازی‌ها
					</button>
				</div>
			</div>
		);
	}
}

const gameFromHash = (): GameKey | null => {
	const key = decodeURIComponent(window.location.hash.slice(1));
	return isKnownGame(key) ? key : null;
};

export function GamesPage() {
	const drawer = useDrawer();
	const [load, setLoad] = useState<Load>({ state: 'loading' });
	const [game, setGame] = useState<GameKey | null>(gameFromHash);
	const gameRef = useRef(game);
	gameRef.current = game;

	const fetchData = useCallback(() => {
		setLoad({ state: 'loading' });
		loadGames().then(
			({ data, offline }) => setLoad({ state: 'ready', data, offline }),
			(error) => setLoad({ state: 'error', message: errorText(error, 'بازی‌ها بارگذاری نشد.') }),
		);
	}, []);

	useEffect(() => installAudioUnlock(), []);

	useEffect(() => {
		fetchData();
		// the phone's back button out of a game is a full exit too, like ✕: nothing of the game is kept
		const onPop = () => {
			const next = gameFromHash();
			const left = gameRef.current;
			if (left && left !== next) {
				exitFullscreen();
				clearSave(left);
			}
			setGame(next);
		};
		window.addEventListener('popstate', onPop);
		return () => window.removeEventListener('popstate', onPop);
	}, [fetchData]);

	const available: GameKey[] = load.state === 'ready' && load.data.enabled ? load.data.games.filter(isKnownGame) : [];
	const playing = game && available.includes(game) ? game : null;

	useEffect(() => {
		document.body.classList.toggle('gm-playing', Boolean(playing));
		window.scrollTo(0, 0);
	}, [playing]);

	const open = (key: GameKey) => {
		window.history.pushState({ game: key }, '', `#${key}`);
		setGame(key);
	};

	/** Leaving a game (✕) always ends it: its save is dropped. */
	const exit = (key: GameKey) => {
		exitFullscreen();
		// a game only saves itself when its state changes, so the save can go before it leaves the screen
		clearSave(key);
		gameRef.current = null;
		if (window.history.state?.game === key) window.history.back();
		else window.history.replaceState(null, '', window.location.pathname);
		setGame(null);
	};

	if (playing && load.state === 'ready' && load.data.enabled) {
		const { Component } = CATALOG[playing];
		return (
			<GameBoundary key={playing} game={playing} onLeave={() => exit(playing)}>
				<Suspense fallback={<div className="gm-frame gm-light gm-loading" aria-busy="true" />}>
					<Component key={playing} decks={load.data.decks} onExit={() => exit(playing)} />
				</Suspense>
			</GameBoundary>
		);
	}

	return (
		<>
			<div className="gm-page">
				<header className="menu-header">
					<div className="menu-header-top">
						<div className="menu-header-right">
							<HamburgerButton drawer={drawer} />
							<a className="menu-logo" href="/" aria-label="صفحه‌ی اصلی">
								<img src="/images/Logo-2.PNG" alt="روف" />
							</a>
						</div>
					</div>
				</header>
				<main className="gm-hub">
					<section className="gm-hero">
						<h1>بازی‌ها</h1>
						<p>تا سفارشتون برسه، یه دست بازی کنید. همه‌ی بازی‌ها با یه گوشی، دور یه میز.</p>
					</section>
					{load.state === 'loading' && (
						<ul className="gm-games" aria-busy="true" aria-label="در حال بارگذاری">
							{[0, 1, 2, 3].map((i) => (
								<li key={i} className="gm-game-skeleton" />
							))}
						</ul>
					)}
					{load.state === 'error' && (
						<div className="gm-empty">
							<p>{load.message}</p>
							<button type="button" className="gm-btn gm-btn-primary" onClick={fetchData}>
								دوباره امتحان کن
							</button>
						</div>
					)}
					{load.state === 'ready' && load.offline && <p className="gm-offline">اینترنت در دسترس نیست؛ آخرین نسخه‌ی بازی‌ها روی همین گوشی باز شد.</p>}
					{load.state === 'ready' && available.length === 0 && (
						<div className="gm-empty">
							<p>{load.data.enabled ? 'فعلاً بازی‌ای برای نمایش نیست.' : 'بخش بازی‌ها فعلاً فعال نیست.'}</p>
							<a className="gm-btn gm-btn-primary" href="/menu">
								برگشت به منو
							</a>
						</div>
					)}
					{available.length > 0 && (
						<ul className="gm-games">
							{available.map((key, index) => {
								const info = CATALOG[key];
								const saved = hasLiveSave(key);
								return (
									<li key={key} style={{ animationDelay: `${index * 60}ms` }}>
										<button type="button" className="gm-game-card" onClick={() => open(key)} onPointerDown={() => preloadGame(key)}>
											<span className="gm-game-icon" aria-hidden="true">
												{info.icon}
											</span>
											<span className="gm-game-text">
												<strong>{info.title}</strong>
												<span>{info.blurb}</span>
												<small>{info.players}</small>
											</span>
											{saved && <span className="gm-badge">ادامه‌ی بازی</span>}
										</button>
									</li>
								);
							})}
						</ul>
					)}
				</main>
			</div>
			<SiteFooter links={['about', 'menu', 'reserve', 'feedback']} />
			<MobileDrawer drawer={drawer} links={['menu', 'about', 'contact', 'feedback', 'reserve']} />
		</>
	);
}
