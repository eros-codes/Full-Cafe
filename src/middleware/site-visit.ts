import crypto from 'crypto';
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../lib/prisma.js';
import { config } from '../config.js';

// Counts one unique visitor per day for the public pages (from the café template).

export function todayKey(date: Date = new Date()): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tehran', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

// Public pages only (café site + reservation), not the admin panel or API.
const TRACKED_PAGE = /^\/(menu|feedback|reserve(\/(payment|invoice|profile|track))?)?\/?$/;

function visitorHash(req: Request): string {
	// req.ip already respects `trust proxy`. The old code read X-Forwarded-For directly,
	// so anyone could inflate the counter by sending a fake header.
	const raw = `${req.ip || 'unknown'}|${req.get('user-agent') || 'unknown'}|${config.adminJwtSecret}`;
	return crypto.createHash('sha256').update(raw).digest('hex');
}

export function trackSiteVisit(req: Request, _res: Response, next: NextFunction): void {
	if (req.method !== 'GET' || !TRACKED_PAGE.test(req.path)) return next();
	const visitDate = todayKey();
	prisma.siteVisit
		.upsert({
			where: { visitDate_visitorHash: { visitDate, visitorHash: visitorHash(req) } },
			update: {},
			create: { visitDate, visitorHash: visitorHash(req), page: req.path.slice(0, 255) },
		})
		.catch((error: unknown) => console.error('ثبت بازدید ناموفق بود:', error instanceof Error ? error.message : error));
	next();
}
