import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { PAGES } from './src/web/pages.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(ROOT, 'client');

// One build entry per page (see src/web/pages.ts). Shared code (React, API helpers) is split into
// common chunks automatically; each page still loads only its own stylesheet.
export default defineConfig({
	root: CLIENT,
	// client/public → served at the site root: /fonts/…, /images/…, /maps/…
	publicDir: path.join(CLIENT, 'public'),
	plugins: [react()],
	build: {
		outDir: path.join(ROOT, 'dist', 'client'),
		emptyOutDir: true,
		rollupOptions: {
			input: Object.fromEntries(PAGES.map((page) => [page.html.replace(/\/index\.html$/, '').replace(/\//g, '-'), path.join(CLIENT, page.html)])),
		},
	},
});
