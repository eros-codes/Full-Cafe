// Adds the decks and cards of prisma/seed-data/games.json that this database does not have yet:
//
//   npm run db:merge-games
//
// For a running café after an update brought new cards. Matched by deck name and card text; nothing the
// café changed is overwritten and nothing is removed (a card the café deleted comes back if it is still in
// the file, so delete it from the file too, or delete it again in the panel).
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { mergeGames } from './seed-games.js';

const prisma = new PrismaClient();

mergeGames(prisma)
	.then(({ decks, cards }) => console.log(`بازی‌ها: ${decks} دسته‌ی تازه، ${cards} کارت تازه اضافه شد.`))
	.catch((error) => {
		console.error(error);
		process.exit(1);
	})
	.finally(async () => prisma.$disconnect());
