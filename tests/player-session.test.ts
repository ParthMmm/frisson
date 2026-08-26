import {
	createPlayerSession,
	METADATA_SAFETY_POLL_MS,
	type PlayerAudioAdapter,
	type PlayerSessionTimers,
} from '../src/lib/player-session';
import { PLAYBACK_RECOVERY_DELAY_MS } from '../src/lib/playback-recovery';
import { getStationById } from '../src/lib/station-catalog';
import type { CurrentTrack } from '../src/lib/api';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assert(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
}

class FakeTimers implements PlayerSessionTimers {
	now = 0;
	private nextId = 1;
	private timers = new Map<number, { dueAt: number; callback: () => void; repeat?: number }>();

	setTimeout = (callback: () => void, delayMs: number) => {
		const id = this.nextId++;
		this.timers.set(id, { dueAt: this.now + delayMs, callback });
		return id;
	};

	clearTimeout = (id: number) => {
		this.timers.delete(id);
	};

	setInterval = (callback: () => void, delayMs: number) => {
		const id = this.nextId++;
		this.timers.set(id, { dueAt: this.now + delayMs, callback, repeat: delayMs });
		return id;
	};

	clearInterval = this.clearTimeout;

	advanceBy(ms: number) {
		this.now += ms;
		let due: [number, { dueAt: number; callback: () => void; repeat?: number }][];
		do {
			due = [...this.timers.entries()].filter(([, timer]) => timer.dueAt <= this.now);
			for (const [id, timer] of due) {
				if (!this.timers.has(id)) continue;
				if (timer.repeat) timer.dueAt += timer.repeat;
				else this.timers.delete(id);
				timer.callback();
			}
		} while (due.length > 0);
	}

	get size() {
		return this.timers.size;
	}
}

function makeTrack(id: string, start = 100): CurrentTrack {
	return {
		id,
		title: id,
		artist: 'Artist',
		album: 'Album',
		year: 2024,
		artworkUrl: null,
		start,
		end: start + 300,
	};
}

{
	const timers = new FakeTimers();
	const requests = new Map<
		string,
		{ resolve: (track: CurrentTrack) => void; reject: (error: unknown) => void }
	>();
	let playCount = 0;
	let loadCount = 0;
	let paused = true;
	const audio: PlayerAudioAdapter = {
		getSnapshot: () => ({ paused, ended: false }),
		play: () => {
			playCount += 1;
			paused = false;
			return Promise.resolve();
		},
		pause: () => {
			paused = true;
		},
		load: () => {
			loadCount += 1;
		},
	};
	const session = createPlayerSession({
		initialStationId: 'FIP',
		fetchCurrentTrack: (station, signal) =>
			new Promise((resolve, reject) => {
				requests.set(station.id, { resolve, reject });
				signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), {
					once: true,
				});
			}),
		audio: () => audio,
		timers,
		now: () => timers.now,
	});
	session.start();
	assertEqual(requests.size, 1, 'starting the session loads initial metadata');

	const stationChange = session.selectStation('FIP_ROCK');
	assertEqual(
		session.getState().selectedStationId,
		'FIP_ROCK',
		'station selection crosses the session seam',
	);
	requests.get('FIP')?.resolve(makeTrack('stale'));
	await Promise.resolve();
	assertEqual(session.getState().currentTrack, null, 'stale station metadata is ignored');
	requests.get('FIP_ROCK')?.resolve(makeTrack('rock'));
	await Promise.resolve();
	await stationChange;
	assertEqual(session.getState().currentTrack?.id, 'rock', 'current station metadata is applied');
	assertEqual(session.getState().playbackState, 'playing', 'station changes reload and play audio');
	assertEqual(playCount, 1, 'station change plays once');

	await session.selectStation('FIP_ROCK');
	assertEqual(playCount, 1, 'selecting the current playing station does not restart it');
	session.pause();
	await session.selectStation('FIP_ROCK');
	assertEqual(playCount, 2, 'selecting the current paused station starts playback');

	const loadCountBeforeRecovery = loadCount;
	session.handleAudioEvent('waiting');
	assertEqual(session.getState().playbackState, 'loading', 'waiting enters loading state');
	timers.advanceBy(PLAYBACK_RECOVERY_DELAY_MS - 1);
	assertEqual(loadCount, loadCountBeforeRecovery, 'recovery waits through the grace period');
	timers.advanceBy(1);
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
	assertEqual(
		loadCount,
		loadCountBeforeRecovery + 1,
		'recovery reloads the stream after the grace period',
	);
	assertEqual(
		session.getState().isPlaybackRecoveryPending,
		false,
		'recovery clears pending state after retry',
	);

	assert(timers.size > 0, 'session owns metadata/recovery timers');
	session.dispose();
	assertEqual(timers.size, 0, 'disposing the session clears owned timers');
}

{
	const timers = new FakeTimers();
	let calls = 0;
	const session = createPlayerSession({
		initialStationId: 'FIP',
		fetchCurrentTrack: async () => {
			calls += 1;
			return { ...makeTrack(`track-${calls}`), start: 0, end: 0 };
		},
		audio: () => null,
		timers,
		now: () => timers.now,
	});
	session.start();
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
	assertEqual(calls, 1, 'initial metadata request runs once');
	timers.advanceBy(30_000);
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
	assertEqual(calls, 2, 'expired metadata is refreshed by the session timer');
	session.dispose();
	timers.advanceBy(METADATA_SAFETY_POLL_MS * 2);
	assertEqual(calls, 2, 'disposed session no longer polls');
}

assert(getStationById('FIP') !== null, 'session tests use catalog identities');
