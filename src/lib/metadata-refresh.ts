export const METADATA_FALLBACK_CACHE_MS = 30_000;
export const METADATA_REFRESH_GRACE_MS = 5_000;
export const METADATA_STALE_RETRY_MS = 5_000;

export type MetadataState = 'idle' | 'loading' | 'ready' | 'error';

export function getCurrentTrackCacheExpiresAt(
	now: number,
	trackEndSeconds: number | null | undefined,
	fallbackCacheMs = METADATA_FALLBACK_CACHE_MS,
	staleRetryMs = METADATA_STALE_RETRY_MS,
) {
	const refreshAt = getMetadataRefreshAt(trackEndSeconds);
	if (refreshAt === 0) return now + fallbackCacheMs;

	return refreshAt > now ? refreshAt : now + staleRetryMs;
}

export function getMetadataRefreshDelay(
	now: number,
	trackEndSeconds: number | null | undefined,
	fallbackCacheMs = METADATA_FALLBACK_CACHE_MS,
	staleRetryMs = METADATA_STALE_RETRY_MS,
) {
	const refreshAt = getMetadataRefreshAt(trackEndSeconds);
	if (refreshAt === 0) return fallbackCacheMs;

	return refreshAt > now ? refreshAt - now : staleRetryMs;
}

export function getMetadataFailureState(hasCurrentTrack: boolean): MetadataState {
	return hasCurrentTrack ? 'ready' : 'error';
}

function getMetadataRefreshAt(trackEndSeconds: number | null | undefined) {
	const trackEnd = getTrackEndMs(trackEndSeconds);
	return trackEnd > 0 ? trackEnd + METADATA_REFRESH_GRACE_MS : 0;
}

function getTrackEndMs(trackEndSeconds: number | null | undefined) {
	return trackEndSeconds ? trackEndSeconds * 1000 : 0;
}
