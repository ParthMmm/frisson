export const PLAYBACK_RECOVERY_DELAY_MS = 8_000;

export type PlaybackRecoveryTimer = number;

export interface PlaybackRecoveryAudio {
	readonly paused: boolean;
	readonly ended: boolean;
}

export interface PlaybackRecoveryOptions {
	audio: () => PlaybackRecoveryAudio | null | undefined;
	isPlaybackExpected: () => boolean;
	recover: () => Promise<void> | void;
	onRecoveryPendingChange?: (isRecoveryPending: boolean) => void;
	delayMs?: number;
	setTimer?: (callback: () => void, delayMs: number) => PlaybackRecoveryTimer;
	clearTimer?: (timer: PlaybackRecoveryTimer) => void;
}

export interface PlaybackRecoveryController {
	notePlaybackInterrupted(): void;
	notePlaybackHealthy(): void;
	notePlaybackStopped(): void;
	dispose(): void;
}

export function createPlaybackRecovery({
	audio,
	isPlaybackExpected,
	recover,
	onRecoveryPendingChange,
	delayMs = PLAYBACK_RECOVERY_DELAY_MS,
	setTimer = (callback, delay) => window.setTimeout(callback, delay),
	clearTimer = (timer) => window.clearTimeout(timer),
}: PlaybackRecoveryOptions): PlaybackRecoveryController {
	let isRecoveryPending = false;
	let recoveryTimer: PlaybackRecoveryTimer | null = null;
	let recoveryTicket = 0;

	function setRecoveryPending(nextRecoveryPending: boolean) {
		if (isRecoveryPending === nextRecoveryPending) return;

		isRecoveryPending = nextRecoveryPending;
		onRecoveryPendingChange?.(nextRecoveryPending);
	}

	function clearRecoveryTimer() {
		if (recoveryTimer === null) return;

		clearTimer(recoveryTimer);
		recoveryTimer = null;
	}

	function cancelPendingRecovery() {
		recoveryTicket += 1;
		clearRecoveryTimer();
		setRecoveryPending(false);
	}

	function scheduleRecovery() {
		if (!isPlaybackExpected() || recoveryTimer !== null) return;

		const ticket = ++recoveryTicket;
		setRecoveryPending(true);
		recoveryTimer = setTimer(() => {
			recoveryTimer = null;
			void recoverIfStillInterrupted(ticket);
		}, delayMs);
	}

	async function recoverIfStillInterrupted(ticket: number) {
		try {
			if (ticket !== recoveryTicket || !isPlaybackExpected()) return;

			const currentAudio = audio();
			if (!currentAudio || currentAudio.paused || currentAudio.ended) return;

			await recover();
		} finally {
			setRecoveryPending(false);
		}
	}

	return {
		notePlaybackInterrupted: scheduleRecovery,
		notePlaybackHealthy: cancelPendingRecovery,
		notePlaybackStopped: cancelPendingRecovery,
		dispose: cancelPendingRecovery,
	};
}
