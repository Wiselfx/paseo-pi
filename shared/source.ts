/**
 * People paste the command they were told to run, not just its argument. Accept
 * `pi install npm:foo`, `pi add npm:foo`, quotes, and a leading shell prompt, and return the
 * source itself so the input shows what will be stored.
 */
export function normalizePackageInput(raw: string): string {
	let value = raw.trim();
	value = value.replace(/^[$>]\s+/u, "");
	value = value.replace(/^`+|`+$/gu, "").trim();
	value = value.replace(/^["']|["']$/gu, "").trim();
	value = value.replace(/^(?:pi|π)\s+(?:install|add|i)\s+/iu, "").trim();
	value = value.replace(/^["']|["']$/gu, "").trim();
	return value;
}

/** True when the text looks like a pi package source rather than a filesystem path. */
export function looksLikePackageSource(value: string): boolean {
	return /^(?:npm:|git:|https?:\/\/|ssh:\/\/)/iu.test(value);
}
