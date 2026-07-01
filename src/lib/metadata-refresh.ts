export const METADATA_FALLBACK_CACHE_MS = 30_000;
export const METADATA_TRANSITION_LOOKAHEAD_MS = 12_000;
export const METADATA_TRANSITION_POLL_MS = 2_000;

export type MetadataState = 'idle' | 'loading' | 'ready' | 'error';

export function getCurrentTrackCacheExpiresAt(
	now: number,
	trackEndSeconds: number | null | undefined,
	fallbackCacheMs = METADATA_FALLBACK_CACHE_MS,
	transitionPollMs = METADATA_TRANSITION_POLL_MS,
	transitionLookaheadMs = METADATA_TRANSITION_LOOKAHEAD_MS,
) {
	return (
		now +
		getMetadataRefreshDelay(
			now,
			trackEndSeconds,
			fallbackCacheMs,
			transitionPollMs,
			transitionLookaheadMs,
		)
	);
}

export function getMetadataRefreshDelay(
	now: number,
	trackEndSeconds: number | null | undefined,
	fallbackCacheMs = METADATA_FALLBACK_CACHE_MS,
	transitionPollMs = METADATA_TRANSITION_POLL_MS,
	transitionLookaheadMs = METADATA_TRANSITION_LOOKAHEAD_MS,
) {
	const refreshAt = getMetadataRefreshAt(trackEndSeconds, transitionLookaheadMs);
	if (refreshAt === null) return fallbackCacheMs;

	return refreshAt > now ? refreshAt - now : transitionPollMs;
}

export function getMetadataFailureState(hasCurrentTrack: boolean): MetadataState {
	return hasCurrentTrack ? 'ready' : 'error';
}

function getMetadataRefreshAt(
	trackEndSeconds: number | null | undefined,
	transitionLookaheadMs: number,
) {
	const trackEnd = getTrackEndMs(trackEndSeconds);
	if (trackEnd === null) return null;

	return trackEnd - transitionLookaheadMs;
}

function getTrackEndMs(trackEndSeconds: number | null | undefined) {
	if (
		typeof trackEndSeconds !== 'number' ||
		!Number.isFinite(trackEndSeconds) ||
		trackEndSeconds <= 0
	) {
		return null;
	}

	return trackEndSeconds * 1000;
}
