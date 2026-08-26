import type { CurrentTrack } from './api';
import { normalizeTrackText } from './text';
import type { StorageAdapter } from './station-catalog';

export const LISTENING_HISTORY_LIMIT = 30;
export const LISTENING_HISTORY_STORAGE_KEY = 'frisson-listening-history-v1';
export const LEGACY_LISTENING_HISTORY_STORAGE_KEY = 'fip-listening-history-v1';
export const APPLE_MUSIC_URL_CACHE_LIMIT = 128;

export type ListeningHistoryItem = {
	id: string;
	title: string;
	artist: string;
	artworkUrl: string | null;
	appleMusicUrl: string | null;
	isAppleMusicLookupLoading: boolean;
	/** Persisted so an in-flight null is not mistaken for a completed no-match. */
	appleMusicLookupState?: AppleMusicLookupStatus;
	stationName: string;
	stationTag: string;
	listenedAt: number;
};

export type ListeningHistoryStation = {
	id?: string;
	apiStation?: string;
	name: string;
	tag: string;
};

export type AppleMusicLookupStatus = 'unknown' | 'loading' | 'matched' | 'no-match';

export type AppleMusicLookupState = {
	status: AppleMusicLookupStatus;
	url: string | null;
};

export type ListeningHistorySnapshot = {
	items: ListeningHistoryItem[];
	revision: number;
};

export type AppleMusicLookupFetcher = (
	track: Pick<CurrentTrack, 'title' | 'artist'>,
) => Promise<string | null>;

export interface ListeningHistoryOptions {
	storage?: StorageAdapter;
	lookupAppleMusicUrl?: AppleMusicLookupFetcher;
	/** Compatibility name for callers that model this as an external fetch adapter. */
	fetchAppleMusicUrl?: AppleMusicLookupFetcher;
	limit?: number;
	now?: () => number;
	loadOnCreate?: boolean;
}

export interface ListeningHistoryController {
	getState(): ListeningHistorySnapshot;
	getItems(): ListeningHistoryItem[];
	subscribe(listener: (state: ListeningHistorySnapshot) => void): () => void;
	load(storage?: StorageAdapter): ListeningHistoryItem[];
	clear(): void;
	record(track: CurrentTrack, station: ListeningHistoryStation): ListeningHistoryItem | null;
	lookupAppleMusicUrl(track: Pick<CurrentTrack, 'title' | 'artist'>): Promise<string | null>;
	lookupAppleMusic(track: Pick<CurrentTrack, 'title' | 'artist'>): Promise<string | null>;
	getAppleMusicLookupState(track: Pick<CurrentTrack, 'title' | 'artist'>): AppleMusicLookupState;
	hasNoAppleMusicMatch(track: Pick<CurrentTrack, 'title' | 'artist'> | null): boolean;
	getAppleMusicMode(track: Pick<CurrentTrack, 'title' | 'artist'> | null): 'button' | 'none';
	dispose(): void;
}

export function getAppleMusicLookupKey(track: Pick<CurrentTrack, 'title' | 'artist'>) {
	return `${normalizeTrackText(track.title)}:${normalizeTrackText(track.artist)}`;
}

export function isListeningHistoryItem(value: unknown): value is ListeningHistoryItem {
	if (!value || typeof value !== 'object') return false;

	const item = value as Record<string, unknown>;
	return (
		typeof item.id === 'string' &&
		item.id.length > 0 &&
		typeof item.title === 'string' &&
		typeof item.artist === 'string' &&
		(item.artworkUrl === null || typeof item.artworkUrl === 'string') &&
		(item.appleMusicUrl === null || typeof item.appleMusicUrl === 'string') &&
		(item.isAppleMusicLookupLoading === undefined ||
			typeof item.isAppleMusicLookupLoading === 'boolean') &&
		(item.appleMusicLookupState === undefined ||
			item.appleMusicLookupState === 'unknown' ||
			item.appleMusicLookupState === 'loading' ||
			item.appleMusicLookupState === 'matched' ||
			item.appleMusicLookupState === 'no-match') &&
		typeof item.stationName === 'string' &&
		typeof item.stationTag === 'string' &&
		typeof item.listenedAt === 'number' &&
		Number.isFinite(item.listenedAt)
	);
}

