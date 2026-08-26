import type { CurrentTrack } from '../src/lib/api';
import {
	createLastFmScrobbler,
	getListenIdentity,
	getScrobbleThresholdSeconds,
	getTrackDurationSeconds,
	LASTFM_AUTH_START_PATH,
	LASTFM_MAX_LISTEN_BEFORE_SCROBBLE_SECONDS,
	type LastFmLifecycle,
	type LastFmNotifyInput,
	type LastFmScrobbleSubmission,
	type LastFmScrobbleTransport,
	type LastFmScrobblerTimers,
	type LastFmWriteResult,
	type LastFmWriteTrack,
} from '../src/lib/lastfm-scrobbler';
import type { PlaybackState } from '../src/lib/player-session';
import { getStationById, type StorageAdapter } from '../src/lib/station-catalog';

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

class FakeTimers implements LastFmScrobblerTimers {
	now = 0;
	private nextId = 1;
	private timers = new Map<number, { dueAt: number; callback: () => void }>();

	setTimeout = (callback: () => void, delayMs: number) => {
		const id = this.nextId++;
		this.timers.set(id, { dueAt: this.now + delayMs, callback });
		return id;
	};

	clearTimeout = (id: number) => {
		this.timers.delete(id);
	};

	advanceBy(ms: number) {
		this.now += ms;
		let due: [number, { dueAt: number; callback: () => void }][];
		do {
			due = [...this.timers.entries()].filter(([, timer]) => timer.dueAt <= this.now);
			for (const [id, timer] of due) {
				if (!this.timers.has(id)) continue;
				this.timers.delete(id);
				timer.callback();
			}
		} while (due.length > 0);
	}

	advanceTimeOnly(ms: number) {
		this.now += ms;
	}
}

class FakeLifecycle implements LastFmLifecycle {
	private listeners = {
		pagehide: new Set<() => void>(),
		online: new Set<() => void>(),
	};

	addEventListener(type: 'pagehide' | 'online', listener: () => void) {
		this.listeners[type].add(listener);
	}

	removeEventListener(type: 'pagehide' | 'online', listener: () => void) {
		this.listeners[type].delete(listener);
	}

	fire(type: 'pagehide' | 'online') {
		for (const listener of this.listeners[type]) listener();
	}
}

class FakeTransport implements LastFmScrobbleTransport {
	nowPlaying: LastFmWriteTrack[] = [];
	scrobbles: LastFmScrobbleSubmission[] = [];
	session = { connected: true, username: 'tester' as string | null };
	scrobbleResult: LastFmWriteResult = { ok: true };
	nowPlayingResult: LastFmWriteResult = { ok: true };
	disconnectCalls = 0;

	getSession = async () => this.session;

	disconnect = async () => {
		this.disconnectCalls += 1;
		this.session = { connected: false, username: null };
	};

	updateNowPlaying = async (track: LastFmWriteTrack) => {
		this.nowPlaying.push(track);
		return this.nowPlayingResult;
	};

	scrobble = async (submission: LastFmScrobbleSubmission) => {
		this.scrobbles.push(submission);
		return this.scrobbleResult;
	};
}

const station = getStationById('FIP')!;

function makeTrack(overrides: Partial<CurrentTrack> = {}): CurrentTrack {
	return {
		id: 'song-1',
		title: 'Song One',
		artist: 'Artist',
		album: 'Album',
		year: 2024,
		artworkUrl: null,
		start: 1_000,
		end: 1_200,
		...overrides,
	};
}

function notifyInput(
	track: CurrentTrack | null,
	playbackState: PlaybackState = 'playing',
): LastFmNotifyInput {
	return { track, station, playbackState };
}

async function flush() {
	for (let index = 0; index < 16; index += 1) await Promise.resolve();
}

async function hydratedScrobbler(
	overrides: {
		storage?: StorageAdapter;
		transport?: FakeTransport;
		timers?: FakeTimers;
		lifecycle?: FakeLifecycle;
		redirect?: (url: string) => void;
	} = {},
) {
	const timers = overrides.timers ?? new FakeTimers();
	const transport = overrides.transport ?? new FakeTransport();
	const storage = overrides.storage ?? new MemoryStorage();
	const scrobbler = createLastFmScrobbler({
		storage,
		transport,
		redirect: overrides.redirect ?? (() => undefined),
		now: () => timers.now,
		timers,
		lifecycle: overrides.lifecycle,
	});
	await scrobbler.hydrate();
	return { scrobbler, transport, timers, storage };
}

