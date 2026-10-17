import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * Project root (the folder with package.json). Found by walking up from this file, so it is the
 * same whether the server runs from src/ (tsx, development) or from dist/server/ (compiled build).
 */
function findProjectRoot(start: string): string {
	let dir = start;
	for (;;) {
		if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
		const parent = path.dirname(dir);
		if (parent === dir) throw new Error('package.json پیدا نشد؛ ریشه‌ی پروژه مشخص نیست.');
		dir = parent;
	}
}

export const PROJECT_ROOT = findProjectRoot(path.dirname(fileURLToPath(import.meta.url)));
export const UPLOADS_DIR = path.join(PROJECT_ROOT, 'uploads');
