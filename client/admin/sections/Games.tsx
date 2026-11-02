import { useEffect, useState } from 'react';
import { errorText } from '../../shared/api';
import { ICONS } from '../../shared/icons';
import { adminApi } from '../common/adminApi';
import { MenuModal } from '../common/MenuModal';
import { EmptyState, ErrorNotice, Skeleton, fa, useFlash } from '../common/ui';
import { MenuFlash } from './menu-common';

// The games page (/games) in the admin panel: the switch, which games are shown and in what order, and the
// decks of cards of the word games. Manager only. Server: src/routes/admin/games.routes.ts.

type GameKey = 'spy' | 'heads_up' | 'charades' | 'taboo' | 'tic_tac_toe' | 'connect_four' | 'dots' | 'mafia' | 'ludo' | 'chess' | 'backgammon';
type CardGameKey = 'spy' | 'heads_up' | 'charades' | 'taboo';

interface GameRow {
	key: GameKey;
	name: string;
	isActive: boolean;
	sortOrder: number;
	cards: { min: number; needsForbidden: boolean } | null;
	available: number;
	playable: boolean;
}

interface DeckRow {
	id: number;
	name: string;
	games: CardGameKey[];
	isActive: boolean;
	cardCount: number;
	withForbidden: number;
}

interface Overview {
	enabled: boolean;
	games: GameRow[];
	decks: DeckRow[];
}

const GAME_FA: Record<GameKey, string> = {
	spy: 'جاسوس',
	heads_up: 'گوشی رو پیشونی',
	charades: 'پانتومیم',
	taboo: 'کلمات ممنوعه',
	tic_tac_toe: 'دوز',
	connect_four: 'چهار در یک ردیف',
	dots: 'نقطه‌بازی',
	mafia: 'مافیا',
	ludo: 'منچ',
	chess: 'شطرنج',
	backgammon: 'تخته نرد',
};
/** What a card of a deck is for each word game (only these draw cards). */
const CARD_FA: Record<CardGameKey, string> = { spy: 'مکان', heads_up: 'کلمه', charades: 'کلمه', taboo: 'کارت با کلمه‌ی ممنوع' };
const CARD_GAME_KEYS = Object.keys(CARD_FA) as CardGameKey[];
const DECK_NAME_MAX = 40;

const loadOverview = () => adminApi<Overview>('/api/admin/games');