{
	assertEqual(getScrobbleThresholdSeconds(200), 100, '200s track scrobbles at half duration');
	assertEqual(getScrobbleThresholdSeconds(20), null, '20s track never scrobbles');
	assertEqual(getScrobbleThresholdSeconds(30), null, '30s track never scrobbles');
	assertEqual(
		getScrobbleThresholdSeconds(null),
		LASTFM_MAX_LISTEN_BEFORE_SCROBBLE_SECONDS,
		'unknown duration uses the 4-minute rule',
	);
	assertEqual(
		getScrobbleThresholdSeconds(600),
		LASTFM_MAX_LISTEN_BEFORE_SCROBBLE_SECONDS,
		'long tracks cap at 4 minutes',
	);
	const invalid = { start: 100, end: 50 };
	assertEqual(getTrackDurationSeconds(invalid), null, 'end <= start is invalid duration');
	assertEqual(
		getScrobbleThresholdSeconds(getTrackDurationSeconds(invalid)),
		LASTFM_MAX_LISTEN_BEFORE_SCROBBLE_SECONDS,
		'invalid duration scrobbles at 4 minutes',
	);
	assertEqual(
		getListenIdentity({ id: 't', start: 9 }, { id: 'FIP' }),
		'FIP:t:9',
		'identity is station:track:start',
	);
}

{
	const { scrobbler, transport, timers } = await hydratedScrobbler();
	const track = makeTrack();
	scrobbler.notify(notifyInput(track));
	await flush();
	assertEqual(transport.nowPlaying.length, 1, 'new playing identity sends now-playing once');
	assertEqual(transport.nowPlaying[0]?.title, track.title, 'now-playing uses the live title');

	scrobbler.notify(notifyInput(track));
	scrobbler.notify(notifyInput(track));
	await flush();
	assertEqual(transport.nowPlaying.length, 1, 'repeated notify does not send now-playing again');

	timers.advanceBy(100_000);
	await flush();
	assertEqual(transport.scrobbles.length, 1, '200s track scrobbles at 100s');
	assertEqual(transport.scrobbles[0]?.title, track.title, 'scrobble uses the live title');
	scrobbler.dispose();
}

{
	const { scrobbler, transport, timers } = await hydratedScrobbler();
	const track = makeTrack();
	scrobbler.notify(notifyInput(track, 'loading'));
	await flush();
	assertEqual(transport.nowPlaying.length, 0, 'loading does not send now-playing');

	timers.advanceBy(40_000);
	scrobbler.notify(notifyInput(track, 'playing'));
	await flush();
	assertEqual(transport.nowPlaying.length, 1, 'first playing sends now-playing');

	timers.advanceBy(99_000);
	await flush();
	assertEqual(transport.scrobbles.length, 0, 'loading interval is not accrued');

	timers.advanceBy(1_000);
	await flush();
	assertEqual(transport.scrobbles.length, 1, 'scrobble fires after 100s of playing');
	scrobbler.dispose();
}

{
	const { scrobbler, transport, timers } = await hydratedScrobbler();
	const track = makeTrack();
	scrobbler.notify(notifyInput(track));
	timers.advanceBy(40_000);
	scrobbler.notify(notifyInput(track, 'paused'));
	await flush();
	assertEqual(transport.scrobbles.length, 0, 'pause before threshold does not scrobble');

	timers.advanceBy(80_000);
	scrobbler.notify(notifyInput(track));
	timers.advanceBy(59_000);
	await flush();
	assertEqual(transport.scrobbles.length, 0, 'paused time is not accrued');

	timers.advanceBy(1_000);
	await flush();
	assertEqual(transport.scrobbles.length, 1, 'resume continues accrual to the threshold');
	scrobbler.dispose();
}

{
	const { scrobbler, transport, timers } = await hydratedScrobbler();
	scrobbler.notify(notifyInput(makeTrack({ id: 'short', start: 50, end: 70 })));
	timers.advanceBy(300_000);
	await flush();
	assertEqual(transport.scrobbles.length, 0, 'known 20s track never scrobbles');
	scrobbler.dispose();
}

{
	const { scrobbler, transport, timers } = await hydratedScrobbler();
	scrobbler.notify(notifyInput(makeTrack({ id: 'broken', start: 100, end: 50 })));
	timers.advanceBy(239_000);
	await flush();
	assertEqual(transport.scrobbles.length, 0, 'invalid duration waits the full 4 minutes');
	timers.advanceBy(1_000);
	await flush();
	assertEqual(transport.scrobbles.length, 1, 'invalid end <= start scrobbles at 240s');
	scrobbler.dispose();
}

