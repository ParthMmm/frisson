import type { CurrentTrack } from './api';
import type { PlaybackState } from './player-session';
import type { StationCatalogEntry, StorageAdapter } from './station-catalog';

export const LASTFM_USERNAME_STORAGE_KEY = 'frisson-lastfm-username-v1';
export const LASTFM_QUEUE_STORAGE_KEY = 'frisson-lastfm-queue-v1';
export const LASTFM_AUTH_START_PATH = '/api/lastfm/auth/start';
export const LASTFM_QUEUE_LIMIT = 50;
export const LASTFM_MIN_TRACK_SECONDS = 30;
export const LASTFM_MAX_LISTEN_BEFORE_SCROBBLE_SECONDS = 4 * 60;

const LASTFM_SUBMITTED_RING_LIMIT = 64;

export type LastFmAuthStatus = 'unknown' | 'disconnected' | 'connected' | 'expired';

export type LastFmScrobblerSnapshot = {
	status: LastFmAuthStatus;
	username: string | null;
	pendingCount: number;
};

export type LastFmPublicSession = {
	connected: boolean;
	username: string | null;
};

export type LastFmWriteTrack = {
	title: string;
	artist: string;
	album: string;
	durationSeconds: number | null;
};

export type LastFmScrobbleSubmission = LastFmWriteTrack & {
	/** Unix seconds when the listen crossed the scrobble threshold. */
	listenedAt: number;
};

export type LastFmWriteResult =
	| { ok: true }
	| { ok: false; retryable: boolean; invalidSession: boolean };

export interface LastFmScrobbleTransport {
	getSession(): Promise<LastFmPublicSession>;
	disconnect(): Promise<void>;
	updateNowPlaying(track: LastFmWriteTrack): Promise<LastFmWriteResult>;
	scrobble(submission: LastFmScrobbleSubmission): Promise<LastFmWriteResult>;
}

export interface LastFmScrobblerOptions {
	storage?: StorageAdapter;
	transport: LastFmScrobbleTransport;
	redirect: (url: string) => void;
	now?: () => number;
	timers?: Partial<LastFmScrobblerTimers>;
	authStartUrl?: string;
	/** pagehide + online. If omitted, the page must call dispose() itself on teardown. */
	lifecycle?: LastFmLifecycle;
}

export interface LastFmScrobblerTimers {
	setTimeout(callback: () => void, delayMs: number): number;
	clearTimeout(timer: number): void;
}

export interface LastFmLifecycle {
	addEventListener(type: 'pagehide' | 'online', listener: () => void): void;
	removeEventListener(type: 'pagehide' | 'online', listener: () => void): void;
}

export type LastFmNotifyInput = {
	track: CurrentTrack | null;
	station: StationCatalogEntry;
	playbackState: PlaybackState;
};

export interface LastFmScrobblerController {
	getState(): LastFmScrobblerSnapshot;
	subscribe(listener: (state: LastFmScrobblerSnapshot) => void): () => void;
	hydrate(): Promise<void>;
	notify(input: LastFmNotifyInput): void;
	connect(): void;
	disconnect(): Promise<void>;
	dispose(): void;
}

type LastFmQueuedScrobble = LastFmScrobbleSubmission & { identity: string };

type ListenWindow = {
	identity: string;
	track: CurrentTrack;
	stationId: string;
	accumulatedMs: number;
	runningSinceMs: number | null;
	nowPlayingSent: boolean;
	submitted: boolean;
	listenedAt: number | null;
};

const defaultTimers: LastFmScrobblerTimers = {
	setTimeout: (callback, delayMs) => setTimeout(callback, delayMs) as unknown as number,
	clearTimeout: (timer) => clearTimeout(timer),
};

export function getListenIdentity(
	track: Pick<CurrentTrack, 'id' | 'start'>,
	station: { id: string },
): string {
	return `${station.id}:${track.id}:${track.start}`;
}

/**
 * Seconds of accrued listening required before a scrobble.
 * `null` means do not scrobble (known duration <= 30s).
 * Unknown / invalid duration (`end <= start` or missing) uses the 4-minute rule only.
 */
