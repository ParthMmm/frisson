import type { CurrentTrack } from './api';
import { isAbortError } from './errors';
import {
	getCurrentTrackCacheExpiresAt,
	getMetadataFailureState,
	getMetadataRefreshDelay,
	type MetadataState,
} from './metadata-refresh';
import {
	createPlaybackRecovery,
	type PlaybackRecoveryAudio,
	type PlaybackRecoveryController,
} from './playback-recovery';
import {
	getAdjacentStation,
	getDefaultStation,
	resolveStation,
	type StationCatalogEntry,
} from './station-catalog';

export const METADATA_SAFETY_POLL_MS = 120_000;

export type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
export type PlayerAudioEvent = 'playing' | 'waiting' | 'stalled' | 'pause' | 'error';

export interface PlayerAudioAdapter {
	getSnapshot(): PlaybackRecoveryAudio | null | undefined;
	play(): Promise<void>;
	pause(): void;
	load(): void;
	setVolume?(volume: number): void;
}

export interface PlayerSessionTimers {
	setTimeout(callback: () => void, delayMs: number): number;
	clearTimeout(timer: number): void;
	setInterval(callback: () => void, delayMs: number): number;
	clearInterval(timer: number): void;
}

export interface PlayerSessionHistory {
	record(track: CurrentTrack, station: StationCatalogEntry): unknown;
}

export type PlayerSessionState = {
	selectedStationId: string;
	selectedStation: StationCatalogEntry;
	playbackState: PlaybackState;
	playbackError: string;
	shareMessage: string;
	currentTrack: CurrentTrack | null;
	metadataState: MetadataState;
	isPlaybackRecoveryPending: boolean;
};

export interface PlayerSessionOptions {
	initialStationId?: unknown;
	fetchCurrentTrack: (
		station: StationCatalogEntry,
		signal: AbortSignal,
	) => Promise<CurrentTrack | null>;
	audio: () => PlayerAudioAdapter | null | undefined;
	history?: PlayerSessionHistory;
	persistSelectedStation?: (stationId: string) => void;
	waitForStationUpdate?: () => Promise<unknown>;
	getVolume?: () => number;
	now?: () => number;
	timers?: Partial<PlayerSessionTimers>;
}

export interface PlayerSessionController {
	getState(): PlayerSessionState;
	subscribe(listener: (state: PlayerSessionState) => void): () => void;
	start(selectedStationId?: unknown): void;
	initialize(selectedStationId?: unknown): void;
	loadCurrentTrack(station?: StationCatalogEntry | string): Promise<void>;
	selectStation(station?: StationCatalogEntry | string): Promise<void>;
	selectAdjacentStation(direction: -1 | 1): Promise<void>;
	play(options?: { reload?: boolean }): Promise<void>;
	pause(): void;
	togglePlayback(): void;
	notePlaybackInterrupted(): void;
	handleAudioEvent(event: PlayerAudioEvent): void;
	setShareMessage(message: string): void;
	dispose(): void;
}

type CachedCurrentTrack = {
	track: CurrentTrack | null;
	expiresAt: number;
};

const defaultTimers: PlayerSessionTimers = {
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
	clearTimeout: (timer) => clearTimeout(timer),
	setInterval: (callback, delayMs) => setInterval(callback, delayMs) as unknown as number,
	clearInterval: (timer) => clearInterval(timer),
};

