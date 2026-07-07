/**
 * Rank a raw property value for sorting: star strings (⭐ U+2B50 / ★ U+2605)
 * rank by star count, numeric strings by numeric value. Returns null for
 * empty strings and values with no numeric interpretation.
 */
function numericRank(value: string): number | null {
	if (value === '') return null;
	const stars = [...value].filter((c) => c === '⭐' || c === '★').length;
	if (stars > 0) return stars;
	const n = Number(value);
	return Number.isFinite(n) ? n : null;
}

/**
 * Compare two raw property values descending, for the masonry sort:
 * - empty values always sort last
 * - star counts and numbers compare numerically ('10' after '9', not '1x')
 * - ranked values (stars / numbers) sort before plain text
 * - plain text falls back to locale compare, descending
 */
export function compareSortValuesDesc(a: string, b: string): number {
	if (a === b) return 0;
	if (a === '') return 1;
	if (b === '') return -1;
	const an = numericRank(a);
	const bn = numericRank(b);
	if (an !== null && bn !== null) return bn - an;
	if (an !== null) return -1;
	if (bn !== null) return 1;
	return b.localeCompare(a);
}
