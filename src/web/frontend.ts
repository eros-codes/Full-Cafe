import fs from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import type { Server } from 'http';
import express, { type NextFunction, type Request, type Response } from 'express';
import type { ViteDevServer } from 'vite';
import { config } from '../config.js';
import { PROJECT_ROOT } from '../lib/paths.js';
import { LEGACY_REDIRECTS, findPage, type PageEntry } from './pages.js';

// The React pages, served by this same Express server:
//   development → Vite in middleware mode (instant reload, sources from client/)
//   production  → the output of `vite build` in dist/client

export const CLIENT_SOURCE_DIR = path.join(PROJECT_ROOT, 'client');
export const CLIENT_BUILD_DIR = path.join(PROJECT_ROOT, 'dist', 'client');

let vite: ViteDevServer | null = null;
const htmlCache = new Map<string, string>();

/** Vite's middleware is mounted here once the dev server starts (see startViteDevServer). */
export const viteDevRouter = express.Router();

async function pageHtml(page: PageEntry): Promise<string> {
	if (vite) {
		const source = await fs.readFile(path.join(CLIENT_SOURCE_DIR, page.html), 'utf8');
		return vite.transformIndexHtml(`/${page.html}`, source);
	}
	const cached = htmlCache.get(page.html);
	if (cached) return cached;
	const built = path.join(CLIENT_BUILD_DIR, page.html);
	// Without a build (e.g. while running the API tests) the untransformed source page is enough
	// to answer the request; real visitors always get the built page.
	const html = await fs.readFile(existsSync(built) ? built : path.join(CLIENT_SOURCE_DIR, page.html), 'utf8');
	htmlCache.set(page.html, html);
	return html;
}

/** Old addresses (…/payment.html, /src/pages/menu/menu.html, …) → the new clean URLs, query kept. */
export function legacyRedirects(req: Request, res: Response, next: NextFunction): void {
	if ((req.method !== 'GET' && req.method !== 'HEAD') || !Object.hasOwn(LEGACY_REDIRECTS, req.path)) return next();
	const query = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
	res.redirect(301, LEGACY_REDIRECTS[req.path] + query);
}

export async function servePage(req: Request, res: Response, next: NextFunction): Promise<void> {
	if (req.method !== 'GET' && req.method !== 'HEAD') return next();
	const page = findPage(req.path);
	if (!page) return next();
	try {
		const html = await pageHtml(page);
		// HTML is never cached, so a deploy is visible immediately; the hashed assets it points to are
		res.setHeader('Cache-Control', 'no-cache');
		res.type('html').send(html);
	} catch (error) {
		next(error);
	}
}

const serveBuilt = express.static(CLIENT_BUILD_DIR, {
	index: false,
	maxAge: config.isProd ? '7d' : 0,
	setHeaders: (res, filePath) => {
		if (config.isProd && filePath.includes(`${path.sep}assets${path.sep}`)) {
			res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
		}
	},
});

/**
 * Built JS/CSS (content-hashed, cached for a year) and the public files (fonts, images);
 * in development Vite serves all of these from client/ instead.
 */
export function clientFiles(req: Request, res: Response, next: NextFunction): void {
	if (vite) return viteDevRouter(req, res, next);
	serveBuilt(req, res, next);
}

/** Development only: serve the React sources through Vite, with hot reload over the same HTTP server. */
export async function startViteDevServer(httpServer: Server): Promise<void> {
	const { createServer } = await import('vite');
	vite = await createServer({
		configFile: path.join(PROJECT_ROOT, 'vite.config.ts'),
		server: { middlewareMode: true, hmr: { server: httpServer } },
		appType: 'custom',
	});
	viteDevRouter.use(vite.middlewares);
}

export async function stopViteDevServer(): Promise<void> {
	await vite?.close();
	vite = null;
}
