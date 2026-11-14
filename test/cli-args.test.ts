// Options of the scripts that change data: an unknown one (a long dash instead of two hyphens) stops them. No database.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions } from '../scripts/cli-args.js';

test('script options: known ones pass, anything else stops the script with a hint', () => {
	assert.deepEqual([...parseOptions(['--dry-run'], ['--dry-run', '--force']).options], ['--dry-run']);
	assert.equal(parseOptions([], ['--dry-run']).problem, null);
	// what PowerShell got from «npm run map:apply — —dry-run»: before, the script did not see --dry-run and applied the plan
	const dashed = parseOptions(['—', '—dry-run'], ['--dry-run', '--force']);
	assert.equal(dashed.options.size, 0);
	assert.match(dashed.problem ?? '', /Nothing was changed/);
	assert.match(dashed.problem ?? '', /long dash/);
	const typo = parseOptions(['--dryrun'], ['--dry-run']);
	assert.match(typo.problem ?? '', /Unknown option: --dryrun/);
	assert.doesNotMatch(typo.problem ?? '', /long dash/);
});
