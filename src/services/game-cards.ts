// The cards of the word games as text, one card per line: the format of the deck editor in the admin
// panel and of prisma/seed-data/games.json, so a deck can be copied between the two as it is.
//
//   فرودگاه                                  → a card (a place, a word, a phrase)
//   قهوه: فنجان، کافئین، تلخ، صبح، اسپرسو    → a card with its forbidden words («کلمات ممنوعه»)
//
// Used by the admin routes, the seed scripts and the tests.

import type { Db } from '../lib/prisma.js';

export const CARD_TEXT_MAX = 80;
export const FORBIDDEN_WORD_MAX = 30;
export const FORBIDDEN_PER_CARD_MAX = 8;
export const CARDS_PER_DECK_MAX = 1000;

export interface ParsedCard {
	text: string;
	forbidden: string[];
}

export interface CardParseResult {
	cards: ParsedCard[];
	/** Lines that repeated an earlier card of the same text (left out). */
	duplicates: number;
	/** Problems by line number (1-based); a deck is only saved when there are none. */
	errors: { line: number; message: string }[];
}

/**
 * The same spelling whatever keyboard typed it: Arabic «ي» and «ك» become Persian «ی» and «ک», the
 * kashida and repeated spaces go. «كافه» and «کافه» are then one card, not two.
 */
export function normalizeCardText(value: string): string {
	return value
		.replace(/ي/g, 'ی')
		.replace(/ك/g, 'ک')
		.replace(/ـ/g, '')
		.replace(/[\t  ]+/g, ' ')
		.trim();
}

const FORBIDDEN_SEPARATOR = /[،,؛;]/;

export function parseCardLines(source: string | readonly string[]): CardParseResult {
	const lines = typeof source === 'string' ? source.split(/\r?\n/) : source;
	const cards: ParsedCard[] = [];
	const seen = new Set<string>();
	const errors: CardParseResult['errors'] = [];
	let duplicates = 0;

	lines.forEach((raw, index) => {
		const line = index + 1;
		if (!raw.trim()) return;
		const colon = raw.search(/[:：]/);
		const text = normalizeCardText(colon === -1 ? raw : raw.slice(0, colon));
		const forbiddenPart = colon === -1 ? '' : raw.slice(colon + 1);
		if (!text) {
			errors.push({ line, message: 'قبل از «:» کلمه‌ای نیامده' });
			return;
		}
		if (text.length > CARD_TEXT_MAX) {
			errors.push({ line, message: `«${text.slice(0, 20)}…» بیشتر از ${CARD_TEXT_MAX} حرف است` });
			return;
		}
		const forbidden: string[] = [];
		for (const part of forbiddenPart.split(FORBIDDEN_SEPARATOR)) {
			const word = normalizeCardText(part);
			if (!word || forbidden.includes(word)) continue;
			forbidden.push(word);
		}
		if (forbidden.length > FORBIDDEN_PER_CARD_MAX) {
			errors.push({ line, message: `«${text}» بیشتر از ${FORBIDDEN_PER_CARD_MAX} کلمه‌ی ممنوع دارد` });
			return;
		}
		const tooLong = forbidden.find((word) => word.length > FORBIDDEN_WORD_MAX);
		if (tooLong) {
			errors.push({ line, message: `کلمه‌ی ممنوع «${tooLong.slice(0, 20)}…» بیشتر از ${FORBIDDEN_WORD_MAX} حرف است` });
			return;
		}
		if (forbidden.includes(text)) {
			errors.push({ line, message: `خود «${text}» در کلمه‌های ممنوعش آمده` });
			return;
		}
		if (seen.has(text)) {
			duplicates++;
			return;
		}
		seen.add(text);
		cards.push({ text, forbidden });
	});

	if (cards.length > CARDS_PER_DECK_MAX) errors.push({ line: 0, message: `هر دسته حداکثر ${CARDS_PER_DECK_MAX} کارت دارد` });
	return { cards, duplicates, errors };
}

/** A card back as one line of the editor: `text` or `text: word، word، …`. */
export function cardLine(card: { text: string; forbidden: readonly string[] }): string {
	return card.forbidden.length ? `${card.text}: ${card.forbidden.join('، ')}` : card.text;
}

/**
 * Makes the deck's cards exactly `cards`, in that order. Cards whose text stays keep their id (so a player's
 * "already seen" list on the phone still works); the others are added or removed.
 */
export async function replaceDeckCards(db: Db, deckId: number, cards: readonly ParsedCard[]): Promise<void> {
	const existing = await db.gameCard.findMany({ where: { deckId }, select: { id: true, text: true, forbidden: true, sortOrder: true } });
	const wanted = new Map(cards.map((card, index) => [card.text, { ...card, sortOrder: index }]));
	const removed = existing.filter((card) => !wanted.has(card.text)).map((card) => card.id);
	if (removed.length) await db.gameCard.deleteMany({ where: { id: { in: removed } } });
	const kept = new Map(existing.filter((card) => wanted.has(card.text)).map((card) => [card.text, card]));
	for (const [text, card] of wanted) {
		const old = kept.get(text);
		// only the cards that really changed are written (a deck of a few hundred cards stays fast)
		if (old && (old.sortOrder !== card.sortOrder || old.forbidden.join('\n') !== card.forbidden.join('\n'))) {
			await db.gameCard.update({ where: { id: old.id }, data: { forbidden: card.forbidden, sortOrder: card.sortOrder } });
		}
	}
	const added = [...wanted.values()].filter((card) => !kept.has(card.text));
	if (added.length) {
		await db.gameCard.createMany({
			data: added.map((card) => ({ deckId, text: card.text, forbidden: card.forbidden, sortOrder: card.sortOrder })),
		});
	}
}
