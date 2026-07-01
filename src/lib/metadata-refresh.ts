export const METADATA_FALLBACK_CACHE_MS = 30_000;
export const METADATA_REFRESH_GRACE_MS = 5_000;

export function getCurrentTrackCacheExpiresAt(
	now: number,
	trackEndSeconds: number | null | undefined,
	fallbackCacheMs = METADATA_FALLBACK_CACHE_MS,
) {
	const refreshAt = getMetadataRefreshAt(trackEndSeconds);
	return refreshAt > now ? refreshAt : now + fallbackCacheMs;
}

export function getMetadataRefreshDelay(
	now: number,
	trackEndSeconds: number | null | undefined,
	fallbackCacheMs = METADATA_FALLBACK_CACHE_MS,
) {
	const refreshAt = getMetadataRefreshAt(trackEndSeconds);
	return refreshAt > now ? refreshAt - now : fallbackCacheMs;
}

function getMetadataRefreshAt(trackEndSeconds: number | null | undefined) {
	const trackEnd = getTrackEndMs(trackEndSeconds);
	return trackEnd > 0 ? trackEnd + METADATA_REFRESH_GRACE_MS : 0;
}

function getTrackEndMs(trackEndSeconds: number | null | undefined) {
	return trackEndSeconds ? trackEndSeconds * 1000 : 0;
}
