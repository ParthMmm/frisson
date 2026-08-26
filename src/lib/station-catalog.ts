export const FAVORITE_STATIONS_STORAGE_KEY = 'frisson-favorite-stations-v1';
export const FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY = 'frisson-favorite-stations-customized-v1';
export const SELECTED_STATION_STORAGE_KEY = 'frisson-selected-station';

export const DEFAULT_SELECTED_STATION_ID = 'FIP_NOUVEAUTES';

export type Station = {
	/** Stable catalog identity used by the player and Radio France GraphQL. */
	id: string;
	/** Compatibility alias for callers that used the old API station field. */
	apiStation: string;
	name: string;
	number: string;
	tag: string;
	shortName: string;
	streamUrl: string;
	favorite: boolean;
};

export type StationCatalogEntry = Readonly<Station>;

export interface StorageAdapter {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

const CATALOG: readonly StationCatalogEntry[] = [
	{
		id: 'FIP',
		apiStation: 'FIP',
		name: 'FIP',
		number: '7',
		tag: '105.1 MHZ',
		shortName: 'FIP',
		streamUrl: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
		favorite: false,
	},
	{
		id: 'FIP_ROCK',
		apiStation: 'FIP_ROCK',
		name: 'FIP Rock',
		number: '64',
		tag: 'ROCK',
		shortName: 'ROCK',
		streamUrl: 'https://icecast.radiofrance.fr/fiprock-midfi.mp3',
		favorite: false,
	},
	{
		id: 'FIP_JAZZ',
		apiStation: 'FIP_JAZZ',
		name: 'FIP Jazz',
		number: '65',
		tag: 'JAZZ',
		shortName: 'JAZZ',
		streamUrl: 'https://icecast.radiofrance.fr/fipjazz-midfi.mp3',
		favorite: false,
	},
	{
		id: 'FIP_GROOVE',
		apiStation: 'FIP_GROOVE',
		name: 'FIP Groove',
		number: '66',
		tag: 'GROOVE',
		shortName: 'GROOVE',
		streamUrl: 'https://icecast.radiofrance.fr/fipgroove-midfi.mp3',
		favorite: true,
	},
	{
		id: 'FIP_WORLD',
		apiStation: 'FIP_WORLD',
		name: 'FIP Monde',
		number: '69',
		tag: 'MONDE',
		shortName: 'MONDE',
		streamUrl: 'https://icecast.radiofrance.fr/fipworld-midfi.mp3',
		favorite: false,
	},
	{
		id: 'FIP_NOUVEAUTES',
		apiStation: 'FIP_NOUVEAUTES',
		name: 'FIP Nouveautés',
		number: '70',
		tag: 'NOUVEAUTÉS',
		shortName: 'NOUVO',
		streamUrl: 'https://icecast.radiofrance.fr/fipnouveautes-midfi.mp3',
		favorite: true,
	},
	{
		id: 'FIP_REGGAE',
		apiStation: 'FIP_REGGAE',
		name: 'FIP Reggae',
		number: '71',
		tag: 'REGGAE',
		shortName: 'REGGAE',
		streamUrl: 'https://icecast.radiofrance.fr/fipreggae-midfi.mp3',
		favorite: false,
	},
	{
		id: 'FIP_ELECTRO',
		apiStation: 'FIP_ELECTRO',
		name: 'FIP Electro',
		number: '74',
		tag: 'ELECTRO',
		shortName: 'ELECTRO',
		streamUrl: 'https://icecast.radiofrance.fr/fipelectro-midfi.mp3',
		favorite: false,
	},
	{
		id: 'FIP_METAL',
		apiStation: 'FIP_METAL',
		name: 'FIP Metal',
		number: '77',
		tag: 'METAL',
		shortName: 'METAL',
		streamUrl: 'https://icecast.radiofrance.fr/fipmetal-midfi.mp3',
		favorite: false,
	},
	{
		id: 'FIP_POP',
		apiStation: 'FIP_POP',
		name: 'FIP Pop',
		number: '78',
		tag: 'POP',
		shortName: 'POP',
		streamUrl: 'https://icecast.radiofrance.fr/fippop-midfi.mp3',
		favorite: false,
	},
	{
		id: 'FIP_HIP_HOP',
		apiStation: 'FIP_HIP_HOP',
		name: 'FIP Hip-Hop',
		number: '95',
		tag: 'HIP-HOP',
		shortName: 'HIP-HOP',
		streamUrl: 'https://icecast.radiofrance.fr/fiphiphop-midfi.mp3',
		favorite: false,
	},
];

/** The canonical station order used by the player, tuner, and API adapter. */
export const FIP_STATION_CATALOG = CATALOG;
export const FIP_STATIONS = FIP_STATION_CATALOG;
export const STATION_CATALOG = FIP_STATION_CATALOG;
export const stationCatalog = FIP_STATION_CATALOG;
export const stations = FIP_STATION_CATALOG;

export function createStationList(): Station[] {
	return FIP_STATION_CATALOG.map((station) => ({ ...station }));
}

export function getStationById(identity: unknown): StationCatalogEntry | null {
	if (typeof identity !== 'string') return null;
	return FIP_STATION_CATALOG.find((station) => station.id === identity.trim()) ?? null;
}

/** Resolve both the stable identity and the pre-catalog display-name format. */
export function resolveStation(identity: unknown): StationCatalogEntry | null {
	if (typeof identity === 'object' && identity !== null) {
		const candidate = identity as { id?: unknown; apiStation?: unknown; name?: unknown };
		return (
			getStationById(candidate.id) ??
			getStationById(candidate.apiStation) ??
			getStationByName(candidate.name)
		);
	}
	if (typeof identity !== 'string') return null;
	const value = identity.trim();
	return (
		FIP_STATION_CATALOG.find((station) => station.id === value) ??
		FIP_STATION_CATALOG.find((station) => station.name === value) ??
		null
	);
}

export const getStation = getStationById;
export const getStationByIdentity = getStationById;

export function getStationByName(name: unknown): StationCatalogEntry | null {
	if (typeof name !== 'string') return null;
	return FIP_STATION_CATALOG.find((station) => station.name === name.trim()) ?? null;
}

export function isKnownStationIdentity(identity: unknown): identity is string {
	return getStationById(identity) !== null;
}

export function validateSelectedStation(identity: unknown): StationCatalogEntry {
	return resolveStation(identity) ?? getDefaultStation();
}

export function getDefaultStation(): StationCatalogEntry {
	return getStationById(DEFAULT_SELECTED_STATION_ID) ?? FIP_STATION_CATALOG[0];
}

export const DEFAULT_SELECTED_STATION = getDefaultStation();

export function getAdjacentStation(identity: unknown, direction: -1 | 1): StationCatalogEntry {
	const current = resolveStation(identity) ?? getDefaultStation();
	const currentIndex = FIP_STATION_CATALOG.findIndex((station) => station.id === current.id);
	const nextIndex =
		(currentIndex + direction + FIP_STATION_CATALOG.length) % FIP_STATION_CATALOG.length;
	return FIP_STATION_CATALOG[nextIndex];
}

export const getAdjacent = getAdjacentStation;
export const resolveSelectedStation = validateSelectedStation;

export function applyPersistedFavoriteStations(
	stationList: readonly Station[],
	storage: StorageAdapter,
): Station[] {
	const next = stationList.map((station) => ({ ...station }));

	try {
		const stored = storage.getItem(FAVORITE_STATIONS_STORAGE_KEY);
		if (!stored) {
			if (storage.getItem(FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY)) {
				for (const station of next) station.favorite = false;
			}
			return next;
		}

		const parsed: unknown = JSON.parse(stored);
		if (!Array.isArray(parsed)) return next;

		const favoriteValues = new Set(
			parsed.filter((value): value is string => typeof value === 'string'),
		);
		for (const station of next) {
			station.favorite = favoriteValues.has(station.name) || favoriteValues.has(station.id);
		}
	} catch {
		// Private browsing, malformed data, and storage failures keep defaults.
	}

	return next;
}

export function persistFavoriteStations(
	stationList: readonly Station[],
	storage: StorageAdapter,
): void {
	try {
		const favoriteNames = stationList
			.filter((station) => station.favorite)
			.map((station) => station.name);

		if (favoriteNames.length === 0) {
			storage.removeItem(FAVORITE_STATIONS_STORAGE_KEY);
			storage.setItem(FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY, 'true');
			return;
		}

		storage.setItem(FAVORITE_STATIONS_STORAGE_KEY, JSON.stringify(favoriteNames));
		storage.setItem(FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY, 'true');
	} catch {
		// Private browsing and storage quota failures are non-fatal preferences errors.
	}
}

export function readPersistedSelectedStationId(storage: StorageAdapter): string | null {
	try {
		const stored = storage.getItem(SELECTED_STATION_STORAGE_KEY);
		return resolveStation(stored)?.id ?? null;
	} catch {
		return null;
	}
}

export function persistSelectedStationId(identity: string, storage: StorageAdapter): void {
	const station = getStationById(identity);
	if (!station) return;

	try {
		storage.setItem(SELECTED_STATION_STORAGE_KEY, station.id);
	} catch {
		// Private browsing and storage quota failures are non-fatal preferences errors.
	}
}
