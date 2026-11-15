import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mergedDeckGames, readGamesFile } from '../prisma/seed-games.js';
import { GAMES } from '../src/services/game-catalog.js';
import { parseCardLines } from '../src/services/game-cards.js';

// prisma/seed-data/games.json: the cards of «جاسوس», «کلمات ممنوعه» and the other word games.
const file = readGamesFile();

describe('seed cards (prisma/seed-data/games.json)', () => {
	test('the file reads with the same rules as the panel editor', () => {
		assert.ok(file, 'games.json is there');
		assert.ok(file.decks.length >= 40);
	});

	test('every word game has enough cards, and «جاسوس» / «کلمات ممنوعه» have many topics', () => {
		for (const game of GAMES) {
			if (!game.cards) continue;
			const decks = file!.decks.filter((d) => d.games.includes(game.key));
			const cards = decks.flatMap((d) => parseCardLines(d.cards).cards).filter((c) => !game.cards!.needsForbidden || c.forbidden.length);
			assert.ok(cards.length >= game.cards.min, game.key);
		}
		const topics = (key: string) => file!.decks.filter((d) => d.games.includes(key)).length;
		assert.ok(topics('spy') >= 20, 'spy topics');
		assert.ok(topics('taboo') >= 15, 'taboo topics');
	});

	test('a «کلمات ممنوعه» card always has its forbidden words, and a word is in one topic only', () => {
		for (const key of ['spy', 'taboo']) {
			const where = new Map<string, string>();
			for (const deck of file!.decks.filter((d) => d.games.includes(key))) {
				const { cards, duplicates } = parseCardLines(deck.cards);
				assert.equal(duplicates, 0, `${deck.name}: a card twice`);
				for (const card of cards) {
					if (key === 'taboo') assert.ok(card.forbidden.length >= 4, `${deck.name}: «${card.text}» without enough forbidden words`);
					assert.ok(!where.has(card.text), `«${card.text}» in «${where.get(card.text)}» and «${deck.name}»`);
					where.set(card.text, deck.name);
				}
			}
		}
	});

	test('merging adds the games the file gives a deck, keeps the café’s, and skips unknown keys', () => {
		assert.deepEqual(mergedDeckGames(['heads_up', 'charades'], ['heads_up', 'charades', 'spy']), ['heads_up', 'charades', 'spy']);
		assert.deepEqual(mergedDeckGames(['heads_up'], ['spy', 'nope']), ['heads_up', 'spy']);
		assert.deepEqual(mergedDeckGames(['taboo', 'spy'], ['taboo']), ['taboo', 'spy']);
	});
});
