import assert from 'node:assert/strict';
import { test } from 'node:test';
import { durationOptions, fitDuration } from '../client/reserve/common/durations.js';

test('booking lengths follow the café settings, in half-hour steps', () => {
	assert.deepEqual(durationOptions(), [60, 90, 120, 150, 180, 210, 240]);
	assert.deepEqual(durationOptions(45, 120), [45, 60, 90, 120]);
	assert.deepEqual(durationOptions(90, 180), [90, 120, 150, 180]);
	assert.deepEqual(durationOptions(60, 60), [60]);
	assert.deepEqual(durationOptions(100, 200), [100, 120, 150, 180, 200]);
	// a broken setting (max under min) still offers the minimum
	assert.deepEqual(durationOptions(120, 60), [120]);
});

test('the default length is the allowed one nearest to an hour', () => {
	assert.equal(fitDuration(60), 60);
	assert.equal(fitDuration(60, 90, 240), 90);
	assert.equal(fitDuration(60, 15, 45), 45);
	assert.equal(fitDuration(200, 60, 180), 180);
});
