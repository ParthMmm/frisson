import {
	PLAYBACK_RECOVERY_DELAY_MS,
	createPlaybackRecovery,
	type PlaybackRecoveryController,
} from '../src/lib/playback-recovery';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

interface ScheduledTimer {
	dueAt: number;
	callback: () => void;
}

class FakeTimers {
	private now = 0;
	private nextId = 1;
	private timers = new Map<number, ScheduledTimer>();

	setTimer = (callback: () => void, delayMs: number) => {
		const id = this.nextId++;
		this.timers.set(id, { dueAt: this.now + delayMs, callback });
		return id;
	};

	clearTimer = (timer: number) => {
		this.timers.delete(timer);
	};

	advanceBy(ms: number) {
		this.now += ms;

		for (const [id, timer] of [...this.timers].sort(([, a], [, b]) => a.dueAt - b.dueAt)) {
			if (timer.dueAt > this.now) continue;

			this.timers.delete(id);
			timer.callback();
		}
	}
}

interface RecoveryHarness {
	controller: PlaybackRecoveryController;
	timers: FakeTimers;
	getRecoveryCount(): number;
	setPlaybackExpected(isPlaybackExpected: boolean): void;
	getRecoveryPendingChanges(): boolean[];
}

const audio = {
	paused: false,
	ended: false,
};

function createRecoveryHarness(isPlaybackExpected = true): RecoveryHarness {
	const timers = new FakeTimers();
	let recoveryCount = 0;
	let playbackExpected = isPlaybackExpected;
	const recoveryPendingChanges: boolean[] = [];
	const controller = createPlaybackRecovery({
		audio: () => audio,
		isPlaybackExpected: () => playbackExpected,
		recover: () => {
			recoveryCount += 1;
		},
		setTimer: timers.setTimer,
		clearTimer: timers.clearTimer,
		onRecoveryPendingChange: (pending) => {
			recoveryPendingChanges.push(pending);
		},
	});

	return {
		controller,
		timers,
		getRecoveryCount: () => recoveryCount,
		getRecoveryPendingChanges: () => recoveryPendingChanges,
		setPlaybackExpected(nextPlaybackExpected) {
			playbackExpected = nextPlaybackExpected;
		},
	};
}

{
	const { controller, timers, getRecoveryCount, getRecoveryPendingChanges } =
		createRecoveryHarness();

	controller.notePlaybackInterrupted();
	timers.advanceBy(PLAYBACK_RECOVERY_DELAY_MS - 1);
	assertEqual(getRecoveryCount(), 0, 'interruption does not recover before grace period');

	timers.advanceBy(1);
	await Promise.resolve();
	assertEqual(getRecoveryCount(), 1, 'interruption reloads stream after grace period');
	assertEqual(
		getRecoveryPendingChanges().join(','),
		'true,false',
		'recovery pending state wraps a retry',
	);
}

{
	const { controller, timers, getRecoveryCount, getRecoveryPendingChanges } =
		createRecoveryHarness();

	controller.notePlaybackInterrupted();
	controller.notePlaybackHealthy();
	timers.advanceBy(PLAYBACK_RECOVERY_DELAY_MS);
	assertEqual(getRecoveryCount(), 0, 'healthy playback cancels pending recovery');
	assertEqual(
		getRecoveryPendingChanges().join(','),
		'true,false',
		'healthy playback clears recovery pending state',
	);
}

{
	const { controller, timers, getRecoveryCount, getRecoveryPendingChanges, setPlaybackExpected } =
		createRecoveryHarness();

	controller.notePlaybackInterrupted();
	setPlaybackExpected(false);
	controller.notePlaybackStopped();
	timers.advanceBy(PLAYBACK_RECOVERY_DELAY_MS);
	assertEqual(getRecoveryCount(), 0, 'stopped playback cancels pending recovery');
	assertEqual(
		getRecoveryPendingChanges().join(','),
		'true,false',
		'stopped playback clears recovery pending state',
	);
}

{
	const { controller, timers, getRecoveryCount } = createRecoveryHarness();

	controller.notePlaybackInterrupted();
	controller.notePlaybackInterrupted();
	timers.advanceBy(PLAYBACK_RECOVERY_DELAY_MS);
	assertEqual(getRecoveryCount(), 1, 'repeated stalled events share one recovery timer');
}

{
	const { controller, timers, getRecoveryCount } = createRecoveryHarness(false);

	controller.notePlaybackInterrupted();
	timers.advanceBy(PLAYBACK_RECOVERY_DELAY_MS);
	assertEqual(getRecoveryCount(), 0, 'unexpected playback does not schedule recovery');
}
