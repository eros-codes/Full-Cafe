// Puts an existing database on the floor plan of prisma/seed-data/floor-map.json (the tables of
// client/public/maps/roof-base.svg):
//
//   npm run map:apply -- --dry-run    → only says what would change
//   npm run map:apply                 → applies it
//   npm run map:apply -- --force      → applies it even with bookings to come on tables that leave the plan
//
// Tables of the layout are created or updated by their code (position, size, chairs, seats; a table the manager
// switched off stays off). Every other table leaves the plan: deleted if no booking ever used it, otherwise retired,
// so its past bookings keep their table number. Menu, bookings, settings and accounts are not touched.
// Safe to run again. Pages already open in a browser show the new plan after a reload.
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { prisma } from '../src/lib/prisma.js';
import { PROJECT_ROOT } from '../src/lib/paths.js';
import { applyLayout, parseLayout, planLayout } from '../src/services/floor-plan.service.js';
import { requireOptions } from './cli-args.js';

// an option it does not know (e.g. «—dry-run» with a long dash) stops it before it changes anything
const options = requireOptions(['--dry-run', '--force']);
const dryRun = options.has('--dry-run');
const force = options.has('--force');
const file = path.join(PROJECT_ROOT, 'prisma', 'seed-data', 'floor-map.json');

async function main() {
	const layout = parseLayout(JSON.parse(fs.readFileSync(file, 'utf8')));
	const plan = await planLayout(layout);
	const seats = layout.tables.reduce((sum, t) => sum + t.capacity, 0);
	console.log(`Layout: ${layout.tables.length} tables, ${seats} seats, ${layout.connections.length} connections.`);
	console.log(`  new tables: ${plan.create.length}${plan.create.length ? ` (${plan.create.join(', ')})` : ''}`);
	console.log(`  updated:    ${plan.update.length}`);
	const retire = plan.remove.filter((t) => t.used);
	const remove = plan.remove.filter((t) => !t.used);
	console.log(`  deleted:    ${remove.length}${remove.length ? ` (${remove.map((t) => t.code).join(', ')})` : ''}`);
	console.log(
		`  retired:    ${retire.length}${retire.length ? ` (${retire.map((t) => t.code).join(', ')}: their bookings keep them in the history)` : ''}`,
	);
	if (plan.blockers.length) {
		console.log(`\nBookings to come on tables that leave the plan:`);
		for (const r of plan.blockers) {
			const tables = r.tables.map((t) => `${t.table.code}/${t.table.displayNumber}`).join(' + ');
			console.log(`  ${r.trackingCode} · ${r.customerName} · ${r.startAt.toLocaleString('fa-IR')} · ${r.status} · ${tables}`);
		}
		if (!force && !dryRun) {
			console.log('\nNothing was changed. Move or cancel these bookings in the panel first, or run again with --force');
			console.log('(they stay valid, but their table is no longer on the map).');
			process.exitCode = 1;
			return;
		}
	}
	if (dryRun) {
		console.log('\nNothing was changed (--dry-run). Run `npm run map:apply` to apply it.');
		return;
	}
	const done = await applyLayout(layout, { force });
	console.log(
		`\nDone: ${done.created} created, ${done.updated} updated, ${done.deleted} deleted, ${done.retired} retired, ${done.connections} connections.`,
	);
}

main()
	.catch((error) => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	})
	.finally(() => prisma.$disconnect());
