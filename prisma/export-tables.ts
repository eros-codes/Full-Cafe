// The tables of this database (as arranged in the panel's map editor) in the format of prisma/seed-data/floor-map.json:
//
//   npm run db:export-tables              → prints it
//   npm run db:export-tables -- --write   → writes prisma/seed-data/floor-map.json (what the seed and map:apply use)
//
// Only tables on the floor plan (not retired ones); the on/off switch is not part of the layout.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { PROJECT_ROOT } from '../src/lib/paths.js';
import { parseLayout } from '../src/services/floor-plan.service.js';
import { requireOptions } from '../scripts/cli-args.js';

const prisma = new PrismaClient();
const FILE = path.join(PROJECT_ROOT, 'prisma', 'seed-data', 'floor-map.json');
const write = requireOptions(['--write']).has('--write');

async function main() {
	const tables = await prisma.cafeTable.findMany({ where: { retiredAt: null }, orderBy: { code: 'asc' } });
	const ids = new Map(tables.map((t) => [t.id, t.code]));
	const connections = (await prisma.tableConnection.findMany())
		.filter((c) => ids.has(c.tableAId) && ids.has(c.tableBId))
		.map((c) => [ids.get(c.tableAId)!, ids.get(c.tableBId)!].sort());
	const existing = fs.existsSync(FILE) ? (JSON.parse(fs.readFileSync(FILE, 'utf8')) as { $comment?: string }) : {};
	const layout = {
		$comment: existing.$comment,
		tables: tables.map((t) => ({
			code: t.code,
			displayNumber: t.displayNumber,
			zone: t.zone,
			shape: t.shape,
			capacity: t.capacity,
			minGuests: t.minGuests,
			maxGuests: t.maxGuests,
			x: t.x,
			y: t.y,
			width: t.width,
			height: t.height,
			rotation: t.rotation,
			chairs: t.chairs ?? [],
			description: t.description,
		})),
		connections,
	};
	// the same checks the seed and map:apply make (a table without chairs, more guests than seats, …)
	parseLayout(layout);
	const json = `${JSON.stringify(layout, null, '\t')}\n`;
	if (write) {
		fs.writeFileSync(FILE, json);
		console.log(`${tables.length} tables and ${connections.length} connections written to prisma/seed-data/floor-map.json`);
	} else {
		process.stdout.write(json);
	}
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
