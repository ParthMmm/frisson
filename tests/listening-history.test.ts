import {
	createListeningHistory,
	getAppleMusicLookupKey,
	LISTENING_HISTORY_LIMIT,
	type ListeningHistoryItem,
	type AppleMusicLookupFetcher,
} from '../src/lib/listening-history';
import { getStationById, type StorageAdapter } from '../src/lib/station-catalog';
import type { CurrentTrack } from '../src/lib/api';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assert(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements StorageAdapter {
	private values = new Map<string, string>();

	getItem(key: string) {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string) {
		this.values.set(key, value);
	}

	removeItem(key: string) {
		this.values.delete(key);
	}
}

const station = getStationById('FIP_ROCK')!;
const track = (id: string, title = `Track ${id}`): CurrentTrack => ({
	id,
	title,
	artist: 'Artist',
	album: 'Album',
	year: 2024,
	artworkUrl: null,
	start: Number(id.replace(/\D/g, '') || 1),
	end: Number(id.replace(/\D/g, '') || 1) + 200,
});

{
	const storage = new MemoryStorage();
	const lookup: AppleMusicLookupFetcher = async () => 'https://music.example/song';
	const history = createListeningHistory({ storage, lookupAppleMusicUrl: lookup, now: () => 1234 });
	const first = history.record(track('one'), station);
	assert(first !== null, 'first history record is added');
	assertEqual(history.record(track('one'), station), null, 'same signature is suppressed');
	assertEqual(history.getItems().length, 1, 'duplicate record does not add a row');
	assertEqual(
		history.getItems()[0]?.isAppleMusicLookupLoading,
		true,
		'new row starts in loading state',
	);

	for (let index = 2; index <= 31; index += 1) history.record(track(`track-${index}`), station);
	assertEqual(
		history.getItems().length,
		LISTENING_HISTORY_LIMIT,
		'history is capped at thirty rows',
	);
	assertEqual(history.getItems()[0]?.id, `${station.id}:track-31:${31}`, 'new rows are prepended');
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
	assertEqual(
		history.getItems()[0]?.appleMusicUrl,
		'https://music.example/song',
		'lookup result updates rows',
	);

	const persisted = JSON.parse(storage.getItem('frisson-listening-history-v1')!);
	assertEqual(
		persisted.length,
		LISTENING_HISTORY_LIMIT,
		'records persist after applying the limit',
	);
}

{
	const storage = new MemoryStorage();
	const valid: ListeningHistoryItem = {
		id: 'FIP:valid:1',
		title: 'Valid',
		artist: 'Artist',
		artworkUrl: null,
		appleMusicUrl: 'https://music.example/valid',
		isAppleMusicLookupLoading: true,
		stationName: 'FIP',
		stationTag: '105.1 MHZ',
		listenedAt: 100,
	};
	storage.setItem(
		'fip-listening-history-v1',
		JSON.stringify([
			valid,
			{ id: 'bad', title: 'Missing fields' },
			{ ...valid, id: 'FIP:valid:1' },
		]),
	);
	const history = createListeningHistory({ storage });
	history.load();
	assertEqual(history.getItems().length, 1, 'malformed and duplicate persisted rows are ignored');
	assertEqual(history.getItems()[0]?.isAppleMusicLookupLoading, false, 'loading resets on load');
	assertEqual(
		history.getItems()[0]?.appleMusicUrl,
		valid.appleMusicUrl,
		'valid persisted rows survive',
	);
	assertEqual(storage.getItem('fip-listening-history-v1'), null, 'legacy storage is migrated away');

	history.clear();
	assertEqual(
		storage.getItem('frisson-listening-history-v1'),
		null,
		'clearing history removes current storage',
	);
	assertEqual(
		storage.getItem('fip-listening-history-v1'),
		null,
		'clearing history removes legacy storage',
	);
}

{
	const storage = new MemoryStorage();
	const unresolved: ListeningHistoryItem = {
		id: 'FIP:unresolved:1',
		title: 'Unresolved',
		artist: 'Artist',
		artworkUrl: null,
		appleMusicUrl: null,
		isAppleMusicLookupLoading: true,
		stationName: 'FIP',
		stationTag: '105.1 MHZ',
		listenedAt: 100,
	};
	storage.setItem('frisson-listening-history-v1', JSON.stringify([unresolved]));
	let lookupCount = 0;
	const history = createListeningHistory({
		storage,
		lookupAppleMusicUrl: async () => {
			lookupCount += 1;
			return 'https://music.example/retried';
		},
	});
	history.load();
	assertEqual(
		history.getItems()[0]?.isAppleMusicLookupLoading,
		false,
		'load resets persisted loading state',
	);
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
	assertEqual(lookupCount, 1, 'unresolved persisted lookups retry');
	assertEqual(
		history.getItems()[0]?.appleMusicUrl,
		'https://music.example/retried',
		'retried lookup updates the row',
	);
}

{
	let resolveLookup: (url: string | null) => void = () => undefined;
	let lookupCount = 0;
	const lookup: AppleMusicLookupFetcher = () => {
		lookupCount += 1;
		return new Promise((resolve) => {
			resolveLookup = resolve;
		});
	};
	const history = createListeningHistory({ lookupAppleMusicUrl: lookup });
	const lookupTrack = track('lookup', ' Title ');
	const first = history.lookupAppleMusic(lookupTrack);
	const second = history.lookupAppleMusic({ ...lookupTrack, title: 'title' });
	assertEqual(lookupCount, 1, 'concurrent normalized lookups share one request');
	assertEqual(first, second, 'concurrent lookups return the shared promise');
	resolveLookup(null);
	assertEqual(await first, null, 'null lookup results resolve as no match');
	assertEqual(
		history.getAppleMusicLookupState(lookupTrack).status,
		'no-match',
		'null result is cached as no match',
	);
	assertEqual(
		history.getAppleMusicMode(lookupTrack),
		'none',
		'no-match hides current-track action',
	);
	assertEqual(
		getAppleMusicLookupKey(lookupTrack),
		'title:artist',
		'lookup key keeps normalized title and artist',
	);
	assertEqual(lookupCount, 1, 'cached no-match avoids another request');
}

{
	const history = createListeningHistory({
		lookupAppleMusicUrl: async () => {
			throw new Error('lookup failed');
		},
	});
	history.record(track('failed'), station);
	for (let index = 0; index < 12; index += 1) await Promise.resolve();
	const row = history.getItems()[0];
	assert(row !== undefined, 'failed lookup keeps the history row');
	assertEqual(row?.isAppleMusicLookupLoading, false, 'failed lookup leaves loading state');
	assertEqual(row?.appleMusicUrl, null, 'failed lookup exposes unavailable state');
	assertEqual(
		history.getAppleMusicLookupState(track('failed')).status,
		'no-match',
		'failed lookup caches no match',
	);
}
