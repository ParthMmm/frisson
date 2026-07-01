import {
	METADATA_TRANSITION_LOOKAHEAD_MS,
	METADATA_TRANSITION_POLL_MS,
	getCurrentTrackCacheExpiresAt,
	getMetadataFailureState,
	getMetadataRefreshDelay,
} from '../src/lib/metadata-refresh';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

const now = 1_000_000;
const trackEndSeconds = (now + 20_000) / 1000;
const lookaheadStart = now + 20_000 - METADATA_TRANSITION_LOOKAHEAD_MS;

assertEqual(
	METADATA_TRANSITION_LOOKAHEAD_MS,
	12_000,
	'metadata transition polling starts before Radio France crossfades',
);
assertEqual(
	getMetadataRefreshDelay(now, trackEndSeconds),
	20_000 - METADATA_TRANSITION_LOOKAHEAD_MS,
	'metadata refresh starts before track end by the transition lookahead',
);
assertEqual(
	getCurrentTrackCacheExpiresAt(now, trackEndSeconds, 30_000),
	lookaheadStart,
	'metadata cache expires at the transition lookahead',
);
assertEqual(
	getMetadataRefreshDelay(now, (now + 10_000) / 1000),
	METADATA_TRANSITION_POLL_MS,
	'metadata refresh polls immediately when already inside the transition lookahead',
);
assertEqual(
	getCurrentTrackCacheExpiresAt(now, (now + 10_000) / 1000, 30_000),
	now + METADATA_TRANSITION_POLL_MS,
	'metadata cache expires on the transition poll cadence when already inside the lookahead',
);
assertEqual(
	getMetadataRefreshDelay(lookaheadStart, trackEndSeconds),
	METADATA_TRANSITION_POLL_MS,
	'metadata refresh polls at the transition lookahead boundary',
);
assertEqual(
	getCurrentTrackCacheExpiresAt(lookaheadStart, trackEndSeconds, 30_000),
	lookaheadStart + METADATA_TRANSITION_POLL_MS,
	'metadata cache expires on the transition poll cadence at the lookahead boundary',
);
assertEqual(
	getMetadataRefreshDelay(lookaheadStart + 1_000, trackEndSeconds),
	METADATA_TRANSITION_POLL_MS,
	'metadata refresh polls once inside the transition lookahead',
);
assertEqual(
	getCurrentTrackCacheExpiresAt(lookaheadStart + 1_000, trackEndSeconds, 30_000),
	lookaheadStart + 1_000 + METADATA_TRANSITION_POLL_MS,
	'metadata cache expires on the transition poll cadence inside the lookahead',
);
assertEqual(
	getMetadataRefreshDelay(now + 21_000, trackEndSeconds),
	METADATA_TRANSITION_POLL_MS,
	'metadata refresh keeps polling after track end',
);
assertEqual(
	getCurrentTrackCacheExpiresAt(now + 21_000, trackEndSeconds, 30_000),
	now + 21_000 + METADATA_TRANSITION_POLL_MS,
	'metadata cache expires on the transition poll cadence after track end',
);
assertEqual(
	getMetadataRefreshDelay(now, null, 30_000),
	30_000,
	'metadata refresh uses fallback cache when track end is missing',
);
assertEqual(
	getCurrentTrackCacheExpiresAt(now, null, 30_000),
	now + 30_000,
	'metadata cache uses fallback expiry when track end is missing',
);
assertEqual(
	getMetadataRefreshDelay(now, Number.NaN, 30_000),
	30_000,
	'metadata refresh uses fallback cache when track end is invalid',
);
assertEqual(
	getCurrentTrackCacheExpiresAt(now, Number.NaN, 30_000),
	now + 30_000,
	'metadata cache uses fallback expiry when track end is invalid',
);
assertEqual(
	getMetadataFailureState(true),
	'ready',
	'metadata failure keeps ready state when stale track is visible',
);
assertEqual(
	getMetadataFailureState(false),
	'error',
	'metadata failure shows error only without a visible track',
);
