// Exports the games of this database (order, on/off and every deck with its cards) into a file, so another
// café can start with them or they can become the seed data:
//
//   npm run db:export-games            → games-export/games.json
//
// Same format as prisma/seed-data/games.json: copy the file there to make it the seed. The JSON is written
// as UTF-8 by the script itself (a PowerShell `>` redirect would write UTF-16). The folder is in .gitignore.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PROJECT_ROOT } from '../src/lib/paths.js';
import { cardLine } from '../src/services/game-cards.js';
import { GAMES, gameStates } from '../src/services/game-catalog.js';
import type { GamesFile } from './seed-games.js';

const prisma = new PrismaClient();
const OUT_DIR = path.join(PROJECT_ROOT, 'games-export');

async function main() {
	const [settings, decks] = await Promise.all([
		prisma.gameSetting.findMany(),
		prisma.gameDeck.findMany({
			orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
			include: { cards: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { text: true, forbidden: true } } },
		}),
	]);
	const data: GamesFile = {
		games: gameStates(settings, []).map((g) => ({ key: g.key, isActive: g.isActive, sortOrder: g.sortOrder })),
		decks: decks.map((deck) => ({ name: deck.name, games: deck.games, isActive: deck.isActive, cards: deck.cards.map(cardLine) })),
	};
	fs.mkdirSync(OUT_DIR, { recursive: true });
	fs.writeFileSync(path.join(OUT_DIR, 'games.json'), JSON.stringify(data, null, '\t') + '\n', 'utf8');
	const cards = decks.reduce((sum, deck) => sum + deck.cards.length, 0);
	console.log(`games-export/games.json: ${GAMES.length} بازی، ${decks.length} دسته‌کارت، ${cards} کارت.`);
}

main()
	.catch((error) => {
		console.error(error);
		process.exit(1);
	})
	.finally(async () => prisma.$disconnect());
