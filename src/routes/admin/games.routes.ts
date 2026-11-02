import express from 'express';
import { prisma } from '../../lib/prisma.js';
import { prismaCode } from '../../lib/http-error.js';
import { requireRole } from '../../middleware/auth.js';
import { ROLE_GROUPS } from '../../lib/roles.js';
import { cardLine, parseCardLines, replaceDeckCards, type CardParseResult } from '../../services/game-cards.js';
import { CARD_GAME_KEYS, GAMES, GAME_KEYS, isCardGameKey, isGameKey, type GameKey } from '../../services/game-catalog.js';
import { getAdminGames, invalidateGamesCache } from '../../services/games.service.js';

// The games page in the admin panel: which games are shown and in what order, and the decks of the word
// games. What the customers see on the games page is a manager decision. Mounted inside adminRouter.
export const adminGamesRouter = express.Router();
adminGamesRouter.use(['/games', '/game-decks'], requireRole(...ROLE_GROUPS.manager));
adminGamesRouter.use(['/games', '/game-decks'], (req, res, next) => {
	if (req.method !== 'GET') {
		res.on('finish', () => {
			if (res.statusCode < 400) invalidateGamesCache();
		});
	}
	next();
});

const DECK_NAME_MAX = 40;
const fa = (n: number) => n.toLocaleString('fa-IR', { useGrouping: false });

type InputResult<T> = { ok: true; data: T } | { ok: false; error: string };

function parseId(value: unknown): number | null {
	const id = Number(value);
	return Number.isInteger(id) && id > 0 ? id : null;
}

adminGamesRouter.get('/games', async (_req, res, next) => {
	try {
		res.json(await getAdminGames());
	} catch (error) {
		next(error);
	}
});

adminGamesRouter.patch('/games/:key', async (req, res, next) => {
	try {
		const { key } = req.params;
		if (!isGameKey(key)) return res.status(404).json({ message: 'این بازی پیدا نشد.' });
		const isActive = req.body?.isActive;
		if (typeof isActive !== 'boolean') return res.status(400).json({ message: 'مقدار روشن/خاموش نامعتبر است.' });
		const order = GAME_KEYS.indexOf(key);
		await prisma.gameSetting.upsert({ where: { key }, update: { isActive }, create: { key, isActive, sortOrder: order } });
		res.json(await getAdminGames());
	} catch (error) {
		next(error);
	}
});

/** The whole order of the games page at once: `keys` = every game, first to last. */
adminGamesRouter.put('/games/order', async (req, res, next) => {
	try {
		const keys: unknown = req.body?.keys;
		if (!Array.isArray(keys) || keys.length !== GAME_KEYS.length || !keys.every(isGameKey) || new Set(keys).size !== keys.length) {
			return res.status(400).json({ message: 'ترتیب بازی‌ها نامعتبر است.' });
		}
		await prisma.$transaction(
			// a game never switched yet keeps its default (تخته نرد starts off)
			(keys as GameKey[]).map((key, sortOrder) =>
				prisma.gameSetting.upsert({ where: { key }, update: { sortOrder }, create: { key, sortOrder, isActive: GAMES.find((g) => g.key === key)!.defaultActive } }),
			),
		);
		res.json(await getAdminGames());
	} catch (error) {
		next(error);
	}
});

// ─── Decks ───────────────────────────────────────────────────────────────────

interface DeckFields {
	name: string;
	games: GameKey[];
	isActive: boolean;
}

function readDeckInput(body: unknown, partial: boolean): InputResult<Partial<DeckFields>> {
	const b = (body ?? {}) as Record<string, unknown>;
	const data: Partial<DeckFields> = {};
	if (b.name !== undefined || !partial) {
		if (typeof b.name !== 'string' || !b.name.trim()) return { ok: false, error: 'نام دسته الزامی است.' };
		if (b.name.trim().length > DECK_NAME_MAX) return { ok: false, error: `نام دسته حداکثر ${DECK_NAME_MAX} حرف است.` };
		data.name = b.name.trim();
	}
	if (b.games !== undefined || !partial) {
		// only the word games draw cards
		if (!Array.isArray(b.games) || !b.games.every(isCardGameKey)) return { ok: false, error: 'بازی‌های این دسته نامعتبرند.' };
		data.games = CARD_GAME_KEYS.filter((key) => (b.games as string[]).includes(key));
		// a deck no game draws from would just sit there unused
		if (!data.games.length) return { ok: false, error: 'حداقل یک بازی برای این دسته انتخاب کن.' };
	}
	if (b.isActive !== undefined) {
		if (typeof b.isActive !== 'boolean') return { ok: false, error: 'مقدار فعال/غیرفعال نامعتبر است.' };
		data.isActive = b.isActive;
	}
	return { ok: true, data };
}

