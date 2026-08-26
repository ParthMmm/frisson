<script lang="ts">
	import { flip } from 'svelte/animate';
	import { linear, cubicOut, quintOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import { onMount, tick } from 'svelte';
	import { fade } from 'svelte/transition';
	import { isAbortError } from '$lib/errors';
	import type { AppleMusicLookupResponse, CurrentTrack } from '$lib/api';
	import {
		createLastFmScrobbler,
		type LastFmLifecycle,
		type LastFmPublicSession,
		type LastFmScrobbleSubmission,
		type LastFmScrobbleTransport,
		type LastFmScrobblerSnapshot,
		type LastFmWriteResult,
		type LastFmWriteTrack
	} from '$lib/lastfm-scrobbler';
	import {
		createListeningHistory,
		LISTENING_HISTORY_LIMIT,
		type ListeningHistorySnapshot
	} from '$lib/listening-history';
	import {
		createPlayerSession,
		type PlayerAudioAdapter,
		type PlayerSessionState
	} from '$lib/player-session';
	import {
		applyPersistedFavoriteStations,
		createStationList,
		DEFAULT_SELECTED_STATION_ID,
		persistFavoriteStations,
		persistSelectedStationId,
		readPersistedSelectedStationId,
		type Station,
		type StorageAdapter
	} from '$lib/station-catalog';
	import Tuner from '$lib/Tuner.svelte';
	import TrackSummary from '$lib/TrackSummary.svelte';

	const TRACK_TIME_TICK_MS = 1000;
	const THEME_STORAGE_KEY = 'frisson-theme';
	const LEGACY_THEME_STORAGE_KEY = 'fip-theme';
	const historyTimeFormatter = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit'
	});
	const historyDateFormatter = new Intl.DateTimeFormat(undefined, {
		month: 'numeric',
		day: 'numeric'
	});

	const browserStorage: StorageAdapter = {
		getItem: (key) => (typeof localStorage === 'undefined' ? null : localStorage.getItem(key)),
		setItem: (key, value) => {
			if (typeof localStorage === 'undefined') return;
			localStorage.setItem(key, value);
		},
		removeItem: (key) => {
			if (typeof localStorage === 'undefined') return;
			localStorage.removeItem(key);
		}
	};

	const lastFmWriteRetryable: LastFmWriteResult = {
		ok: false,
		retryable: true,
		invalidSession: false
	};

	function parseLastFmPublicSession(body: unknown): LastFmPublicSession | null {
		if (!body || typeof body !== 'object') return null;
		const record = body as Record<string, unknown>;
		if (typeof record.connected !== 'boolean') return null;
		if (record.username !== null && typeof record.username !== 'string') return null;
		return { connected: record.connected, username: record.username };
	}

	function parseLastFmWriteResult(body: unknown): LastFmWriteResult | null {
		if (!body || typeof body !== 'object') return null;
		const record = body as Record<string, unknown>;
		if (record.ok === true) return { ok: true };
		if (record.ok !== false) return null;
		return {
			ok: false,
			retryable: record.retryable === true,
			invalidSession: record.invalidSession === true
		};
	}

	async function postLastFmWrite(
		path: string,
		body: LastFmWriteTrack | LastFmScrobbleSubmission
	): Promise<LastFmWriteResult> {
		try {
			const response = await fetch(path, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify(body)
			});
			return parseLastFmWriteResult(await response.json()) ?? lastFmWriteRetryable;
		} catch {
			return lastFmWriteRetryable;
		}
	}

	const lastFmBrowserTransport: LastFmScrobbleTransport = {
		getSession: async () => {
			const response = await fetch('/api/lastfm/session');
			if (!response.ok) throw new Error(`Last.fm session HTTP ${response.status}`);
			const session = parseLastFmPublicSession(await response.json());
			if (!session) throw new Error('Last.fm session response was invalid');
			return session;
		},
		disconnect: async () => {
			const response = await fetch('/api/lastfm/session', { method: 'DELETE' });
			if (!response.ok) throw new Error(`Last.fm disconnect HTTP ${response.status}`);
		},
		updateNowPlaying: (track) => postLastFmWrite('/api/lastfm/now-playing', track),
		scrobble: (submission) => postLastFmWrite('/api/lastfm/scrobble', submission)
	};

	const lastFmLifecycle: LastFmLifecycle | undefined =
		typeof window === 'undefined'
			? undefined
			: {
					addEventListener(type, listener) {
						window.addEventListener(type, listener);
					},
					removeEventListener(type, listener) {
						window.removeEventListener(type, listener);
					}
				};

	let stations = $state<Station[]>(createStationList());
	let theme = $state<'light' | 'dark'>('light');
	let volume = $state(80);
	let audioElement = $state<HTMLAudioElement>();
	let fipInfoDialog: HTMLDialogElement | undefined = $state();
	let lastFmDialog: HTMLDialogElement | undefined = $state();
	let currentTrackClockMs = $state(Date.now());
	let historyState = $state<ListeningHistorySnapshot>({ items: [], revision: 0 });
	let historyHydrated = false;

	const listeningHistory = createListeningHistory({
		lookupAppleMusicUrl: fetchAppleMusicUrl
	});
	const lastFm = createLastFmScrobbler({
		storage: browserStorage,
		transport: lastFmBrowserTransport,
		redirect: (url) => window.location.assign(url),
		lifecycle: lastFmLifecycle
	});
	const playerSession = createPlayerSession({
		initialStationId: DEFAULT_SELECTED_STATION_ID,
		fetchCurrentTrack,
		audio: getAudioAdapter,
		history: listeningHistory,
		scrobbler: lastFm,
		persistSelectedStation: (stationId) => persistSelectedStationId(stationId, browserStorage),
		waitForStationUpdate: () => tick(),
		getVolume: () => volume
	});
	let sessionState = $state<PlayerSessionState>(playerSession.getState());
	let lastFmState = $state<LastFmScrobblerSnapshot>(lastFm.getState());

	// Shared Tailwind class strings instead of custom CSS classes — one
	// definition, applied wherever a button needs it, no `@layer components`.
	// `pressable`: press feedback, focus ring, reduced-motion handling.
	// `iconHit`: pads a small icon button's hit target to ~44px via a
	// `before:` pseudo-element without changing its visible size. Radius is
	// `28%` (not `rounded-full`) to match the squircle corner ratio of the
	// transport controls (`size-14 rounded-2xl` below) at any icon-button size.
	const pressable =
		"transition-[background-color,color,transform] duration-150 ease-out touch-manipulation active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:active:scale-100 motion-reduce:transition-none";
	const iconHit =
		"relative flex items-center justify-center rounded-[28%] before:absolute before:-inset-2 before:content-['']";
	const historyArrivalGlow = new Tween(0, {
		duration: () => (prefersReducedMotion.current ? 0 : 520),
		easing: quintOut
	});

	const stationPulse = new Tween(0, {
		duration: () => (prefersReducedMotion.current ? 0 : 900),
		easing: cubicOut
	});

	const fipInfoMotion = new Tween(0, {
		duration: () => (prefersReducedMotion.current ? 0 : 220),
		easing: quintOut
	});

	const lastFmMotion = new Tween(0, {
		duration: () => (prefersReducedMotion.current ? 0 : 220),
		easing: quintOut
	});

	const reconnectSweep = new Tween(0, {
		duration: () => (prefersReducedMotion.current ? 0 : 1150),
		easing: linear
	});

	let historyArrivalPulse = 0;

	const selectedStation = $derived(
		stations.find((station) => station.id === sessionState.selectedStationId) ?? stations[0]
	);
	const playbackState = $derived(sessionState.playbackState);
	const playbackError = $derived(sessionState.playbackError);
	const shareMessage = $derived(sessionState.shareMessage);
	const currentTrack = $derived(sessionState.currentTrack);
	const metadataState = $derived(sessionState.metadataState);
	const isPlaybackRecoveryPending = $derived(sessionState.isPlaybackRecoveryPending);
	const historyItems = $derived(historyState.items);
	const isPlaying = $derived(playbackState === 'playing');
	const isLoading = $derived(playbackState === 'loading');
	const stationPulseScale = $derived(isPlaying ? 1 + stationPulse.current * 2.4 : 1);
	const stationPulseOpacity = $derived(
		isPlaying && !prefersReducedMotion.current ? (1 - stationPulse.current) * 0.45 : 0
	);
	const stationColorBlend = Tween.of(() => (isLoading ? 1 : 0), {
		duration: () => (prefersReducedMotion.current ? 0 : 220),
		easing: cubicOut
	});
	const stationDotColor = $derived(
		`color-mix(in oklch, var(--color-loading) ${stationColorBlend.current * 100}%, var(--color-accent))`
	);
	const hasActivePlayback = $derived(isPlaying || isLoading);
	const fipInfoScale = $derived(0.96 + fipInfoMotion.current * 0.04);
	const fipInfoOffset = $derived((1 - fipInfoMotion.current) * 10);
	const fipInfoBackdropOpacity = $derived(fipInfoMotion.current);
	const lastFmScale = $derived(0.96 + lastFmMotion.current * 0.04);
	const lastFmOffset = $derived((1 - lastFmMotion.current) * 10);
	const lastFmBackdropOpacity = $derived(lastFmMotion.current);
	const lastFmConnected = $derived(lastFmState.status === 'connected');
	const lastFmHeaderLabel = $derived(
		lastFmState.status === 'connected'
			? lastFmState.username
				? `Last.fm connected as ${lastFmState.username}`
				: 'Last.fm connected'
			: lastFmState.status === 'expired'
				? 'Reconnect Last.fm'
				: 'Connect Last.fm'
	);
	const trackTiming = $derived(getTrackTiming(currentTrack, currentTrackClockMs));
	const playbackProgress = $derived(trackTiming?.progress ?? (isPlaying ? 1 : isLoading ? 0.35 : 0));
	const currentTrackTimeLabel = $derived(
		trackTiming
			? `${formatTrackTime(trackTiming.elapsedSeconds)} / ${formatTrackTime(trackTiming.durationSeconds)}`
			: ''
	);
	// Radio France crossfades into the next track before its metadata refresh
	// lands — elapsed time caps at the track's duration in that window, so this
	// is true while the old track remains visible for a few seconds.
	const isCrossfading = $derived(isPlaying && trackTiming !== null && trackTiming.progress >= 1);
	const playbackProgressMotion = Tween.of(() => playbackProgress, {
		duration: () =>
			prefersReducedMotion.current || trackTiming === null ? 0 : TRACK_TIME_TICK_MS,
		easing: linear
	});
	const statusLabel = $derived(
		playbackState === 'playing'
			? isCrossfading
				? 'Changing track'
				: 'On air'
			: playbackState === 'loading'
				? isPlaybackRecoveryPending
					? 'Reconnecting'
					: 'Buffering'
				: playbackState === 'error'
					? 'Unavailable'
					: playbackState === 'paused'
						? 'Paused'
						: '' // idle: nothing to report before the first play
	);
	const playbackButtonLabel = $derived(
		isPlaybackRecoveryPending
			? 'Stop retrying stream'
			: isLoading
				? 'Cancel buffering'
				: isPlaying
					? 'Pause stream'
					: 'Play stream'
	);
	const currentTrackAppleMusicState = $derived.by(() => {
		void historyState.revision;
		return currentTrack
			? listeningHistory.getAppleMusicLookupState(currentTrack)
			: { status: 'unknown' as const, url: null };
	});
	const currentTrackAppleMusicMode = $derived(
		currentTrack && currentTrackAppleMusicState.status !== 'no-match' ? 'button' : 'none'
	);
	const isAppleMusicLookupLoading = $derived(currentTrackAppleMusicState.status === 'loading');

	$effect(() => {
		const timingBounds = getTrackTimingBounds(currentTrack);
		if (!timingBounds) return;

		currentTrackClockMs = Math.min(Date.now(), timingBounds.endMs);
		if (currentTrackClockMs >= timingBounds.endMs) return;

		const tickHandle = window.setInterval(() => {
			currentTrackClockMs = Math.min(Date.now(), timingBounds.endMs);
			if (currentTrackClockMs >= timingBounds.endMs) window.clearInterval(tickHandle);
		}, TRACK_TIME_TICK_MS);

		return () => window.clearInterval(tickHandle);
	});

	$effect(() => {
		if (!isPlaying || prefersReducedMotion.current) {
			void stationPulse.set(0, { duration: 0 });
			return;
		}

		let cancelled = false;
		let pause: number | null = null;

		async function pulseStationDot() {
			while (!cancelled) {
				await stationPulse.set(0, { duration: 0 });
				if (cancelled) return;

				await stationPulse.set(1, {
					duration: 900,
					easing: cubicOut
				});
				if (cancelled) return;

				await new Promise<void>((resolve) => {
					pause = window.setTimeout(resolve, 850);
				});
			}
		}

		void pulseStationDot();

		return () => {
			cancelled = true;
			if (pause !== null) window.clearTimeout(pause);
		};
	});

	$effect(() => {
		if (!isPlaybackRecoveryPending || prefersReducedMotion.current) {
			void reconnectSweep.set(0, { duration: 0 });
			return;
		}

		let cancelled = false;

		async function sweepReconnectIndicator() {
			while (!cancelled) {
				await reconnectSweep.set(0, { duration: 0 });
				if (cancelled) return;

				await reconnectSweep.set(1, {
					duration: 1150,
					easing: linear
				});
			}
		}

		void sweepReconnectIndicator();

		return () => {
			cancelled = true;
		};
	});

	onMount(() => {
		// app.html already set this pre-paint; just mirror it into state.
		theme = (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light';
		stations = applyPersistedFavoriteStations(stations, browserStorage);
		const persistedStationId = readPersistedSelectedStationId(browserStorage);
		if (persistedStationId) persistSelectedStationId(persistedStationId, browserStorage);
		const unsubscribeSession = playerSession.subscribe((nextState) => {
			sessionState = nextState;
		});
		const unsubscribeHistory = listeningHistory.subscribe((nextState) => {
			const previousLatestId = historyState.items[0]?.id;
			historyState = nextState;
			if (
				historyHydrated &&
				nextState.items[0]?.id &&
				nextState.items[0]?.id !== previousLatestId
			) {
				void pulseHistoryArrival();
			}
		});
		listeningHistory.load(browserStorage);
		historyHydrated = true;
		const unsubscribeLastFm = lastFm.subscribe((nextState) => {
			lastFmState = nextState;
		});
		void lastFm.hydrate();
		playerSession.start(persistedStationId ?? DEFAULT_SELECTED_STATION_ID);

		return () => {
			unsubscribeSession();
			unsubscribeHistory();
			unsubscribeLastFm();
			playerSession.dispose();
			listeningHistory.dispose();
			lastFm.dispose();
		};
	});

	function getAudioAdapter(): PlayerAudioAdapter | null {
		if (!audioElement) return null;

		return {
			getSnapshot: () => ({ paused: audioElement?.paused ?? true, ended: audioElement?.ended ?? false }),
			play: () => audioElement!.play(),
			pause: () => audioElement?.pause(),
			load: () => audioElement?.load(),
			setVolume: (nextVolume) => {
				if (audioElement) audioElement.volume = nextVolume;
			}
		};
	}

	async function fetchCurrentTrack(station: Station, signal: AbortSignal) {
		const params = new URLSearchParams({ station: station.id });
		const response = await fetch(`/api/current-track?${params}`, { signal });
		if (!response.ok) throw new Error(`Current track metadata returned HTTP ${response.status}`);
		return (await response.json()) as CurrentTrack | null;
	}

	async function fetchAppleMusicUrl(track: Pick<CurrentTrack, 'title' | 'artist'>) {
		const params = new URLSearchParams({
			title: track.title,
			artist: track.artist
		});
		const response = await fetch(`/api/apple-music?${params}`);

		if (!response.ok) throw new Error('Apple Music lookup failed');

		const { url } = (await response.json()) as AppleMusicLookupResponse;
		return url;
	}

	function getTrackTiming(track: CurrentTrack | null, nowMs: number) {
		const bounds = getTrackTimingBounds(track);
		if (!bounds) return null;

		const elapsedSeconds = Math.min(
			Math.max(nowMs / 1000 - bounds.startSeconds, 0),
			bounds.durationSeconds
		);
		return {
			...bounds,
			elapsedSeconds,
			progress: elapsedSeconds / bounds.durationSeconds
		};
	}

	function getTrackTimingBounds(track: CurrentTrack | null) {
		if (!track || track.start <= 0 || track.end <= track.start) return null;

		return {
			startSeconds: track.start,
			durationSeconds: track.end - track.start,
			endMs: track.end * 1000
		};
	}

	function formatTrackTime(totalSeconds: number) {
		const seconds = Math.max(0, Math.floor(totalSeconds));
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
	}

	function toggleTheme() {
		const html = document.documentElement;
		// Suppress transitions for one frame so every color variable on the
		// page doesn't visibly cross-fade at once.
		html.setAttribute('data-theme-switching', '');
		theme = theme === 'dark' ? 'light' : 'dark';
		html.dataset.theme = theme;
		try {
			localStorage.setItem(THEME_STORAGE_KEY, theme);
			localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
		} catch {
			/* private browsing, etc. */
		}
		requestAnimationFrame(() =>
			requestAnimationFrame(() => html.removeAttribute('data-theme-switching'))
		);
	}

	async function openFipInfo() {
		if (!fipInfoDialog || fipInfoDialog.open) return;

		await fipInfoMotion.set(0, { duration: 0 });
		fipInfoDialog.showModal();
		await tick();
		void fipInfoMotion.set(1);
	}

	async function closeFipInfo() {
		if (!fipInfoDialog?.open) return;

		await fipInfoMotion.set(0, {
			duration: prefersReducedMotion.current ? 0 : 160,
			easing: quintOut
		});
		fipInfoDialog.close();
	}

	function cancelFipInfoClose(event: Event) {
		event.preventDefault();
		void closeFipInfo();
	}

	function closeFipInfoOnBackdrop(event: MouseEvent) {
		if (event.target === fipInfoDialog) void closeFipInfo();
	}

	async function openLastFm() {
		if (!lastFmDialog || lastFmDialog.open) return;

		await lastFmMotion.set(0, { duration: 0 });
		lastFmDialog.showModal();
		await tick();
		void lastFmMotion.set(1);
	}

	async function closeLastFm() {
		if (!lastFmDialog?.open) return;

		await lastFmMotion.set(0, {
			duration: prefersReducedMotion.current ? 0 : 160,
			easing: quintOut
		});
		lastFmDialog.close();
	}

	function cancelLastFmClose(event: Event) {
		event.preventDefault();
		void closeLastFm();
	}

	function closeLastFmOnBackdrop(event: MouseEvent) {
		if (event.target === lastFmDialog) void closeLastFm();
	}

	function connectLastFm() {
		lastFm.connect();
	}

	async function disconnectLastFm() {
		await lastFm.disconnect();
	}

	async function shareStation() {
		playerSession.setShareMessage('');

		const shareData = {
			title: selectedStation.name,
			text: `Listen to ${selectedStation.name} on Frisson.`,
			url: selectedStation.streamUrl
		};

		try {
			if (navigator.share) {
				await navigator.share(shareData);
				playerSession.setShareMessage('Share sheet opened.');
				return;
			}

			await navigator.clipboard.writeText(selectedStation.streamUrl);
			playerSession.setShareMessage('Stream link copied.');
		} catch (error) {
			if (isAbortError(error)) return;
			playerSession.setShareMessage('Sharing is unavailable in this browser.');
		}
	}

	async function openCurrentTrackInAppleMusic() {
		if (!currentTrack) {
			playerSession.setShareMessage('No current track to open.');
			return;
		}

		const track = currentTrack;
		playerSession.setShareMessage('');

		try {
			const url = await listeningHistory.lookupAppleMusic(track);
			if (!url) return;

			const appleMusicWindow = window.open(url, '_blank');
			if (appleMusicWindow) {
				appleMusicWindow.opener = null;
				playerSession.setShareMessage('Opening Apple Music.');
				return;
			}

			window.location.assign(url);
		} catch {
			playerSession.setShareMessage('Apple Music lookup failed.');
		}
	}

	// Custom transition instead of `fly`: a new row still slides down from
	// above (`translateY` from -12px), but also scales up from 97%, so it
	// reads as popping into place rather than just sliding — a small echo of
	// the glow bloom (`historyArrivalGlow` below) that blooms under it.
	function historyItemEnter(_node: Element) {
		return {
			duration: prefersReducedMotion.current ? 0 : 220,
			easing: quintOut,
			css: (t: number) =>
				`transform: translateY(${(1 - t) * -12}px) scale(${0.97 + t * 0.03}); opacity: ${t}`
		};
	}

	// Circular clip-path wipe for swapping between the status icons — both the
	// outgoing and incoming icon play this (in reverse for outgoing), so they
	// cross-wipe instead of hard-cutting.
	function clipRevealIcon(_node: Element) {
		return {
			duration: prefersReducedMotion.current ? 0 : 200,
			easing: quintOut,
			css: (t: number) => `clip-path: circle(${t * 100}% at 50% 50%)`
		};
	}

	async function pulseHistoryArrival() {
		const pulse = ++historyArrivalPulse;
		await historyArrivalGlow.set(0, { duration: 0 });
		if (pulse !== historyArrivalPulse || prefersReducedMotion.current) return;

		await historyArrivalGlow.set(1, {
			duration: prefersReducedMotion.current ? 0 : 120,
			easing: quintOut
		});
		if (pulse !== historyArrivalPulse) return;

		await historyArrivalGlow.set(0, {
			duration: prefersReducedMotion.current ? 0 : 520,
			easing: quintOut
		});
	}

	function selectStation(station: Station | string) {
		void playerSession.selectStation(station);
	}

	function selectAdjacentStation(direction: -1 | 1) {
		void playerSession.selectAdjacentStation(direction);
	}

	function togglePlayback() {
		playerSession.togglePlayback();
	}

	function updateVolume(event: Event) {
		volume = Number((event.currentTarget as HTMLInputElement).value);
		getAudioAdapter()?.setVolume?.(volume / 100);
	}

	function formatHistoryTimestamp(timestamp: number) {
		const listenedAt = new Date(timestamp);
		const now = new Date();
		const time = historyTimeFormatter.format(listenedAt);
		if (
			listenedAt.getFullYear() === now.getFullYear() &&
			listenedAt.getMonth() === now.getMonth() &&
			listenedAt.getDate() === now.getDate()
		) {
			return time;
		}

		return `${historyDateFormatter.format(listenedAt)} · ${time}`;
	}

	function toggleFavorite(identity: string) {
		const station = stations.find((candidate) =>
			candidate.id === identity || candidate.name === identity
		);
		if (!station) return;

		station.favorite = !station.favorite;
		persistFavoriteStations(stations, browserStorage);
	}
</script>


<svelte:head>
	<title>{selectedStation.name} · Frisson</title>
	<meta
		name="description"
		content="Frisson is a focused Svelte player for FIP and Radio France web radio stations."
	/>
</svelte:head>

<audio
	bind:this={audioElement}
	src={selectedStation.streamUrl}
	preload="none"
	onplaying={() => playerSession.handleAudioEvent('playing')}
	onwaiting={() => playerSession.handleAudioEvent('waiting')}
	onstalled={() => playerSession.handleAudioEvent('stalled')}
	onpause={() => playerSession.handleAudioEvent('pause')}
	onerror={() => playerSession.handleAudioEvent('error')}
></audio>

<dialog
	bind:this={fipInfoDialog}
	aria-labelledby="fip-info-title"
	class="fip-info-dialog m-auto w-[min(92vw,28rem)] rounded-card border border-divider bg-surface p-0 text-ink shadow-2xl will-change-[opacity,transform]"
	style:--fip-info-backdrop-opacity={fipInfoBackdropOpacity}
	style:opacity={fipInfoMotion.current}
	style:transform={`translateY(${fipInfoOffset}px) scale(${fipInfoScale})`}
	oncancel={cancelFipInfoClose}
	onclick={closeFipInfoOnBackdrop}
>
	<div class="p-6 sm:p-7">
		<div class="flex items-start justify-between gap-4">
			<div>
				<p class="text-xs font-semibold tracking-widest text-accent uppercase">About FIP</p>
				<h2 id="fip-info-title" class="mt-2 text-2xl font-extrabold tracking-tight text-ink">
					What is FIP?
				</h2>
			</div>
			<button
				type="button"
				aria-label="Close FIP information"
				class="{iconHit} {pressable} size-9 shrink-0 border border-divider text-ink-secondary hover:bg-canvas"
				onclick={closeFipInfo}
			>
				<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
				</svg>
			</button>
		</div>
		<div class="mt-4 space-y-3 text-sm leading-6 text-ink-secondary">
			<p>
				FIP's a Paris radio station that's been jumping between jazz, soul, rock, electro, and film scores since 1971. Almost no talking, just good music.
			</p>
			<p>
				Frisson streams FIP and its themed stations, shows what's playing, and keeps track of what you've heard.
			</p>
		</div>
	</div>
</dialog>

<dialog
	bind:this={lastFmDialog}
	aria-labelledby="lastfm-title"
	class="fip-info-dialog m-auto w-[min(92vw,28rem)] rounded-card border border-divider bg-surface p-0 text-ink shadow-2xl will-change-[opacity,transform]"
	style:--fip-info-backdrop-opacity={lastFmBackdropOpacity}
	style:opacity={lastFmMotion.current}
	style:transform={`translateY(${lastFmOffset}px) scale(${lastFmScale})`}
	oncancel={cancelLastFmClose}
	onclick={closeLastFmOnBackdrop}
>
	<div class="p-6 sm:p-7">
		<div class="flex items-start justify-between gap-4">
			<h2 id="lastfm-title" class="text-2xl font-extrabold tracking-tight text-ink">
				Last.fm
			</h2>
			<button
				type="button"
				aria-label="Close Last.fm"
				class="{iconHit} {pressable} size-9 shrink-0 border border-divider text-ink-secondary hover:bg-canvas"
				onclick={closeLastFm}
			>
				<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
					<path stroke-linecap="round" stroke-linejoin="round" d="M6 6l12 12M18 6 6 18" />
				</svg>
			</button>
		</div>
		<div class="mt-4 space-y-3 text-sm leading-6 text-ink-secondary">
			{#if lastFmState.status === 'connected'}
				<p>
					Scrobbling as @{lastFmState.username}. Radio scrobbles are marked as not chosen by you.
				</p>
			{:else if lastFmState.status === 'expired'}
				<p>Session expired. Reconnect to resume scrobbling.</p>
			{:else}
				<p>Scrobble FIP tracks to your Last.fm account.</p>
			{/if}
		</div>
		{#if lastFmState.status === 'connected'}
			<button
				type="button"
				class="{pressable} mt-6 w-full rounded-2xl border border-divider py-3 text-sm font-semibold text-ink-secondary hover:bg-canvas"
				onclick={disconnectLastFm}
			>
				Disconnect
			</button>
		{:else if lastFmState.status === 'expired'}
			<button
				type="button"
				class="{pressable} mt-6 w-full rounded-2xl bg-ink py-3 text-sm font-semibold text-surface hover:bg-ink/90"
				onclick={connectLastFm}
			>
				Connect again
			</button>
		{:else}
			<button
				type="button"
				class="{pressable} mt-6 w-full rounded-2xl bg-ink py-3 text-sm font-semibold text-surface hover:bg-ink/90"
				onclick={connectLastFm}
			>
				Connect Last.fm
			</button>
		{/if}
	</div>
</dialog>

<main class="min-h-screen bg-surface lg:h-screen lg:overflow-hidden">
	<div class="grid min-h-screen w-full grid-cols-1 lg:h-full lg:min-h-0 lg:grid-cols-[1.2fr_1fr] lg:overflow-hidden">
		<!-- Left: player -->
		<section class="border-b border-divider p-6 sm:p-8 lg:overflow-hidden lg:border-r lg:border-b-0 lg:p-14">
			<!-- Top bar -->
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-2">
					<div class="text-2xl font-extrabold tracking-tight text-ink">
						Frisson<span class="text-accent">.</span>
					</div>
					<button
						type="button"
						aria-label="What is FIP?"
						aria-haspopup="dialog"
						class="{iconHit} {pressable} size-7 border border-divider text-ink-secondary hover:bg-canvas"
						onclick={openFipInfo}
					>
						<svg
							viewBox="0 0 24 24"
							class="size-3.5"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3" />
							<path d="M12 17h.01" />
						</svg>
					</button>
				</div>
				<div class="flex items-center gap-3">
					<button
						type="button"
						aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
						aria-pressed={theme === 'dark'}
						class="{iconHit} {pressable} size-9 border border-divider text-ink-secondary hover:bg-canvas"
						onclick={toggleTheme}
					>
						{#if theme === 'dark'}
							<svg
								viewBox="0 0 24 24"
								class="size-4"
								fill="none"
								stroke="currentColor"
								stroke-width="2"
								stroke-linecap="round"
								aria-hidden="true"
							>
								<!-- Scaled down 15% about the center: at full size the ray tips
								     sit right at the viewBox edge, reading visually larger than
								     the star/share/moon icons, which all keep more inset margin.
								     This brings its apparent size back in line with its siblings. -->
								<g transform="translate(12 12) scale(0.85) translate(-12 -12)">
									<circle cx="12" cy="12" r="4" />
									<path
										d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
									/>
								</g>
							</svg>
						{:else}
							<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
								<path
									stroke-linecap="round"
									stroke-linejoin="round"
									d="M20 12.5A8.5 8.5 0 1 1 11.5 4a6.5 6.5 0 0 0 8.5 8.5Z"
								/>
							</svg>
						{/if}
					</button>
				</div>
			</div>

			<!-- Category row -->
			<div class="mt-10 flex items-center justify-between gap-4">
				<div class="flex min-w-0 items-center gap-2 text-xs font-semibold tracking-widest text-accent uppercase">
					<span class="relative flex size-1.5 shrink-0 items-center justify-center" aria-hidden="true">
						<span
							class="absolute size-1.5 rounded-full will-change-[transform,opacity]"
							style:background-color={stationDotColor}
							style:opacity={stationPulseOpacity}
							style:transform={`scale(${stationPulseScale})`}
						></span>
						<span class="relative size-1.5 rounded-full" style:background-color={stationDotColor}></span>
					</span>
					<span class="relative grid min-w-0" role="status" aria-live="polite">
						{#each stations as station (station.name)}
							<span class="invisible col-start-1 row-start-1 whitespace-nowrap" aria-hidden="true">
								{station.name}
							</span>
						{/each}
						{#key selectedStation.name}
							<span
								class="col-start-1 row-start-1 whitespace-nowrap"
								transition:fade={{ duration: prefersReducedMotion.current ? 0 : 140 }}
							>
								{selectedStation.name}
							</span>
						{/key}
					</span>
				</div>
				<div class="flex items-center gap-3">
					<button
						type="button"
						aria-label={selectedStation.favorite
							? `Remove ${selectedStation.name} from favorites`
							: `Add ${selectedStation.name} to favorites`}
						aria-pressed={selectedStation.favorite}
						class="{iconHit} {pressable} size-9 {selectedStation.favorite ? 'bg-accent-subtle text-accent' : 'border border-divider text-ink-tertiary/50 hover:bg-canvas hover:text-ink-tertiary'}"
						onclick={() => toggleFavorite(selectedStation.id)}
					>
						<svg viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true">
							<path
								d="M12 2.5l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.8 5.8 21.4l1.6-7-5.4-4.7 7.1-.6L12 2.5z"
							/>
						</svg>
					</button>
					<button
						type="button"
						aria-label="Share this station"
						class="{iconHit} {pressable} size-9 border border-divider text-ink-secondary hover:bg-canvas"
						onclick={shareStation}
					>
						<!-- `-translate-y-px`: the open tray at the bottom carries more ink
						     than the arrow above it, so centering by bounding box alone
						     reads as slightly low. Nudging up 1px optically balances it. -->
						<svg
							viewBox="0 0 24 24"
							class="size-4 -translate-y-px"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							aria-hidden="true"
						>
							<path
								stroke-linecap="round"
								stroke-linejoin="round"
								d="M12 3v12M8 7l4-4 4 4M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"
							/>
						</svg>
					</button>
				</div>
			</div>

			<!-- Title -->
			<!-- Fixed to one line at its own line-height (`h-[1lh]`). During the
			     fade, outgoing and incoming labels are stacked in the same
			     absolute slot so they cannot widen/wrap the heading box. -->
			<h1
				class="relative mt-4 h-[1lh] overflow-hidden text-6xl leading-none font-black tracking-tight whitespace-nowrap text-ink sm:text-7xl lg:text-8xl"
			>
				{#key selectedStation.shortName}
					<span class="absolute inset-0 block" transition:fade={{ duration: prefersReducedMotion.current ? 0 : 140 }}
						>{selectedStation.shortName}</span
					>
				{/key}
			</h1>
			<p class="mt-3 text-sm font-medium tracking-wide text-ink-tertiary">Radio France</p>
			<!-- Visually hidden: playback state (Buffering/Reconnecting/Paused/etc.) is
			     still announced to screen readers even though the status text is no
			     longer shown — it's already conveyed visually via the scrubber's
			     right-hand label and the live-station dot. -->
			<span class="sr-only" role="status" aria-live="polite">{statusLabel}</span>
			{#if playbackError}
				<p class="mt-2 text-sm font-medium text-accent" role="alert">{playbackError}</p>
			{/if}
			{#if shareMessage}
				<p class="mt-2 text-sm font-medium text-ink-secondary" role="status">{shareMessage}</p>
			{/if}
			<!-- Tuner -->
			<div class="mt-10">
				<Tuner
					{stations}
					selectedId={sessionState.selectedStationId}
					onSelect={selectStation}
				/>
			</div>

			<!-- Now playing -->
			<TrackSummary
				rowClass="mt-8 flex items-center gap-4"
				title={currentTrack?.title ?? selectedStation.name}
				artist={metadataState === 'loading' && currentTrack === null
					? 'Loading current track'
					: metadataState === 'error' && currentTrack === null
						? 'Track data unavailable'
						: (currentTrack?.artist ?? 'Streaming now')}
				meta={currentTrack
					? `${currentTrack.album}${currentTrack.year ? ` · ${currentTrack.year}` : ''}`
					: `Radio France · ${selectedStation.tag}`}
				artworkUrl={currentTrack?.artworkUrl ?? null}
				artworkAlt={currentTrack
					? `Artwork for ${currentTrack.title} by ${currentTrack.artist}`
					: `Live badge for ${selectedStation.name}`}
				fallbackAriaLabel={`Live badge for ${selectedStation.name}`}
				appleMusicMode={currentTrackAppleMusicMode}
				appleMusicLoading={isAppleMusicLookupLoading}
				appleMusicTitle="Open in Apple Music"
				appleMusicAriaLabel="Open current track in Apple Music"
				onAppleMusicClick={openCurrentTrackInAppleMusic}
				{pressable}
			/>

			<div class="mt-4">
				<div class="relative h-1 overflow-hidden rounded-full bg-divider">
					<div
						class="h-full origin-left rounded-full bg-accent will-change-transform"
						style:transform={`scaleX(${prefersReducedMotion.current ? playbackProgress : playbackProgressMotion.current})`}
					></div>
					{#if isPlaybackRecoveryPending}
						<div
							class="pointer-events-none absolute inset-y-0 left-0 w-1/3 rounded-full bg-gradient-to-r from-transparent via-accent/70 to-transparent will-change-transform motion-reduce:hidden"
							style:transform={`translateX(${-140 + reconnectSweep.current * 560}%)`}
							aria-hidden="true"
						></div>
					{/if}
				</div>
				<div class="mt-1.5 grid grid-cols-[1fr_auto_1fr] items-center text-xs tabular-nums text-ink-tertiary">
					<span>Live</span>
					<span class="text-center">{currentTrackTimeLabel}</span>
					<span class="flex items-center justify-end">
						<span class="relative size-3.5 shrink-0">
							{#if isPlaybackRecoveryPending || isLoading}
							<span
								class="absolute inset-0 flex items-center justify-center"
								transition:clipRevealIcon
							>
								<svg viewBox="0 0 24 24" class="size-3.5" fill="currentColor" aria-hidden="true">
									<circle
										cx="5"
										cy="12"
										r="2.2"
										class="[animation:icon-dot-bounce_1s_ease-in-out_infinite] motion-reduce:[animation:none]"
									/>
									<circle
										cx="12"
										cy="12"
										r="2.2"
										class="[animation-delay:150ms] [animation:icon-dot-bounce_1s_ease-in-out_infinite] motion-reduce:[animation:none]"
									/>
									<circle
										cx="19"
										cy="12"
										r="2.2"
										class="[animation-delay:300ms] [animation:icon-dot-bounce_1s_ease-in-out_infinite] motion-reduce:[animation:none]"
									/>
								</svg>
								<span class="sr-only">{isPlaybackRecoveryPending ? 'Retrying stream…' : 'Buffering'}</span>
							</span>
						{:else if isCrossfading}
							<span
								class="absolute inset-0 flex items-center justify-center"
								transition:clipRevealIcon
							>
								<svg viewBox="0 0 24 24" class="size-3.5" fill="currentColor" aria-hidden="true">
									<path
										d="M3 6v12l9-6-9-6z"
										class="[animation:icon-crossfade-pulse_1.6s_ease-in-out_infinite] motion-reduce:[animation:none]"
									/>
									<path
										d="M21 6v12l-9-6 9-6z"
										class="[animation-delay:-0.8s] [animation:icon-crossfade-pulse_1.6s_ease-in-out_infinite] motion-reduce:[animation:none]"
									/>
								</svg>
								<span class="sr-only">Changing track</span>
							</span>
						{:else if isPlaying}
							<span
								class="absolute inset-0 flex items-center justify-center"
								transition:clipRevealIcon
							>
								<svg
									viewBox="0 0 24 24"
									class="size-3.5"
									fill="none"
									stroke="currentColor"
									stroke-width="2"
									stroke-linecap="round"
									stroke-linejoin="round"
									aria-hidden="true"
								>
									<path
										d="M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.26-8-12.356-8-5.095 0-5.095 8 0 8 5.096 0 7.26-8 12.356-8z"
									/>
								</svg>
								<span class="sr-only">Live</span>
							</span>
						{:else}
							<span
								class="absolute inset-0 flex items-center justify-center"
								transition:clipRevealIcon
							>
								<span class="size-1.5 rounded-full bg-current" aria-hidden="true"></span>
								<span class="sr-only">Paused</span>
							</span>
						{/if}
						</span>
					</span>
				</div>
			</div>


			<!-- Transport -->
			<div class="mt-6 flex items-center gap-3">
				<button
					type="button"
					aria-label="Previous station"
					class="{pressable} flex size-14 items-center justify-center rounded-2xl bg-canvas text-ink hover:bg-divider"
					onclick={() => selectAdjacentStation(-1)}
				>
					<svg viewBox="0 0 24 24" class="size-5" fill="currentColor" aria-hidden="true">
						<path d="M6 5h2v14H6zM19 5L9 12l10 7V5z" />
					</svg>
				</button>
				<button
					type="button"
					aria-label={playbackButtonLabel}
					aria-pressed={hasActivePlayback}
					class="{pressable} flex h-14 flex-1 items-center justify-center rounded-2xl {isPlaybackRecoveryPending ? 'bg-accent text-surface hover:bg-accent/90' : 'bg-ink text-surface hover:bg-ink/90'}"
					onclick={togglePlayback}
				>
					{#if isLoading}
						<svg viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true">
							<rect x="4" y="4" width="16" height="16" rx="2" />
						</svg>
					{:else if isPlaying}
						<svg viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true">
							<rect x="6" y="4" width="4" height="16" rx="1" />
							<rect x="14" y="4" width="4" height="16" rx="1" />
						</svg>
					{:else}
						<svg viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true">
							<path d="M7 4l13 8-13 8V4z" />
						</svg>
					{/if}
				</button>
				<button
					type="button"
					aria-label="Next station"
					class="{pressable} flex size-14 items-center justify-center rounded-2xl bg-canvas text-ink hover:bg-divider"
					onclick={() => selectAdjacentStation(1)}
				>
					<svg viewBox="0 0 24 24" class="size-5" fill="currentColor" aria-hidden="true">
						<path d="M16 5h2v14h-2zM5 5l10 7-10 7V5z" />
					</svg>
				</button>
			</div>

			<!-- Volume -->
			<div class="mt-6 flex items-center gap-3">
				<svg
					viewBox="0 0 24 24"
					class="size-4 shrink-0 text-ink-tertiary"
					fill="none"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path stroke-linecap="round" stroke-linejoin="round" d="M3 9v6h4l5 5V4L7 9H3z" />
					<path stroke-linecap="round" d="M16.5 8.5a5 5 0 0 1 0 7" />
				</svg>
				<input
					type="range"
					min="0"
					max="100"
					value={volume}
					class="h-1 flex-1 touch-manipulation accent-accent"
					aria-label="Volume"
					oninput={updateVolume}
				/>
				<span class="w-6 text-right text-sm tabular-nums text-ink-tertiary">{volume}</span>
			</div>
		</section>

		<!-- Right: stations -->
		<section class="flex flex-col p-6 sm:p-8 lg:min-h-0 lg:overflow-hidden lg:p-14">
			<div class="shrink-0">
				<h2
					id="stations-heading"
					class="mb-4 text-xs font-semibold tracking-widest text-ink-tertiary uppercase"
				>
					Stations
				</h2>
				<ul aria-labelledby="stations-heading">
					{#each stations as s (s.name)}
						{@const active = s.id === sessionState.selectedStationId}
						<li class="flex items-center border-b border-divider last:border-0">
							<button
								type="button"
								aria-current={active ? 'true' : undefined}
								class="{pressable} flex min-w-0 flex-1 items-center gap-1.5 py-4 text-left"
								onclick={() => selectStation(s)}
							>
								<span
									class="size-1.5 shrink-0 rounded-full bg-accent transition-opacity motion-reduce:transition-none {active
										? 'opacity-100'
										: 'opacity-0'}"
								></span>
								<span
									class="truncate text-lg font-bold transition-colors motion-reduce:transition-none {active
										? 'text-accent'
										: 'text-ink'}"
								>
									{s.name}
								</span>
								<sup class="ml-0.5 shrink-0 text-xs font-medium text-ink-tertiary">{s.number}</sup>
								<span class="ml-auto shrink-0 pl-3 text-xs tracking-widest text-ink-tertiary uppercase">
									{s.tag}
								</span>
							</button>
							<button
								type="button"
								aria-pressed={s.favorite}
								aria-label={s.favorite ? `Remove ${s.name} from favorites` : `Add ${s.name} to favorites`}
								class="{iconHit} {pressable} size-8 shrink-0 {s.favorite
									? 'text-accent'
									: 'text-ink-tertiary/40 hover:text-ink-tertiary'}"
								onclick={() => toggleFavorite(s.id)}
							>
								<svg viewBox="0 0 24 24" class="size-3.5" fill="currentColor" aria-hidden="true">
									<path
										d="M12 2.5l2.9 6.6 7.1.6-5.4 4.7 1.6 7L12 17.8 5.8 21.4l1.6-7-5.4-4.7 7.1-.6L12 2.5z"
									/>
								</svg>
							</button>
						</li>
					{/each}
				</ul>
			</div>

			<section
				class="mt-7 flex flex-col border-t border-divider pt-6 lg:min-h-0 lg:flex-1"
				aria-labelledby="listening-history-heading"
			>
				<div class="flex shrink-0 items-center justify-between gap-3">
					<h2
						id="listening-history-heading"
						class="text-xs font-semibold tracking-widest text-ink-tertiary uppercase"
					>
						Listening history
					</h2>
					<div class="flex items-center gap-3">
						<button
							type="button"
							aria-label={lastFmHeaderLabel}
							aria-haspopup="dialog"
							class="{pressable} relative flex shrink-0 items-center justify-center {lastFmConnected &&
							lastFmState.username
								? 'h-8 gap-1.5 rounded-xl bg-accent-subtle px-2.5 text-accent before:absolute before:-inset-2 before:content-[\'\']'
								: `${iconHit} size-8 ${
										lastFmConnected
											? 'bg-accent-subtle text-accent'
											: 'border border-divider text-ink-tertiary hover:bg-canvas hover:text-ink-secondary'
									}`}"
							onclick={openLastFm}
						>
							<svg
								viewBox="0 0 24 24"
								class="size-3.5 shrink-0"
								fill="currentColor"
								aria-hidden="true"
							>
								<path
									d="M10.584 17.21l-.88-2.392s-1.43 1.594-3.573 1.594c-1.897 0-3.244-1.649-3.244-4.288 0-3.382 1.704-4.591 3.381-4.591 2.42 0 3.189 1.567 3.849 3.574l.88 2.749c.88 2.666 2.529 4.81 7.285 4.81 3.409 0 5.718-1.044 5.718-3.793 0-2.227-1.265-3.381-3.63-3.931l-1.758-.385c-1.21-.275-1.567-.77-1.567-1.595 0-.934.742-1.484 1.952-1.484 1.32 0 2.034.495 2.144 1.677l2.749-.33c-.22-2.474-1.924-3.492-4.729-3.492-2.474 0-4.893.935-4.893 3.932 0 1.87.907 3.051 3.189 3.601l1.87.44c1.402.33 1.869.907 1.869 1.704 0 1.017-.99 1.43-2.86 1.43-2.776 0-3.93-1.457-4.59-3.464l-.907-2.75c-1.155-3.573-2.997-4.893-6.653-4.893C2.144 5.333 0 7.89 0 12.233c0 4.18 2.144 6.434 5.993 6.434 3.106 0 4.591-1.457 4.591-1.457z"
								/>
							</svg>
							{#if lastFmConnected && lastFmState.username}
								<span class="max-w-24 truncate text-xs leading-none font-medium"
									>@{lastFmState.username}</span
								>
							{/if}
						</button>
						<span class="rounded-full bg-canvas px-2 py-1 text-xs tabular-nums text-ink-tertiary">
							{historyItems.length}/{LISTENING_HISTORY_LIMIT}
						</span>
					</div>
				</div>

				{#if historyItems.length}
					<ol
						class="history-scroll-mask mt-4 space-y-2 pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
						aria-label="Tracks listened to in this session"
						aria-live="polite"
						aria-relevant="additions"
					>
						{#each historyItems as item, index (item.id)}
							<li
								out:fade={{ duration: prefersReducedMotion.current ? 0 : 90 }}
								animate:flip={{ duration: prefersReducedMotion.current ? 0 : 220, easing: cubicOut }}
							>
								<!-- `in:historyItemEnter` lives on this inner wrapper, not the <li>
								     that carries `animate:flip`. If a second track arrives while a
								     row's enter transition is still mid-flight, Svelte's flip reads
								     getComputedStyle(node).transform once and bakes that half-finished
								     value in as a static prefix for the whole reorder animation — the
								     row gets stuck slightly scaled/offset, then pops to normal when the
								     animation ends. Keeping the two transforms on separate elements
								     means flip always starts from a clean `none` baseline. -->
								<div
									class="relative rounded-2xl border border-divider bg-canvas/40 p-3 transition-colors will-change-transform hover:bg-canvas motion-reduce:transition-none"
									in:historyItemEnter
								>
									{#if index === 0}
										<div
											class="pointer-events-none absolute inset-0 rounded-[inherit] bg-[radial-gradient(circle_at_18%_50%,color-mix(in_oklch,var(--color-accent)_24%,transparent),transparent_54%)] will-change-[transform,opacity] motion-reduce:hidden"
											style:opacity={prefersReducedMotion.current ? 0 : historyArrivalGlow.current * 0.22}
											style:transform={`scale(${0.96 + historyArrivalGlow.current * 0.07})`}
											aria-hidden="true"
										></div>
									{/if}
									<div class="relative">
										<TrackSummary
											rowClass="flex items-center gap-3"
											artworkSize="md"
											title={item.title}
											artist={item.artist}
											meta={`${formatHistoryTimestamp(item.listenedAt)} · ${item.stationName}`}
											artworkUrl={item.artworkUrl}
											artworkAlt={`Artwork for ${item.title} by ${item.artist}`}
											fallbackAriaLabel={`Live badge for ${item.stationName}`}
											appleMusicMode="link"
											appleMusicHref={item.appleMusicUrl}
											appleMusicLoading={item.isAppleMusicLookupLoading}
											appleMusicUnavailableLabel={item.appleMusicUrl === null && !item.isAppleMusicLookupLoading ? 'Unavailable' : ''}
											badgeLabel={index === 0 ? 'Latest' : ''}
											titleFirst
											{pressable}
										/>
									</div>
								</div>
							</li>
						{/each}
					</ol>
				{:else}
					<p class="mt-4 text-sm text-ink-secondary">
						Press play to capture tracks here with their station and time.
					</p>
				{/if}
			</section>
		</section>
	</div>
</main>

