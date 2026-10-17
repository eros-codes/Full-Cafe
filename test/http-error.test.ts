import test from 'node:test';
import assert from 'node:assert/strict';
import { createHttpError } from '../src/lib/http-error.js';

test('createHttpError preserves status and message', () => {
	const error = createHttpError(400, 'میز در این زمان قابل رزرو نیست.');

	assert.equal(error.status, 400);
	assert.equal(error.message, 'میز در این زمان قابل رزرو نیست.');
});