{
	const { scrobbler, transport, timers } = await hydratedScrobbler();
	const first = makeTrack({ id: 'first', title: 'First' });
	const second = makeTrack({ id: 'second', title: 'Second', start: 2_000, end: 2_200 });
	scrobbler.notify(notifyInput(first));
	timers.advanceTimeOnly(100_000);
	scrobbler.notify(notifyInput(second));
	await flush();
	assertEqual(transport.scrobbles.length, 1, 'identity change flushes a window past threshold');
	assertEqual(transport.scrobbles[0]?.title, 'First', 'flushed scrobble is the previous identity');
	assertEqual(transport.nowPlaying.length, 2, 'new identity sends its own now-playing');
	scrobbler.dispose();
}

{
	const transport = new FakeTransport();
	transport.scrobbleResult = { ok: false, retryable: true, invalidSession: false };
	const storage = new MemoryStorage();
	const lifecycle = new FakeLifecycle();
	const { scrobbler, timers } = await hydratedScrobbler({ transport, storage, lifecycle });
	scrobbler.notify(notifyInput(makeTrack()));
	timers.advanceBy(100_000);
	await flush();
	assertEqual(transport.scrobbles.length, 1, 'retryable failure still attempts a scrobble');
	assertEqual(scrobbler.getState().pendingCount, 1, 'retryable failure stays queued');

	transport.scrobbleResult = { ok: true };
	lifecycle.fire('online');
	await flush();
	assertEqual(transport.scrobbles.length, 2, 'online drains a retryable queue');
	assertEqual(scrobbler.getState().pendingCount, 0, 'successful drain clears pending');
	scrobbler.dispose();

	transport.scrobbleResult = { ok: false, retryable: true, invalidSession: false };
	const next = await hydratedScrobbler({ storage, transport });
	next.scrobbler.notify(notifyInput(makeTrack({ id: 'reload', start: 3_000, end: 3_200 })));
	next.timers.advanceBy(100_000);
	await flush();
	assertEqual(next.scrobbler.getState().pendingCount, 1, 'retryable failure persists for hydrate');
	next.scrobbler.dispose();

	transport.scrobbleResult = { ok: true };
	const rehydrated = await hydratedScrobbler({ storage, transport });
	await flush();
	assertEqual(
		rehydrated.scrobbler.getState().pendingCount,
		0,
		'hydrate drains the persisted queue',
	);
	assert(
		transport.scrobbles.some((item) => item.title === 'Song One'),
		'hydrated drain sends the queued submission',
	);
	rehydrated.scrobbler.dispose();
}

{
	const transport = new FakeTransport();
	transport.scrobbleResult = { ok: false, retryable: false, invalidSession: true };
	const redirects: string[] = [];
	const { scrobbler, timers } = await hydratedScrobbler({
		transport,
		redirect: (url) => redirects.push(url),
	});
	scrobbler.notify(notifyInput(makeTrack()));
	timers.advanceBy(100_000);
	await flush();
	assertEqual(scrobbler.getState().status, 'expired', 'error 9 sets expired');
	assertEqual(scrobbler.getState().pendingCount, 1, 'expired keeps the queue');
	scrobbler.connect();
	assertEqual(redirects[0], LASTFM_AUTH_START_PATH, 'connect is the recovery from expired');
	assertEqual(scrobbler.getState().pendingCount, 1, 'connect does not drop the expired queue');
	scrobbler.dispose();
}

{
	const { scrobbler, transport } = await hydratedScrobbler();
	scrobbler.dispose();
	scrobbler.notify(notifyInput(makeTrack()));
	await flush();
	assertEqual(transport.nowPlaying.length, 0, 'notify after dispose is a no-op');
	assertEqual(transport.scrobbles.length, 0, 'dispose blocks later scrobbles');
}

{
	const { scrobbler, transport } = await hydratedScrobbler();
	scrobbler.notify(notifyInput(makeTrack()));
	await flush();
	await scrobbler.disconnect();
	assertEqual(transport.disconnectCalls, 1, 'disconnect asks the transport to clear the session');
	assertEqual(scrobbler.getState().status, 'disconnected', 'disconnect sets disconnected');
	assertEqual(scrobbler.getState().pendingCount, 0, 'explicit disconnect clears the queue');
	scrobbler.dispose();
}