export function createListeningHistory(
	options: ListeningHistoryOptions = {},
): ListeningHistoryController {
	const limit = options.limit ?? LISTENING_HISTORY_LIMIT;
	let storage = options.storage;
	const lookupAppleMusicUrl = options.lookupAppleMusicUrl ?? options.fetchAppleMusicUrl;
	const now = options.now ?? (() => Date.now());
	let items: ListeningHistoryItem[] = [];
	let revision = 0;
	let disposed = false;
	const listeners = new Set<(state: ListeningHistorySnapshot) => void>();
	const appleMusicUrlCache = new Map<string, string | null>();
	const appleMusicUrlRequests = new Map<string, Promise<string | null>>();

	function getState(): ListeningHistorySnapshot {
		return {
			items: items.map((item) => ({ ...item })),
			revision,
		};
	}

	function notify() {
		if (disposed) return;
		revision += 1;
		const snapshot = getState();
		for (const listener of listeners) listener(snapshot);
	}

	function persist() {
		if (!storage) return;

		try {
			if (items.length === 0) {
				storage.removeItem(LISTENING_HISTORY_STORAGE_KEY);
				storage.removeItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
				return;
			}

			storage.setItem(LISTENING_HISTORY_STORAGE_KEY, JSON.stringify(items));
			storage.removeItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
		} catch {
			// Private browsing and storage quota failures are non-fatal history errors.
		}
	}

	function cacheAppleMusicUrl(key: string, url: string | null) {
		if (!appleMusicUrlCache.has(key) && appleMusicUrlCache.size >= APPLE_MUSIC_URL_CACHE_LIMIT) {
			const oldestKey = appleMusicUrlCache.keys().next().value;
			if (oldestKey !== undefined) appleMusicUrlCache.delete(oldestKey);
		}
		appleMusicUrlCache.set(key, url);
	}

	function normalizeLookupResult(url: string | null) {
		return typeof url === 'string' && url.length > 0 ? url : null;
	}

	function getAppleMusicLookupState(
		track: Pick<CurrentTrack, 'title' | 'artist'>,
	): AppleMusicLookupState {
		const key = getAppleMusicLookupKey(track);
		const cached = appleMusicUrlCache.get(key);
		if (appleMusicUrlCache.has(key)) {
			return cached === null
				? { status: 'no-match', url: null }
				: { status: 'matched', url: cached ?? null };
		}
		if (appleMusicUrlRequests.has(key)) return { status: 'loading', url: null };
		return { status: 'unknown', url: null };
	}

	function updateHistoryAppleMusicUrl(
		historyId: string,
		appleMusicUrl: string | null,
		isAppleMusicLookupLoading: boolean,
		appleMusicLookupState: AppleMusicLookupStatus = appleMusicUrl === null ? 'no-match' : 'matched',
	) {
		let changed = false;
		items = items.map((item) => {
			if (item.id !== historyId) return item;
			changed = true;
			return {
				...item,
				appleMusicUrl,
				isAppleMusicLookupLoading,
				appleMusicLookupState,
			};
		});
		if (!changed) return;
		persist();
		notify();
	}

	async function enrichHistoryItem(
		historyId: string,
		track: Pick<CurrentTrack, 'title' | 'artist'>,
		markLoading = false,
	) {
		if (markLoading) updateHistoryAppleMusicUrl(historyId, null, true, 'unknown');
		try {
			const url = await lookupAppleMusicUrlForTrack(track);
			updateHistoryAppleMusicUrl(historyId, url, false);
		} catch {
			updateHistoryAppleMusicUrl(historyId, null, false);
		}
	}

	function lookupAppleMusicUrlForTrack(
		track: Pick<CurrentTrack, 'title' | 'artist'>,
	): Promise<string | null> {
		const key = getAppleMusicLookupKey(track);
		if (appleMusicUrlCache.has(key)) return Promise.resolve(appleMusicUrlCache.get(key) ?? null);

		const pendingRequest = appleMusicUrlRequests.get(key);
		if (pendingRequest) return pendingRequest;
		if (!lookupAppleMusicUrl) {
			return Promise.reject(new Error('Apple Music lookup adapter is not configured'));
		}

		const request = lookupAppleMusicUrl(track)
			.then((url) => {
				const result = normalizeLookupResult(url);
				cacheAppleMusicUrl(key, result);
				notify();
				return result;
			})
			.catch((error: unknown) => {
				cacheAppleMusicUrl(key, null);
				notify();
				throw error;
			})
			.finally(() => {
				appleMusicUrlRequests.delete(key);
			});

		appleMusicUrlRequests.set(key, request);
		notify();
		return request;
	}

	function getPersistedAppleMusicLookupState(item: ListeningHistoryItem): AppleMusicLookupStatus {
		if (item.appleMusicLookupState === 'unknown' || item.appleMusicLookupState === 'loading') {
			return 'unknown';
		}
		if (item.appleMusicLookupState === 'matched' || item.appleMusicLookupState === 'no-match') {
			return item.appleMusicLookupState;
		}
		if (item.isAppleMusicLookupLoading) return 'unknown';
		return item.appleMusicUrl === null ? 'no-match' : 'matched';
	}

	function load(nextStorage = storage): ListeningHistoryItem[] {
		storage = nextStorage;
		let loaded: ListeningHistoryItem[] = [];
		if (nextStorage) {
			try {
				const stored =
					nextStorage.getItem(LISTENING_HISTORY_STORAGE_KEY) ??
					nextStorage.getItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
				if (stored) {
					const parsed: unknown = JSON.parse(stored);
					if (Array.isArray(parsed)) {
						const seenIds = new Set<string>();
						loaded = parsed
							.filter(isListeningHistoryItem)
							.filter((item) => {
								if (seenIds.has(item.id)) return false;
								seenIds.add(item.id);
								return true;
							})
							.map((item) => ({
								...item,
								appleMusicUrl: item.appleMusicUrl ?? null,
								isAppleMusicLookupLoading: false,
								appleMusicLookupState: getPersistedAppleMusicLookupState(item),
							}))
							.slice(0, limit);
					}
				}
			} catch {
				loaded = [];
			}
		}

		items = loaded;
		appleMusicUrlCache.clear();
		const unresolvedItems: ListeningHistoryItem[] = [];
		for (const item of items) {
			if (item.appleMusicLookupState === 'unknown') {
				unresolvedItems.push(item);
				continue;
			}
			cacheAppleMusicUrl(getAppleMusicLookupKey(item), item.appleMusicUrl);
		}
		persist();
		notify();
		if (lookupAppleMusicUrl && unresolvedItems.length > 0) {
			void Promise.resolve().then(() => {
				for (const item of unresolvedItems) {
					if (!disposed && items.some((currentItem) => currentItem.id === item.id)) {
						void enrichHistoryItem(item.id, item, true);
					}
				}
			});
		}
		return getItems();
	}

	function getItems() {
		return items.map((item) => ({ ...item }));
	}

	function record(
		track: CurrentTrack,
		station: ListeningHistoryStation,
	): ListeningHistoryItem | null {
		const stationIdentity = station.id || station.apiStation || station.name;
		const historyId = `${stationIdentity}:${track.id}:${track.start}`;
		if (items.some((item) => item.id === historyId)) return null;

		const lookupState = getAppleMusicLookupState(track);
		const item: ListeningHistoryItem = {
			id: historyId,
			title: track.title,
			artist: track.artist,
			artworkUrl: track.artworkUrl,
			appleMusicUrl: lookupState.url,
			isAppleMusicLookupLoading:
				lookupState.status === 'unknown' || lookupState.status === 'loading',
			appleMusicLookupState:
				lookupState.status === 'matched'
					? 'matched'
					: lookupState.status === 'no-match'
						? 'no-match'
						: 'unknown',
			stationName: station.name,
			stationTag: station.tag,
			listenedAt: now(),
		};

		items = [item, ...items].slice(0, limit);
		persist();
		notify();

		if (item.isAppleMusicLookupLoading) void enrichHistoryItem(historyId, track);
		return { ...item };
	}

	function clear() {
		items = [];
		persist();
		notify();
	}

	function subscribe(listener: (state: ListeningHistorySnapshot) => void) {
		if (disposed) return () => undefined;
		listeners.add(listener);
		listener(getState());
		return () => listeners.delete(listener);
	}

	function hasNoAppleMusicMatch(track: Pick<CurrentTrack, 'title' | 'artist'> | null) {
		return track !== null && getAppleMusicLookupState(track).status === 'no-match';
	}

	function getAppleMusicMode(track: Pick<CurrentTrack, 'title' | 'artist'> | null) {
		return track && !hasNoAppleMusicMatch(track) ? 'button' : 'none';
	}

	function dispose() {
		disposed = true;
		listeners.clear();
		appleMusicUrlRequests.clear();
	}

	const controller: ListeningHistoryController = {
		getState,
		getItems,
		subscribe,
		load,
		clear,
		record,
		lookupAppleMusicUrl: lookupAppleMusicUrlForTrack,
		lookupAppleMusic: lookupAppleMusicUrlForTrack,
		getAppleMusicLookupState,
		hasNoAppleMusicMatch,
		getAppleMusicMode,
		dispose,
	};

	if (options.loadOnCreate) load();
	return controller;
}

export const createListeningHistoryEnrichment = createListeningHistory;
export const createListeningHistoryModule = createListeningHistory;