export function Games({ visit }: { visit: number }) {
	const [data, setData] = useState<Overview | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [editing, setEditing] = useState<DeckRow | 'new' | null>(null);
	const { flash, show } = useFlash();

	useEffect(() => {
		let current = true;
		setData(null);
		setError(null);
		loadOverview()
			.then((overview) => current && setData(overview))
			.catch((err) => current && setError(errorText(err)));
		return () => {
			current = false;
		};
	}, [visit]);

	if (error && !data) return <ErrorNotice message={error} />;
	if (!data) return <Skeleton height={260} />;

	/** One change; the server answers with the whole overview again (counts and order are its own). */
	const run = async (action: () => Promise<Overview | Partial<Overview>>, success: string) => {
		setBusy(true);
		try {
			const result = await action();
			setData((d) => (d ? { ...d, ...result } : d));
			show(success, 'ok');
		} catch (err) {
			show(errorText(err));
			loadOverview().then(setData, () => undefined);
		} finally {
			setBusy(false);
		}
	};

	const setEnabled = (enabled: boolean) =>
		run(async () => {
			// the box changes at once; if saving fails it goes back (the reload in run)
			setData((d) => d && { ...d, enabled });
			await adminApi('/api/admin/settings', { method: 'PATCH', body: { gamesEnabled: enabled } });
			return { enabled };
		}, enabled ? 'بخش بازی‌ها روشن شد.' : 'بخش بازی‌ها خاموش شد.');

	const moveGame = (index: number, delta: -1 | 1) => {
		const target = index + delta;
		if (target < 0 || target >= data.games.length) return;
		const next = data.games.slice();
		[next[index], next[target]] = [next[target], next[index]];
		setData({ ...data, games: next });
		void run(() => adminApi<Overview>('/api/admin/games/order', { method: 'PUT', body: { keys: next.map((g) => g.key) } }), 'ترتیب بازی‌ها ذخیره شد.');
	};

	const toggleGame = (game: GameRow) =>
		run(
			() => adminApi<Overview>(`/api/admin/games/${game.key}`, { method: 'PATCH', body: { isActive: !game.isActive } }),
			game.isActive ? `«${game.name}» از صفحه‌ی بازی‌ها برداشته شد.` : `«${game.name}» به صفحه‌ی بازی‌ها برگشت.`,
		);

	const toggleDeck = (deck: DeckRow) =>
		run(
			() => adminApi<Overview>(`/api/admin/game-decks/${deck.id}`, { method: 'PATCH', body: { isActive: !deck.isActive } }),
			deck.isActive ? `دسته‌ی «${deck.name}» غیرفعال شد.` : `دسته‌ی «${deck.name}» فعال شد.`,
		);

	const removeDeck = (deck: DeckRow) => {
		if (!window.confirm(`دسته‌ی «${deck.name}» با ${fa(deck.cardCount)} کارتش حذف شود؟`)) return;
		void run(() => adminApi<Overview>(`/api/admin/game-decks/${deck.id}`, { method: 'DELETE' }), 'دسته حذف شد.');
	};

	const shown = data.games.filter((g) => g.playable).length;

	return (
		<div id="gamesBox">
			<MenuFlash flash={flash} />
			<div className="settings-block games-switch-block">
				<label className="checkbox-row settings-switch">
					<input id="set-games" type="checkbox" checked={data.enabled} disabled={busy} onChange={(e) => setEnabled(e.target.checked)} />
					<span>نمایش صفحه‌ی «بازی‌ها» در سایت</span>
				</label>
				{data.enabled ? (
					shown > 0 ? (
						<div className="notice ok">{`روشن است: ${fa(shown)} بازی در صفحه‌ی /games دیده می‌شود و لینکش در منوی کناری سایت هست.`}</div>
					) : (
						<div className="notice warn">روشن است، ولی هیچ بازی‌ای قابل نمایش نیست؛ حداقل یک بازی را فعال کن و کارت کافی برایش بگذار.</div>
					)
				) : (
					<p className="hint">خاموش که باشد، صفحه و لینک «بازی‌ها» از سایت برداشته می‌شود. همه‌ی بازی‌ها روی گوشی خود مشتری اجرا می‌شوند و چیزی از آن‌ها ذخیره نمی‌شود.</p>
				)}
			</div>

			<h4 className="games-subhead">بازی‌ها</h4>
			<p className="hint games-hint">ترتیب این فهرست همان ترتیب صفحه‌ی بازی‌هاست. بازی غیرفعال در سایت دیده نمی‌شود.</p>
			<div className="tag-group-list">
				{data.games.map((game, index) => (
					<article key={game.key} className={`tag-group-card game-card${game.isActive ? '' : ' inactive'}`}>
						<div className="tag-group-head">
							<div className="menu-order-btns">
								<button type="button" className="menu-order-btn" aria-label={`«${game.name}» یکی بالاتر`} disabled={busy || index === 0} onClick={() => moveGame(index, -1)}>
									{ICONS.up}
								</button>
								<button
									type="button"
									className="menu-order-btn"
									aria-label={`«${game.name}» یکی پایین‌تر`}
									disabled={busy || index === data.games.length - 1}
									onClick={() => moveGame(index, 1)}
								>
									{ICONS.down}
								</button>
							</div>
							<h4 className="tag-group-name">{game.name}</h4>
							{game.playable ? (
								<span className="status CONFIRMED">در سایت</span>
							) : game.isActive ? (
								<span className="status HOLD">کارت کافی ندارد</span>
							) : (
								<span className="status CANCELLED">غیرفعال</span>
							)}
						</div>
						{game.cards && (
							<p className="tag-group-meta">
								{`${fa(game.available)} ${CARD_FA[game.key as CardGameKey]} از دسته‌های فعال · حداقل لازم: ${fa(game.cards.min)}`}
							</p>
						)}
						<div className="tag-group-actions">
							<button type="button" className="secondary-btn" disabled={busy} onClick={() => toggleGame(game)}>
								{game.isActive ? 'غیرفعال' : 'فعال'}
							</button>
						</div>
					</article>
				))}
			</div>

			<h4 className="games-subhead">دسته‌کارت‌ها</h4>
			<div className="menu-toolbar tag-toolbar">
				<p className="hint">
					کارت‌های بازی‌های کلمه‌ای: مکان‌های «جاسوس»، کلمه‌های «گوشی رو پیشونی» و «پانتومیم»، و کارت‌های «کلمات ممنوعه». هر دسته می‌تواند به چند بازی برسد.
				</p>
				<button type="button" className="primary-btn menu-add-btn" disabled={busy} onClick={() => setEditing('new')}>
					{ICONS.plus}
					<span>دسته‌ی جدید</span>
				</button>
			</div>
			{data.decks.length ? (
				<div className="tag-group-list">
					{data.decks.map((deck) => (
						<article key={deck.id} className={`tag-group-card${deck.isActive ? '' : ' inactive'}`}>
							<div className="tag-group-head">
								<h4 className="tag-group-name">{deck.name}</h4>
								{!deck.isActive && <span className="status CANCELLED">غیرفعال</span>}
							</div>
							<p className="tag-group-meta">
								{`${fa(deck.cardCount)} کارت`}
								{deck.games.includes('taboo') && ` · ${fa(deck.withForbidden)} با کلمه‌ی ممنوع`}
							</p>
							<div className="tag-chips">
								{deck.games.length ? (
									deck.games.map((key) => (
										<span key={key} className="tag-chip static">
											{GAME_FA[key]}
										</span>
									))
								) : (
									<span className="tag-group-warn">به هیچ بازی‌ای وصل نیست.</span>
								)}
							</div>
							{deck.games.includes('taboo') && deck.withForbidden < deck.cardCount && (
								<p className="tag-group-warn">{`${fa(deck.cardCount - deck.withForbidden)} کارت کلمه‌ی ممنوع ندارد و در «کلمات ممنوعه» نمی‌آید.`}</p>
							)}
							<div className="tag-group-actions">
								<button type="button" className="secondary-btn" disabled={busy} onClick={() => setEditing(deck)}>
									ویرایش کارت‌ها
								</button>
								<button type="button" className="secondary-btn" disabled={busy} onClick={() => toggleDeck(deck)}>
									{deck.isActive ? 'غیرفعال' : 'فعال'}
								</button>
								<button type="button" className="danger-btn" disabled={busy} onClick={() => removeDeck(deck)}>
									حذف
								</button>
							</div>
						</article>
					))}
				</div>
			) : (
				<EmptyState title="هنوز دسته‌ای نیست" text="با «دسته‌ی جدید» اولین دسته را بساز، یا با npm run db:seed دسته‌های آماده را اضافه کن." />
			)}
			{editing && (
				<DeckForm
					deck={editing === 'new' ? null : editing}
					onClose={() => setEditing(null)}
					onSaved={(overview, message) => {
						setData((d) => (d ? { ...d, ...overview } : d));
						show(message, 'ok');
					}}
				/>
			)}
		</div>
	);
}

