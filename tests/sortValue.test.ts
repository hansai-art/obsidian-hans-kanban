import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { compareSortValuesDesc } from '../src/utils/sortValue.ts';

describe('compareSortValuesDesc', () => {
	test('emoji star counts sort descending', () => {
		assert.ok(compareSortValuesDesc('⭐⭐⭐', '⭐') < 0);
		assert.ok(compareSortValuesDesc('⭐', '⭐⭐⭐⭐⭐') > 0);
	});

	test('black stars (★ U+2605) count the same way', () => {
		assert.ok(compareSortValuesDesc('★★★★', '★★') < 0);
		assert.ok(compareSortValuesDesc('★', '⭐⭐') > 0, 'mixed star glyphs compare by count');
	});

	test('numbers compare numerically, not lexicographically', () => {
		assert.ok(compareSortValuesDesc('10', '9') < 0);
		assert.ok(compareSortValuesDesc('2', '10') > 0);
	});

	test('empty values always sort last', () => {
		assert.ok(compareSortValuesDesc('', '⭐') > 0);
		assert.ok(compareSortValuesDesc('⭐', '') < 0);
		assert.strictEqual(compareSortValuesDesc('', ''), 0);
	});

	test('ranked values (stars / numbers) sort before plain text', () => {
		assert.ok(compareSortValuesDesc('⭐', 'high') < 0);
		assert.ok(compareSortValuesDesc('high', '3') > 0);
	});

	test('plain text falls back to locale compare, descending', () => {
		assert.ok(compareSortValuesDesc('beta', 'alpha') < 0);
		assert.ok(compareSortValuesDesc('alpha', 'beta') > 0);
		assert.strictEqual(compareSortValuesDesc('same', 'same'), 0);
	});
});
