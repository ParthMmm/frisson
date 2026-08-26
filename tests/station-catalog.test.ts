import {
	applyPersistedFavoriteStations,
	createStationList,
	DEFAULT_SELECTED_STATION_ID,
	FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY,
	FAVORITE_STATIONS_STORAGE_KEY,
	FIP_STATION_CATALOG,
	getAdjacentStation,
	getStationById,
	persistFavoriteStations,
	persistSelectedStationId,
	readPersistedSelectedStationId,
	validateSelectedStation,
	type StorageAdapter,
} from '../src/lib/station-catalog';

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

assertEqual(FIP_STATION_CATALOG.length, 11, 'catalog keeps all FIP stations');
assertEqual(
	new Set(FIP_STATION_CATALOG.map((station) => station.id)).size,
	FIP_STATION_CATALOG.length,
	'catalog station identities are unique',
);
assertEqual(
	FIP_STATION_CATALOG.map((station) => station.name).join('|'),
	'FIP|FIP Rock|FIP Jazz|FIP Groove|FIP Monde|FIP Nouveautés|FIP Reggae|FIP Electro|FIP Metal|FIP Pop|FIP Hip-Hop',
	'catalog order remains stable',
);
for (const station of FIP_STATION_CATALOG) {
	assert(station.name && station.tag && station.shortName, 'station has display data');
	assert(station.streamUrl.startsWith('https://'), 'station has a stream URL');
	assert(station.number && station.apiStation === station.id, 'station has provider identity');
}
assertEqual(
	FIP_STATION_CATALOG.filter((station) => station.favorite)
		.map((station) => station.id)
		.join('|'),
	'FIP_GROOVE|FIP_NOUVEAUTES',
	'default favorites remain unchanged',
);
assertEqual(DEFAULT_SELECTED_STATION_ID, 'FIP_NOUVEAUTES', 'default station remains unchanged');
assertEqual(
	getAdjacentStation('FIP', -1).id,
	'FIP_HIP_HOP',
	'previous navigation wraps at the beginning',
);
assertEqual(getAdjacentStation('FIP_HIP_HOP', 1).id, 'FIP', 'next navigation wraps at the end');
assertEqual(
	validateSelectedStation('stale-value').id,
	DEFAULT_SELECTED_STATION_ID,
	'stale selection uses default',
);
assertEqual(getStationById(' FIP_ROCK ')?.number, '64', 'known identity is trimmed');
assertEqual(
	validateSelectedStation('FIP Nouveautés').id,
	DEFAULT_SELECTED_STATION_ID,
	'legacy display-name selection resolves to the default identity',
);

{
	const storage = new MemoryStorage();
	const stations = createStationList();
	const restored = applyPersistedFavoriteStations(stations, storage);
	assertEqual(
		restored.find((station) => station.id === 'FIP_GROOVE')?.favorite,
		true,
		'defaults restore without preferences',
	);

	const changed = createStationList();
	changed.find((station) => station.id === 'FIP_ROCK')!.favorite = true;
	changed.find((station) => station.id === 'FIP_GROOVE')!.favorite = false;
	persistFavoriteStations(changed, storage);
	const reloaded = applyPersistedFavoriteStations(createStationList(), storage);
	assertEqual(
		reloaded.find((station) => station.id === 'FIP_ROCK')?.favorite,
		true,
		'saved favorite restores',
	);
	assertEqual(
		reloaded.find((station) => station.id === 'FIP_GROOVE')?.favorite,
		false,
		'removed favorite stays removed',
	);

	for (const station of changed) station.favorite = false;
	persistFavoriteStations(changed, storage);
	assertEqual(
		storage.getItem(FAVORITE_STATIONS_STORAGE_KEY),
		null,
		'empty favorites remove the names key',
	);
	assertEqual(
		storage.getItem(FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY),
		'true',
		'empty favorites keep the customized marker',
	);
	const empty = applyPersistedFavoriteStations(createStationList(), storage);
	assert(
		empty.every((station) => !station.favorite),
		'customized empty favorites stay empty',
	);

	persistSelectedStationId('FIP_ROCK', storage);
	assertEqual(
		readPersistedSelectedStationId(storage),
		'FIP_ROCK',
		'selected station persists by identity',
	);
	storage.setItem('frisson-selected-station', 'FIP Jazz');
	assertEqual(
		readPersistedSelectedStationId(storage),
		'FIP_JAZZ',
		'selected station reads legacy display names',
	);
}