// ─── Deck editor ──────────────────────────────────────────────────────────────

function countLines(text: string): number {
	return text.split(/\r?\n/).filter((line) => line.trim()).length;
}

function DeckForm({ deck, onClose, onSaved }: { deck: DeckRow | null; onClose: () => void; onSaved: (overview: Overview, message: string) => void }) {
	const [name, setName] = useState(deck?.name ?? '');
	const [games, setGames] = useState<CardGameKey[]>(deck?.games ?? []);
	const [isActive, setIsActive] = useState(deck?.isActive ?? true);
	const [cards, setCards] = useState<string | null>(deck ? null : '');
	const [loadError, setLoadError] = useState<string | null>(null);

	useEffect(() => {
		if (!deck) return;
		let current = true;
		adminApi<{ cards: string }>(`/api/admin/game-decks/${deck.id}`)
			.then((res) => current && setCards(res.cards))
			.catch((err) => current && setLoadError(errorText(err)));
		return () => {
			current = false;
		};
	}, [deck]);

	const submit = async () => {
		if (!name.trim()) throw new Error('نام دسته الزامی است.');
		if (cards === null) throw new Error('کارت‌ها هنوز بارگذاری نشده‌اند.');
		if (!games.length) throw new Error('حداقل یک بازی برای این دسته انتخاب کن.');
		const body = { name: name.trim(), games, isActive, cards };
		const result = await adminApi<Overview & { duplicates: number }>(deck ? `/api/admin/game-decks/${deck.id}` : '/api/admin/game-decks', {
			method: deck ? 'PATCH' : 'POST',
			body,
		});
		const dup = result.duplicates ? ` (${fa(result.duplicates)} کارت تکراری کنار گذاشته شد)` : '';
		onSaved(result, `${deck ? 'دسته ذخیره شد' : 'دسته ساخته شد'}${dup}.`);
	};

	const taboo = games.includes('taboo');
	return (
		<MenuModal title={deck ? `ویرایش «${deck.name}»` : 'دسته‌ی جدید'} onClose={onClose} onSubmit={submit}>
			<div className="field">
				<label htmlFor="deck-name">نام دسته</label>
				<input id="deck-name" value={name} maxLength={DECK_NAME_MAX} onChange={(e) => setName(e.target.value)} placeholder="مثلاً: حیوانات" />
			</div>
			<fieldset className="field">
				<legend>کدام بازی‌ها از این دسته کارت بکشند؟</legend>
				<div className="game-picks">
					{CARD_GAME_KEYS.map((key) => (
						<label key={key} className="checkbox-row">
							<input
								type="checkbox"
								checked={games.includes(key)}
								onChange={(e) => setGames((list) => (e.target.checked ? CARD_GAME_KEYS.filter((k) => k === key || list.includes(k)) : list.filter((k) => k !== key)))}
							/>
							<span>{GAME_FA[key]}</span>
						</label>
					))}
				</div>
			</fieldset>
			<div className="field">
				<label htmlFor="deck-cards">{cards === null ? 'کارت‌ها' : `کارت‌ها (${fa(countLines(cards))})`}</label>
				{loadError ? (
					<div className="notice danger">{loadError}</div>
				) : cards === null ? (
					<Skeleton height={180} />
				) : (
					<textarea
						id="deck-cards"
						className="game-cards-text"
						rows={14}
						dir="rtl"
						spellCheck={false}
						value={cards}
						onChange={(e) => setCards(e.target.value)}
						placeholder={taboo ? 'هر خط یک کارت، مثلاً:\nقهوه: فنجان، کافئین، تلخ، اسپرسو، صبح' : 'هر خط یک کارت، مثلاً:\nفرودگاه'}
					/>
				)}
				<p className="hint game-cards-hint">
					هر خط یک کارت. برای «کلمات ممنوعه» بعد از کلمه «:» بگذار و کلمه‌های ممنوع را با «،» جدا کن (تا ۸ کلمه). خط تکراری خودش حذف می‌شود.
				</p>
			</div>
			<label className="checkbox-row">
				<input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
				<span>فعال (کارت‌هایش در بازی‌ها می‌آید)</span>
			</label>
		</MenuModal>
	);
}
