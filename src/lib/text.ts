export function normalizeTrackText(value: unknown) {
	return String(value ?? '')
		.trim()
		.toLowerCase();
}