/** The cards from the editor's text; null when the request did not send any. */
function readCards(body: unknown): InputResult<CardParseResult | null> {
	const cards = (body as Record<string, unknown> | undefined)?.cards;
	if (cards === undefined) return { ok: true, data: null };
	if (typeof cards !== 'string') return { ok: false, error: 'متن کارت‌ها نامعتبر است.' };
	const parsed = parseCardLines(cards);
	if (parsed.errors.length) {
		const shown = parsed.errors
			.slice(0, 3)
			.map((e) => (e.line ? `خط ${fa(e.line)}: ${e.message}` : e.message))
			.join(' · ');
		const more = parsed.errors.length > 3 ? ` (و ${fa(parsed.errors.length - 3)} مورد دیگر)` : '';
		return { ok: false, error: shown + more };
	}
	return { ok: true, data: parsed };
}

adminGamesRouter.get('/game-decks/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه دسته نامعتبر است.' });
		const deck = await prisma.gameDeck.findUnique({
			where: { id },
			include: { cards: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { text: true, forbidden: true } } },
		});
		if (!deck) return res.status(404).json({ message: 'دسته پیدا نشد.' });
		res.json({
			deck: { id: deck.id, name: deck.name, games: deck.games.filter(isGameKey), isActive: deck.isActive },
			cards: deck.cards.map(cardLine).join('\n'),
		});
	} catch (error) {
		next(error);
	}
});

adminGamesRouter.post('/game-decks', async (req, res, next) => {
	try {
		const input = readDeckInput(req.body, false);
		if (!input.ok) return res.status(400).json({ message: input.error });
		const cards = readCards(req.body);
		if (!cards.ok) return res.status(400).json({ message: cards.error });
		const last = await prisma.gameDeck.aggregate({ _max: { sortOrder: true } });
		const deck = await prisma.$transaction(async (tx) => {
			const created = await tx.gameDeck.create({
				data: { name: input.data.name!, games: input.data.games!, isActive: input.data.isActive ?? true, sortOrder: (last._max.sortOrder ?? -1) + 1 },
			});
			if (cards.data) await replaceDeckCards(tx, created.id, cards.data.cards);
			return created;
		});
		res.status(201).json({ deck: { id: deck.id }, duplicates: cards.data?.duplicates ?? 0, ...(await getAdminGames()) });
	} catch (error) {
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'دسته‌ای با همین نام وجود دارد.' });
		next(error);
	}
});

adminGamesRouter.patch('/game-decks/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه دسته نامعتبر است.' });
		const input = readDeckInput(req.body, true);
		if (!input.ok) return res.status(400).json({ message: input.error });
		const cards = readCards(req.body);
		if (!cards.ok) return res.status(400).json({ message: cards.error });
		await prisma.$transaction(
			async (tx) => {
				await tx.gameDeck.update({ where: { id }, data: input.data });
				if (cards.data) await replaceDeckCards(tx, id, cards.data.cards);
			},
			{ timeout: 30_000 },
		);
		res.json({ duplicates: cards.data?.duplicates ?? 0, ...(await getAdminGames()) });
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'دسته پیدا نشد.' });
		if (prismaCode(error) === 'P2002') return res.status(409).json({ message: 'دسته‌ای با همین نام وجود دارد.' });
		next(error);
	}
});

adminGamesRouter.delete('/game-decks/:id', async (req, res, next) => {
	try {
		const id = parseId(req.params.id);
		if (!id) return res.status(400).json({ message: 'شناسه دسته نامعتبر است.' });
		await prisma.gameDeck.delete({ where: { id } });
		res.json(await getAdminGames());
	} catch (error) {
		if (prismaCode(error) === 'P2025') return res.status(404).json({ message: 'دسته پیدا نشد.' });
		next(error);
	}
});