export function createPlayerSession(options: PlayerSessionOptions): PlayerSessionController {
	const now = options.now ?? (() => Date.now());
	const timers: PlayerSessionTimers = { ...defaultTimers, ...options.timers };
	const initialStation = resolveStation(options.initialStationId) ?? getDefaultStation();
	let state: PlayerSessionState = {
		selectedStationId: initialStation.id,
		selectedStation: initialStation,
		playbackState: 'idle',
		playbackError: '',
		shareMessage: '',
		currentTrack: null,
		metadataState: 'idle',
		isPlaybackRecoveryPending: false,
	};
	let disposed = false;
	let started = false;
	let currentTrackRequest: AbortController | null = null;
	let currentTrackRequestId = 0;
	let metadataPoll: number | null = null;
	let metadataRefreshTimeout: number | null = null;
	let playRequestId = 0;
	let stationSelectionRequestId = 0;
	const currentTrackCache = new Map<string, CachedCurrentTrack>();
	const listeners = new Set<(nextState: PlayerSessionState) => void>();
	let playbackRecovery: PlaybackRecoveryController | null = null;

	function getState() {
		return state;
	}

	function emit(patch: Partial<PlayerSessionState>) {
		if (disposed) return;
		state = { ...state, ...patch };
		if (state.currentTrack && isPlaybackExpected()) {
			options.history?.record(state.currentTrack, state.selectedStation);
		}
		for (const listener of listeners) listener(state);
	}

	function isPlaybackExpected() {
		return state.playbackState === 'playing' || state.playbackState === 'loading';
	}

	function clearNextMetadataRefresh() {
		if (metadataRefreshTimeout === null) return;
		timers.clearTimeout(metadataRefreshTimeout);
		metadataRefreshTimeout = null;
	}

	function scheduleNextMetadataRefresh(station: StationCatalogEntry, track: CurrentTrack | null) {
		clearNextMetadataRefresh();
		const delay = getMetadataRefreshDelay(now(), track?.end);
		metadataRefreshTimeout = timers.setTimeout(() => {
			metadataRefreshTimeout = null;
			if (station.id !== state.selectedStationId || disposed) return;
			void loadCurrentTrack(station);
		}, delay);
	}

	function readCachedCurrentTrack(station: StationCatalogEntry) {
		const cached = currentTrackCache.get(station.id);
		if (!cached) return false;
		if (now() >= cached.expiresAt) {
			currentTrackCache.delete(station.id);
			return false;
		}

		emit({ currentTrack: cached.track, metadataState: 'ready' });
		scheduleNextMetadataRefresh(station, cached.track);
		return true;
	}

	function cacheCurrentTrack(station: StationCatalogEntry, track: CurrentTrack | null) {
		currentTrackCache.set(station.id, {
			track,
			expiresAt: getCurrentTrackCacheExpiresAt(now(), track?.end),
		});
	}

	function isCurrentTrackRequest(station: StationCatalogEntry, requestId: number) {
		return (
			!disposed && requestId === currentTrackRequestId && station.id === state.selectedStationId
		);
	}

	async function loadCurrentTrack(
		stationInput: StationCatalogEntry | string = state.selectedStationId,
	) {
		const station = resolveStation(stationInput);
		if (!station || station.id !== state.selectedStationId || disposed) return;

		const requestId = ++currentTrackRequestId;
		currentTrackRequest?.abort();
		currentTrackRequest = null;

		if (readCachedCurrentTrack(station)) return;

		const controller = new AbortController();
		currentTrackRequest = controller;
		if (!state.currentTrack) emit({ metadataState: 'loading' });

		try {
			const track = await options.fetchCurrentTrack(station, controller.signal);
			if (controller.signal.aborted || !isCurrentTrackRequest(station, requestId)) return;

			emit({ currentTrack: track, metadataState: 'ready' });
			cacheCurrentTrack(station, track);
			scheduleNextMetadataRefresh(station, track);
		} catch (cause) {
			if (isAbortError(cause)) return;
			if (controller.signal.aborted || !isCurrentTrackRequest(station, requestId)) return;

			emit({ metadataState: getMetadataFailureState(state.currentTrack !== null) });
			scheduleNextMetadataRefresh(station, state.currentTrack);
		} finally {
			if (currentTrackRequest === controller) currentTrackRequest = null;
		}
	}

	async function play({ reload = false }: { reload?: boolean } = {}) {
		const audio = options.audio();
		if (!audio || disposed) return;

		const requestId = ++playRequestId;
		emit({ playbackState: 'loading', playbackError: '' });
		if (options.getVolume) audio.setVolume?.(options.getVolume() / 100);
		if (reload) audio.load();

		try {
			await audio.play();
			if (requestId === playRequestId && !disposed) emit({ playbackState: 'playing' });
		} catch {
			if (requestId !== playRequestId || disposed) return;

			emit({
				playbackState: 'error',
				playbackError: 'Playback was blocked or the stream is unavailable.',
			});
			playbackRecovery?.notePlaybackStopped();
		}
	}

	function pause() {
		playRequestId += 1;
		options.audio()?.pause();
		emit({ playbackState: 'paused' });
		playbackRecovery?.notePlaybackStopped();
	}

	function togglePlayback() {
		if (isPlaybackExpected()) {
			pause();
			return;
		}
		void play();
	}

	function notePlaybackInterrupted() {
		if (!isPlaybackExpected()) return;
		emit({ playbackState: 'loading' });
		playbackRecovery?.notePlaybackInterrupted();
	}

	function handleAudioEvent(event: PlayerAudioEvent) {
		switch (event) {
			case 'playing':
				emit({ playbackState: 'playing', playbackError: '' });
				playbackRecovery?.notePlaybackHealthy();
				break;
			case 'waiting':
			case 'stalled':
				notePlaybackInterrupted();
				break;
			case 'pause':
				if (state.playbackState !== 'error') emit({ playbackState: 'paused' });
				playbackRecovery?.notePlaybackStopped();
				break;
			case 'error':
				emit({
					playbackState: 'error',
					playbackError: 'The selected FIP stream could not be loaded.',
				});
				playbackRecovery?.notePlaybackStopped();
				break;
		}
	}

	async function selectStation(stationInput?: StationCatalogEntry | string) {
		const station = resolveStation(stationInput);
		if (!station) return;

		if (station.id === state.selectedStationId) {
			if (!isPlaybackExpected()) void play();
			return;
		}

		const selectionRequestId = ++stationSelectionRequestId;
		playRequestId += 1;
		playbackRecovery?.notePlaybackStopped();
		clearNextMetadataRefresh();
		currentTrackRequest?.abort();
		currentTrackRequest = null;
		emit({
			selectedStationId: station.id,
			selectedStation: station,
			playbackError: '',
			shareMessage: '',
			currentTrack: null,
			metadataState: 'loading',
			playbackState: 'loading',
		});
		options.persistSelectedStation?.(station.id);
		void loadCurrentTrack(station);

		await options.waitForStationUpdate?.();
		if (
			disposed ||
			selectionRequestId !== stationSelectionRequestId ||
			state.selectedStationId !== station.id
		) {
			return;
		}
		await play({ reload: true });
	}

	async function selectAdjacentStation(direction: -1 | 1) {
		return selectStation(getAdjacentStation(state.selectedStationId, direction));
	}

	function start(selectedStationId?: unknown) {
		if (started || disposed) return;
		started = true;
		const station = resolveStation(selectedStationId) ?? state.selectedStation;
		if (station.id !== state.selectedStationId) {
			emit({
				selectedStationId: station.id,
				selectedStation: station,
			});
		}
		playbackRecovery = createPlaybackRecovery({
			audio: () => options.audio()?.getSnapshot(),
			isPlaybackExpected,
			recover: () => play({ reload: true }),
			onRecoveryPendingChange: (isRecoveryPending) => {
				emit({ isPlaybackRecoveryPending: isRecoveryPending });
			},
			setTimer: timers.setTimeout,
			clearTimer: timers.clearTimeout,
		});
		metadataPoll = timers.setInterval(() => {
			void loadCurrentTrack(state.selectedStation);
		}, METADATA_SAFETY_POLL_MS);
		void loadCurrentTrack(state.selectedStation);
	}

	function subscribe(listener: (nextState: PlayerSessionState) => void) {
		if (disposed) return () => undefined;
		listeners.add(listener);
		listener(state);
		return () => listeners.delete(listener);
	}

	function setShareMessage(message: string) {
		emit({ shareMessage: message });
	}

	function dispose() {
		if (disposed) return;
		disposed = true;
		currentTrackRequest?.abort();
		currentTrackRequest = null;
		if (metadataPoll !== null) timers.clearInterval(metadataPoll);
		metadataPoll = null;
		clearNextMetadataRefresh();
		playbackRecovery?.dispose();
		playbackRecovery = null;
		listeners.clear();
	}

	const controller: PlayerSessionController = {
		getState,
		subscribe,
		start,
		initialize: start,
		loadCurrentTrack,
		selectStation,
		selectAdjacentStation,
		play,
		pause,
		togglePlayback,
		notePlaybackInterrupted,
		handleAudioEvent,
		setShareMessage,
		dispose,
	};

	return controller;
}

export const createFipPlayerSession = createPlayerSession;
