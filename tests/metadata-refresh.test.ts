import {
	METADATA_REFRESH_GRACE_MS,
	getCurrentTrackCacheExpiresAt,
	getMetadataRefreshDelay,
} from '../src/lib/metadata-refresh';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assertAtLeast(actual: number, expected: number, message: string) {
	if (actual < expected) {
		throw new Error(`${message}: expected at least ${expected}, received ${actual}`);
	}
}

const now = 1_000_000;
const trackEndSeconds = (now + 10_000) / 1000;

assertAtLeast(
	METADATA_REFRESH_GRACE_MS,
	5_000,
	'metadata refresh grace waits for Radio France boundary lag',
);
assertEqual(
	getMetadataRefreshDelay(now, trackEndSeconds),
	10_000 + METADATA_REFRESH_GRACE_MS,
	'metadata refresh delay includes grace after track end',
);
assertEqual(
	getCurrentTrackCacheExpiresAt(now, trackEndSeconds, 30_000),
	now + 10_000 + METADATA_REFRESH_GRACE_MS,
	'metadata cache stays valid through refresh grace',
);
assertEqual(
	getMetadataRefreshDelay(now + 10_000, trackEndSeconds),
	METADATA_REFRESH_GRACE_MS,
	'metadata refresh delay waits out the grace window after track end',
);
