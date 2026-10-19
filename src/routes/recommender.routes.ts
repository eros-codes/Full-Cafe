import express from 'express';
import { getRecommenderData, getRecommenderStatus } from '../services/recommender.service.js';

// «انتخاب برای من» for the customer: no login, nothing about the customer is stored.
// /status is the only thing the menu page asks for on load (is the button shown?); the questions and the
// products are loaded only when the customer opens the recommender, and the matching runs in the browser.
export const recommenderRouter = express.Router();

recommenderRouter.get('/recommender/status', async (_req, res, next) => {
	try {
		res.setHeader('Cache-Control', 'no-cache');
		res.json(await getRecommenderStatus());
	} catch (error) {
		next(error);
	}
});

recommenderRouter.get('/recommender', async (_req, res, next) => {
	try {
		res.setHeader('Cache-Control', 'no-cache');
		res.json(await getRecommenderData());
	} catch (error) {
		next(error);
	}
});