export function getScrobbleThresholdSeconds(durationSeconds: number | null): number | null {
	if (durationSeconds === null || !Number.isFinite(durationSeconds) || durationSeconds <= 0) {
		return LASTFM_MAX_LISTEN_BEFORE_SCROBBLE_SECONDS;
	}
	if (durationSeconds <= LASTFM_MIN_TRACK_SECONDS) return null;
	return Math.min(durationSeconds / 2, LASTFM_MAX_LISTEN_BEFORE_SCROBBLE_SECONDS);
}

export function getTrackDurationSeconds(track: Pick<CurrentTrack, 'start' | 'end'>): number | null {
	if (track.start <= 0 || track.end <= track.start) return null;
	return track.end - track.start;
}

export function createLastFmScrobbler(options: LastFmScrobblerOptions): LastFmScrobblerController {
	const now = options.now ?? (() => Date.now());
	const storage = options.storage;
	const timers: LastFmScrobblerTimers = { ...defaultTimers, ...options.timers };
	const authStartUrl = options.authStartUrl ?? LASTFM_AUTH_START_PATH;
	const lifecycle = options.lifecycle;

	let status: LastFmAuthStatus = 'unknown';
	let username: string | null = readCachedUsername(storage);
	let pending: LastFmQueuedScrobble[] = [];
	let submittedIdentities: string[] = [];
	let listenWindow: ListenWindow | null = null;
	let thresholdTimer: number | null = null;
	let draining = false;
	let disposed = false;
	let lifecycleBound = false;
	const listeners = new Set<(state: LastFmScrobblerSnapshot) => void>();

	function getState(): LastFmScrobblerSnapshot {
		return {
			status,
			username,
			pendingCount: pending.length,
		};
	}

	function emitState() {
		if (disposed) return;
		const snapshot = getState();
		for (const listener of listeners) listener(snapshot);
	}

	function persistUsername(value: string | null) {
		if (!storage) return;
		try {
			if (value && value.length > 0) storage.setItem(LASTFM_USERNAME_STORAGE_KEY, value);
			else storage.removeItem(LASTFM_USERNAME_STORAGE_KEY);
		} catch {
			// Private browsing and storage quota failures are non-fatal.
		}
	}

	function persistQueue() {
		if (!storage) return;
		try {
			storage.setItem(
				LASTFM_QUEUE_STORAGE_KEY,
				JSON.stringify({
					pending,
					submitted: submittedIdentities,
				}),
			);
		} catch {
			// Private browsing and storage quota failures are non-fatal.
		}
	}

	function loadQueueFromStorage() {
		if (!storage) return;
		try {
			const stored = storage.getItem(LASTFM_QUEUE_STORAGE_KEY);
			if (!stored) return;
			const parsed: unknown = JSON.parse(stored);
			if (!parsed || typeof parsed !== 'object') return;
			const record = parsed as Record<string, unknown>;
			const nextPending = Array.isArray(record.pending)
				? record.pending.filter(isQueuedScrobble)
				: [];
			const seen = new Set<string>();
			pending = nextPending
				.filter((item) => {
					if (seen.has(item.identity)) return false;
					seen.add(item.identity);
					return true;
				})
				.slice(-LASTFM_QUEUE_LIMIT);
			submittedIdentities = Array.isArray(record.submitted)
				? record.submitted
						.filter((value): value is string => typeof value === 'string' && value.length > 0)
						.slice(-LASTFM_SUBMITTED_RING_LIMIT)
				: [];
		} catch {
			pending = [];
			submittedIdentities = [];
		}
	}

	function rememberSubmitted(identity: string) {
		submittedIdentities = submittedIdentities.filter((value) => value !== identity);
		submittedIdentities.push(identity);
		if (submittedIdentities.length > LASTFM_SUBMITTED_RING_LIMIT) {
			submittedIdentities = submittedIdentities.slice(-LASTFM_SUBMITTED_RING_LIMIT);
		}
	}

	function canEnqueue() {
		return status === 'connected' || status === 'expired';
	}

	function accruedMs(target: ListenWindow) {
		if (target.runningSinceMs === null) return target.accumulatedMs;
		return target.accumulatedMs + (now() - target.runningSinceMs);
	}

	function freezeWindow() {
		if (!listenWindow || listenWindow.runningSinceMs === null) return;
		listenWindow.accumulatedMs += now() - listenWindow.runningSinceMs;
		listenWindow.runningSinceMs = null;
	}

	function clearThresholdTimer() {
		if (thresholdTimer === null) return;
		timers.clearTimeout(thresholdTimer);
		thresholdTimer = null;
	}

	function toWriteTrack(track: CurrentTrack): LastFmWriteTrack {
		return {
			title: track.title,
			artist: track.artist,
			album: track.album,
			durationSeconds: getTrackDurationSeconds(track),
		};
	}

	function enqueue(item: LastFmQueuedScrobble) {
		if (pending.some((queued) => queued.identity === item.identity)) return;
		pending = [...pending, item].slice(-LASTFM_QUEUE_LIMIT);
		persistQueue();
		emitState();
	}

	function trySubmitWindow(target: ListenWindow) {
		if (target.submitted || !canEnqueue()) return;
		if (submittedIdentities.includes(target.identity)) {
			target.submitted = true;
			return;
		}
		const durationSeconds = getTrackDurationSeconds(target.track);
		const threshold = getScrobbleThresholdSeconds(durationSeconds);
		if (threshold === null) return;
		if (accruedMs(target) / 1000 < threshold) return;
		if (!hasTitleAndArtist(target.track)) return;

		target.submitted = true;
		target.listenedAt = target.listenedAt ?? Math.floor(now() / 1000);
		enqueue({
			identity: target.identity,
			title: target.track.title,
			artist: target.track.artist,
			album: target.track.album,
			durationSeconds,
			listenedAt: target.listenedAt,
		});
		void drain();
	}

	function scheduleThresholdTimer(target: ListenWindow) {
		clearThresholdTimer();
		if (target.submitted || !canEnqueue()) return;
		const threshold = getScrobbleThresholdSeconds(getTrackDurationSeconds(target.track));
		if (threshold === null) return;
		const remainingMs = threshold * 1000 - accruedMs(target);
		if (remainingMs <= 0) {
			trySubmitWindow(target);
			return;
		}
		thresholdTimer = timers.setTimeout(() => {
			thresholdTimer = null;
			if (disposed || listenWindow !== target) return;
			trySubmitWindow(target);
		}, remainingMs);
	}

	function startAccrual(target: ListenWindow) {
		if (target.runningSinceMs === null) target.runningSinceMs = now();
		scheduleThresholdTimer(target);
	}

	function closeWindow() {
		if (!listenWindow) return;
		const closing = listenWindow;
		freezeWindow();
		clearThresholdTimer();
		listenWindow = null;
		trySubmitWindow(closing);
	}

	async function sendNowPlaying(target: ListenWindow) {
		if (target.nowPlayingSent || status !== 'connected' || disposed) return;
		target.nowPlayingSent = true;
		try {
			const result = await options.transport.updateNowPlaying(toWriteTrack(target.track));
			if (disposed) return;
			if (!result.ok && result.invalidSession) {
				status = 'expired';
				emitState();
			}
		} catch {
			// Now-playing is best-effort; the identity is already marked sent.
		}
	}

	async function drain() {
		if (draining || disposed || status !== 'connected') return;
		draining = true;
		try {
			while (pending.length > 0 && !disposed && status === 'connected') {
				const head = pending[0];
				if (!head || !head.title.trim() || !head.artist.trim()) {
					pending = pending.slice(1);
					persistQueue();
					emitState();
					continue;
				}

				let result: LastFmWriteResult;
				try {
					result = await options.transport.scrobble({
						title: head.title,
						artist: head.artist,
						album: head.album,
						durationSeconds: head.durationSeconds,
						listenedAt: head.listenedAt,
					});
				} catch {
					result = { ok: false, retryable: true, invalidSession: false };
				}

				if (disposed) return;

				if (result.ok) {
					pending = pending.slice(1);
					rememberSubmitted(head.identity);
					persistQueue();
					emitState();
					continue;
				}

				if (result.invalidSession) {
					status = 'expired';
					persistQueue();
					emitState();
					return;
				}

				if (result.retryable) {
					persistQueue();
					return;
				}

				pending = pending.slice(1);
				persistQueue();
				emitState();
			}
		} finally {
			draining = false;
		}
	}

	function onPageHide() {
		closeWindow();
		persistQueue();
	}

	function onOnline() {
		void drain();
	}

	function bindLifecycle() {
		if (lifecycleBound || !lifecycle) return;
		lifecycleBound = true;
		lifecycle.addEventListener('pagehide', onPageHide);
		lifecycle.addEventListener('online', onOnline);
	}

	function unbindLifecycle() {
		if (!lifecycleBound || !lifecycle) return;
		lifecycleBound = false;
		lifecycle.removeEventListener('pagehide', onPageHide);
		lifecycle.removeEventListener('online', onOnline);
	}

	async function hydrate() {
		if (disposed) return;
		loadQueueFromStorage();
		emitState();
		bindLifecycle();
		try {
			const session = await options.transport.getSession();
			if (disposed) return;
			if (session.connected) {
				status = 'connected';
				username = session.username;
				persistUsername(username);
			} else {
				status = 'disconnected';
				username = null;
				persistUsername(null);
			}
			emitState();
			if (listenWindow && status === 'connected') {
				void sendNowPlaying(listenWindow);
				trySubmitWindow(listenWindow);
			}
			await drain();
		} catch {
			emitState();
		}
	}

	function notify(input: LastFmNotifyInput) {
		if (disposed) return;
		const identity = input.track ? getListenIdentity(input.track, input.station) : null;

		if (listenWindow && listenWindow.identity !== identity) closeWindow();
		if (!input.track || !identity) return;
		if (!hasTitleAndArtist(input.track)) return;

		if (!listenWindow) {
			listenWindow = {
				identity,
				track: { ...input.track },
				stationId: input.station.id,
				accumulatedMs: 0,
				runningSinceMs: null,
				nowPlayingSent: false,
				submitted: submittedIdentities.includes(identity),
				listenedAt: null,
			};
		} else {
			listenWindow.track = { ...input.track };
		}

		if (input.playbackState === 'playing') {
			void sendNowPlaying(listenWindow);
			startAccrual(listenWindow);
			return;
		}

		freezeWindow();
		clearThresholdTimer();
	}

	function connect() {
		if (disposed) return;
		options.redirect(authStartUrl);
	}

	async function disconnect() {
		if (disposed) return;
		await options.transport.disconnect();
		if (disposed) return;
		status = 'disconnected';
		username = null;
		pending = [];
		persistUsername(null);
		persistQueue();
		clearThresholdTimer();
		emitState();
	}

	function dispose() {
		if (disposed) return;
		closeWindow();
		unbindLifecycle();
		clearThresholdTimer();
		persistQueue();
		disposed = true;
		listeners.clear();
	}

	function subscribe(listener: (state: LastFmScrobblerSnapshot) => void) {
		if (disposed) return () => undefined;
		listeners.add(listener);
		listener(getState());
		return () => listeners.delete(listener);
	}

	return {
		getState,
		subscribe,
		hydrate,
		notify,
		connect,
		disconnect,
		dispose,
	};
}

function readCachedUsername(storage: StorageAdapter | undefined): string | null {
	if (!storage) return null;
	try {
		const value = storage.getItem(LASTFM_USERNAME_STORAGE_KEY);
		return value && value.length > 0 ? value : null;
	} catch {
		return null;
	}
}

function hasTitleAndArtist(track: Pick<CurrentTrack, 'title' | 'artist'>) {
	return track.title.trim().length > 0 && track.artist.trim().length > 0;
}

function isQueuedScrobble(value: unknown): value is LastFmQueuedScrobble {
	if (!value || typeof value !== 'object') return false;
	const item = value as Record<string, unknown>;
	return (
		typeof item.identity === 'string' &&
		item.identity.length > 0 &&
		typeof item.title === 'string' &&
		typeof item.artist === 'string' &&
		typeof item.album === 'string' &&
		(item.durationSeconds === null ||
			(typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds))) &&
		typeof item.listenedAt === 'number' &&
		Number.isFinite(item.listenedAt)
	);
}
