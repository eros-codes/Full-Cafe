import express from 'express';
import { getGamesData, getGamesStatus } from '../services/games.service.js';

// The games page for the customer: no login, nothing about the players is stored on the server.
// /status is what the other pages ask (is the «بازی‌ها» link shown?); the games page itself loads
// /games once (the games to show and the cards of the word games) and keeps a copy on the phone.
export const gamesRouter = express.Router();

gamesRouter.get('/games/status', async (_req, res, next) => {
	try {
		res.setHeader('Cache-Control', 'no-cache');
		res.json(await getGamesStatus());
	} catch (error) {
		next(error);
	}
});

gamesRouter.get('/games', async (_req, res, next) => {
	try {
		res.setHeader('Cache-Control', 'no-cache');
		res.json(await getGamesData());
	} catch (error) {
		next(error);
	}
});
