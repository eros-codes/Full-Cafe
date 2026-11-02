// The games part of the seed: reads prisma/seed-data/games.json (the same format `npm run db:export-games`
// writes) and creates the decks of the word games and the order of the games page.
//
//   seedGames  → only on a database without any deck (part of `npm run db:seed` / `prisma migrate reset`)
//   mergeGames → `npm run db:merge-games`: adds the decks and cards of the file that the database does not
//                have yet, matched by deck name and card text. Nothing is changed or removed, so a card the
//                café deleted comes back if it is still in the file.
import fs from 'node:fs';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import { PROJECT_ROOT } from '../src/lib/paths.js';
import { parseCardLines, replaceDeckCards } from '../src/services/game-cards.js';
import { isGameKey } from '../src/services/game-catalog.js';

const FILE = path.join(PROJECT_ROOT, 'prisma', 'seed-data', 'games.json');

export interface GamesFile {
	/** Order and on/off of the games page (optional). */
	games?: { key: string; isActive: boolean; sortOrder: number }[];
	/** Each card is one line of the deck editor: «قهوه» or «قهوه: فنجان، کافئین، …». */
	decks: { name: string; games: string[]; isActive?: boolean; cards: string[] }[];
}

export function readGamesFile(file = FILE): GamesFile | null {
	if (!fs.existsSync(file)) return null;
	const data = JSON.parse(fs.readFileSync(file, 'utf8')) as GamesFile;
	for (const deck of data.decks) {
		const parsed = parseCardLines(deck.cards);
		if (parsed.errors.length) {
			const first = parsed.errors[0];
			throw new Error(`games.json, دسته‌ی «${deck.name}»، کارت ${first.line}: ${first.message}`);
		}
	}
	return data;
}

async function createDeck(prisma: PrismaClient, deck: GamesFile['decks'][number], sortOrder: number): Promise<number> {
	const { cards } = parseCardLines(deck.cards);
	return prisma.$transaction(
		async (tx) => {
			const row = await tx.gameDeck.create({
				data: { name: deck.name, games: deck.games.filter(isGameKey), isActive: deck.isActive ?? true, sortOrder },
			});
			await replaceDeckCards(tx, row.id, cards);
			return cards.length;
		},
		{ timeout: 60_000 },
	);
}

export async function seedGames(prisma: PrismaClient): Promise<void> {
	const data = readGamesFile();
	if (!data) {
		console.log('prisma/seed-data/games.json نیست؛ کارت‌های بازی‌ها ساخته نشد.');
		return;
	}
	if ((await prisma.gameSetting.count()) === 0 && data.games?.length) {
		await prisma.gameSetting.createMany({
			data: data.games.filter((g) => isGameKey(g.key)).map((g) => ({ key: g.key, isActive: g.isActive, sortOrder: g.sortOrder })),
		});
	}
	if ((await prisma.gameDeck.count()) > 0) {
		console.log('دسته‌کارت‌های بازی‌ها از قبل وجود دارند؛ seed بازی‌ها اضافه نشد (برای افزودن کارت‌های تازه: npm run db:merge-games).');
		return;
	}
	let cards = 0;
	for (const [index, deck] of data.decks.entries()) cards += await createDeck(prisma, deck, index);
	console.log(`بازی‌ها: ${data.decks.length} دسته‌کارت، ${cards} کارت.`);
}

export async function mergeGames(prisma: PrismaClient): Promise<{ decks: number; cards: number }> {
	const data = readGamesFile();
	if (!data) throw new Error('prisma/seed-data/games.json پیدا نشد.');
	let newDecks = 0;
	let newCards = 0;
	const last = await prisma.gameDeck.aggregate({ _max: { sortOrder: true } });
	let sortOrder = (last._max.sortOrder ?? -1) + 1;
	for (const deck of data.decks) {
		const existing = await prisma.gameDeck.findUnique({ where: { name: deck.name }, include: { cards: { select: { text: true } } } });
		if (!existing) {
			newCards += await createDeck(prisma, deck, sortOrder++);
			newDecks++;
			continue;
		}
		const have = new Set(existing.cards.map((c) => c.text));
		const missing = parseCardLines(deck.cards).cards.filter((card) => !have.has(card.text));
		if (!missing.length) continue;
		await prisma.gameCard.createMany({
			data: missing.map((card, i) => ({ deckId: existing.id, text: card.text, forbidden: card.forbidden, sortOrder: existing.cards.length + i })),
		});
		newCards += missing.length;
	}
	return { decks: newDecks, cards: newCards };
}
