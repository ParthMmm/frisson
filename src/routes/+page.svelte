<script lang="ts">
	import { flip } from 'svelte/animate';
	import { cubicOut, quintOut } from 'svelte/easing';
	import { Tween, prefersReducedMotion } from 'svelte/motion';
	import { writable } from 'svelte/store';
	import { onMount, tick } from 'svelte';
	import { fade, fly } from 'svelte/transition';
	import { normalizeTrackText } from '$lib/text';
	import { isAbortError } from '$lib/errors';
	import { getCurrentTrackCacheExpiresAt, getMetadataRefreshDelay } from '$lib/metadata-refresh';
	import type { AppleMusicLookupResponse, CurrentTrack } from '$lib/api';
	import Tuner from '$lib/Tuner.svelte';
	import TrackSummary from '$lib/TrackSummary.svelte';

	type Station = {
		name: string;
		number: string;
		tag: string;
		shortName: string;
		streamUrl: string;
		apiStation: string;
		favorite: boolean;
	};

	type ListeningHistoryItem = {
		id: string;
		title: string;
		artist: string;
		artworkUrl: string | null;
		appleMusicUrl: string | null;
		isAppleMusicLookupLoading: boolean;
		stationName: string;
		stationTag: string;
		listenedAt: number;
	};

	type CachedCurrentTrack = {
		track: CurrentTrack | null;
		expiresAt: number;
	};

	type CurrentTrackResponse = CurrentTrack | null;

	type PlaybackState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';
	type MetadataState = 'idle' | 'loading' | 'ready' | 'error';

	const METADATA_SAFETY_POLL_MS = 120_000;
	const LISTENING_HISTORY_LIMIT = 30;
	const LISTENING_HISTORY_STORAGE_KEY = 'frisson-listening-history-v1';
	const LEGACY_LISTENING_HISTORY_STORAGE_KEY = 'fip-listening-history-v1';
	const FAVORITE_STATIONS_STORAGE_KEY = 'frisson-favorite-stations-v1';
	const FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY = 'frisson-favorite-stations-customized-v1';
	const THEME_STORAGE_KEY = 'frisson-theme';
	const LEGACY_THEME_STORAGE_KEY = 'fip-theme';
	const SELECTED_STATION_STORAGE_KEY = 'frisson-selected-station';
	const APPLE_MUSIC_URL_CACHE_LIMIT = 128;
	const historyTimeFormatter = new Intl.DateTimeFormat(undefined, {
		hour: '2-digit',
		minute: '2-digit'
	});
	const historyDateFormatter = new Intl.DateTimeFormat(undefined, {
		month: 'numeric',
		day: 'numeric'
	});
	const currentTrackCache = new Map<string, CachedCurrentTrack>();
	const appleMusicUrlCache = new Map<string, string | null>();
	const appleMusicUrlRequests = new Map<string, Promise<string | null>>();

	let stations = $state<Station[]>([
		{
			name: 'FIP',
			number: '7',
			tag: '105.1 MHZ',
			shortName: 'FIP',
			streamUrl: 'https://icecast.radiofrance.fr/fip-midfi.mp3',
			apiStation: 'FIP',
			favorite: false
		},
		{
			name: 'FIP Rock',
			number: '64',
			tag: 'ROCK',
			shortName: 'ROCK',
			streamUrl: 'https://icecast.radiofrance.fr/fiprock-midfi.mp3',
			apiStation: 'FIP_ROCK',
			favorite: false
		},
		{
			name: 'FIP Jazz',
			number: '65',
			tag: 'JAZZ',
			shortName: 'JAZZ',
			streamUrl: 'https://icecast.radiofrance.fr/fipjazz-midfi.mp3',
			apiStation: 'FIP_JAZZ',
			favorite: false
		},
		{
			name: 'FIP Groove',
			number: '66',
			tag: 'GROOVE',
			shortName: 'GROOVE',
			streamUrl: 'https://icecast.radiofrance.fr/fipgroove-midfi.mp3',
			apiStation: 'FIP_GROOVE',
			favorite: true
		},
		{
			name: 'FIP Monde',
			number: '69',
			tag: 'MONDE',
			shortName: 'MONDE',
			streamUrl: 'https://icecast.radiofrance.fr/fipworld-midfi.mp3',
			apiStation: 'FIP_WORLD',
			favorite: false
		},
		{
			name: 'FIP Nouveautés',
			number: '70',
			tag: 'NOUVEAUTÉS',
			shortName: 'NOUVO',
			streamUrl: 'https://icecast.radiofrance.fr/fipnouveautes-midfi.mp3',
			apiStation: 'FIP_NOUVEAUTES',
			favorite: true
		},
		{
			name: 'FIP Reggae',
			number: '71',
			tag: 'REGGAE',
			shortName: 'REGGAE',
			streamUrl: 'https://icecast.radiofrance.fr/fipreggae-midfi.mp3',
			apiStation: 'FIP_REGGAE',
			favorite: false
		},
		{
			name: 'FIP Electro',
			number: '74',
			tag: 'ELECTRO',
			shortName: 'ELECTRO',
			streamUrl: 'https://icecast.radiofrance.fr/fipelectro-midfi.mp3',
			apiStation: 'FIP_ELECTRO',
			favorite: false
		},
		{
			name: 'FIP Metal',
			number: '77',
			tag: 'METAL',
			shortName: 'METAL',
			streamUrl: 'https://icecast.radiofrance.fr/fipmetal-midfi.mp3',
			apiStation: 'FIP_METAL',
			favorite: false
		},
		{
			name: 'FIP Pop',
			number: '78',
			tag: 'POP',
			shortName: 'POP',
			streamUrl: 'https://icecast.radiofrance.fr/fippop-midfi.mp3',
			apiStation: 'FIP_POP',
			favorite: false
		},
		{
			name: 'FIP Hip-Hop',
			number: '95',
			tag: 'HIP-HOP',
			shortName: 'HIP-HOP',
			streamUrl: 'https://icecast.radiofrance.fr/fiphiphop-midfi.mp3',
			apiStation: 'FIP_HIP_HOP',
			favorite: false
		}
	]);

	let selectedStationName = $state('FIP Nouveautés');
	let playbackState = $state<PlaybackState>('idle');
	let volume = $state(80);
	let theme = $state<'light' | 'dark'>('light');
	let audioElement: HTMLAudioElement;
	let fipInfoDialog: HTMLDialogElement | undefined = $state();
	let playbackError = $state('');
	let shareMessage = $state('');
	let currentTrack = $state<CurrentTrack | null>(null);
	const listeningHistory = writable<ListeningHistoryItem[]>([]);
	let lastHistorySignature = '';
	let metadataState = $state<MetadataState>('idle');
	let isAppleMusicLookupLoading = $state(false);
	let appleMusicLookupRevision = $state(0);
	let currentTrackRequest: AbortController | null = null;
	let currentTrackRequestId = 0;
	let metadataPoll: number | null = null;
	let metadataRefreshTimeout: number | null = null;
	let playRequestId = 0;

	// Shared Tailwind class strings instead of custom CSS classes — one
	// definition, applied wherever a button needs it, no `@layer components`.
	// `pressable`: press feedback, focus ring, reduced-motion handling.
	// `iconHit`: pads a small round icon button's hit target to ~44px via a
	// `before:` pseudo-element without changing its visible size.
	const pressable =
		"transition-[background-color,color,transform] duration-150 ease-out touch-manipulation active:scale-[0.97] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink motion-reduce:active:scale-100 motion-reduce:transition-none";
	const iconHit =
		"relative flex items-center justify-center rounded-full before:absolute before:-inset-2 before:content-['']";
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

	let historyArrivalPulse = 0;

	const selectedStation = $derived(
		stations.find((station) => station.name === selectedStationName) ?? stations[0]
	);
	const isPlaying = $derived(playbackState === 'playing');
	const isLoading = $derived(playbackState === 'loading');
	const stationPulseScale = $derived(isPlaying ? 1 + stationPulse.current * 2.4 : 1);
	const stationPulseOpacity = $derived(
		isPlaying && !prefersReducedMotion.current ? (1 - stationPulse.current) * 0.45 : 0
	);
	const stationDotColor = $derived(isLoading ? 'oklch(72% 0.17 70)' : 'var(--color-accent)');
	const hasActivePlayback = $derived(isPlaying || isLoading);
	const fipInfoScale = $derived(0.96 + fipInfoMotion.current * 0.04);
	const fipInfoOffset = $derived((1 - fipInfoMotion.current) * 10);
	const fipInfoBackdropOpacity = $derived(fipInfoMotion.current);
	const playbackProgress = $derived(isPlaying ? 1 : isLoading ? 0.35 : 0);
	const playbackProgressMotion = Tween.of(() => playbackProgress, {
		duration: () => (prefersReducedMotion.current ? 0 : 300),
		easing: quintOut
	});
	const statusLabel = $derived(
		playbackState === 'playing'
			? 'On air'
			: playbackState === 'loading'
				? 'Buffering'
				: playbackState === 'error'
					? 'Unavailable'
					: playbackState === 'paused'
						? 'Paused'
						: '' // idle: nothing to report before the first play
	);
	const currentTrackAppleMusicMode = $derived.by(() => {
		void appleMusicLookupRevision;
		return currentTrack && !hasNoAppleMusicMatch(currentTrack) ? 'button' : 'none';
	});

	$effect(() => {
		if (!hasActivePlayback || !currentTrack) return;
		recordListeningHistory(currentTrack, selectedStation);
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

	onMount(() => {
		// app.html already set this pre-paint; just mirror it into state.
		theme = (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light';
		applyPersistedFavoriteStations();
		selectedStationName = readPersistedSelectedStationName() ?? selectedStationName;
		listeningHistory.set(readPersistedListeningHistory());
		const unsubscribeListeningHistory = listeningHistory.subscribe(persistListeningHistory);
		void loadCurrentTrack(selectedStation);
		metadataPoll = window.setInterval(() => {
			void loadCurrentTrack(selectedStation);
		}, METADATA_SAFETY_POLL_MS);

		return () => {
			unsubscribeListeningHistory();
			if (metadataPoll !== null) window.clearInterval(metadataPoll);
			clearNextMetadataRefresh();
			currentTrackRequest?.abort();
		};
	});

	function readPersistedSelectedStationName() {
		try {
			const stored = localStorage.getItem(SELECTED_STATION_STORAGE_KEY);
			if (!stored) return null;

			return stations.some((station) => station.name === stored) ? stored : null;
		} catch {
			return null;
		}
	}

	function persistSelectedStationName(name: string) {
		try {
			localStorage.setItem(SELECTED_STATION_STORAGE_KEY, name);
		} catch {
			/* private browsing, storage quota, etc. */
		}
	}

	function applyPersistedFavoriteStations() {
		try {
			const stored = localStorage.getItem(FAVORITE_STATIONS_STORAGE_KEY);
			if (!stored) {
				if (localStorage.getItem(FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY)) {
					for (const station of stations) {
						station.favorite = false;
					}
				}
				return;
			}

			const parsed: unknown = JSON.parse(stored);
			if (!Array.isArray(parsed)) return;

			const favoriteNames = new Set(
				parsed.filter((name): name is string => typeof name === 'string')
			);
			for (const station of stations) {
				station.favorite = favoriteNames.has(station.name);
			}
		} catch {
			/* private browsing, malformed data, etc. */
		}
	}

	function persistFavoriteStations() {
		try {
			const favoriteNames = stations
				.filter((station) => station.favorite)
				.map((station) => station.name);

			if (favoriteNames.length === 0) {
				localStorage.removeItem(FAVORITE_STATIONS_STORAGE_KEY);
				localStorage.setItem(FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY, 'true');
				return;
			}

			localStorage.setItem(FAVORITE_STATIONS_STORAGE_KEY, JSON.stringify(favoriteNames));
			localStorage.setItem(FAVORITE_STATIONS_CUSTOMIZED_STORAGE_KEY, 'true');
		} catch {
			/* private browsing, storage quota, etc. */
		}
	}

	function readPersistedListeningHistory() {
		try {
			const stored =
				localStorage.getItem(LISTENING_HISTORY_STORAGE_KEY) ??
				localStorage.getItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
			if (!stored) return [];

			const parsed: unknown = JSON.parse(stored);
			if (!Array.isArray(parsed)) return [];

			return parsed
				.filter(isListeningHistoryItem)
				.map((item) => ({ ...item, isAppleMusicLookupLoading: false }))
				.slice(0, LISTENING_HISTORY_LIMIT);
		} catch {
			return [];
		}
	}

	function persistListeningHistory(items: ListeningHistoryItem[]) {
		try {
			if (items.length === 0) {
				localStorage.removeItem(LISTENING_HISTORY_STORAGE_KEY);
				localStorage.removeItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
				return;
			}

			localStorage.setItem(LISTENING_HISTORY_STORAGE_KEY, JSON.stringify(items));
			localStorage.removeItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
		} catch {
			/* private browsing, storage quota, etc. */
		}
	}

	function isListeningHistoryItem(value: unknown): value is ListeningHistoryItem {
		if (!value || typeof value !== 'object') return false;

		const item = value as Record<string, unknown>;
		return (
			typeof item.id === 'string' &&
			typeof item.title === 'string' &&
			typeof item.artist === 'string' &&
			(item.artworkUrl === null || typeof item.artworkUrl === 'string') &&
			(item.appleMusicUrl === null || typeof item.appleMusicUrl === 'string') &&
			typeof item.isAppleMusicLookupLoading === 'boolean' &&
			typeof item.stationName === 'string' &&
			typeof item.stationTag === 'string' &&
			typeof item.listenedAt === 'number' &&
			Number.isFinite(item.listenedAt)
		);
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
	async function shareStation() {
		shareMessage = '';

		const shareData = {
			title: selectedStation.name,
			text: `Listen to ${selectedStation.name} on Frisson.`,
			url: selectedStation.streamUrl
		};

		try {
			if (navigator.share) {
				await navigator.share(shareData);
				shareMessage = 'Share sheet opened.';
				return;
			}

			await navigator.clipboard.writeText(selectedStation.streamUrl);
			shareMessage = 'Stream link copied.';
		} catch (error) {
			if (isAbortError(error)) return;
			shareMessage = 'Sharing is unavailable in this browser.';
		}
	}

	async function openCurrentTrackInAppleMusic() {
		if (!currentTrack) {
			shareMessage = 'No current track to open.';
			return;
		}

		isAppleMusicLookupLoading = true;
		shareMessage = '';

		try {
			const url = await lookupAppleMusicUrl(currentTrack);
			if (!url) return;

			const appleMusicWindow = window.open(url, '_blank');
			if (appleMusicWindow) {
				appleMusicWindow.opener = null;
				shareMessage = 'Opening Apple Music.';
				return;
			}

			window.location.assign(url);
		} catch {
			shareMessage = 'Apple Music lookup failed.';
		} finally {
			isAppleMusicLookupLoading = false;
		}
	}

	function readCachedCurrentTrack(station: Station) {
		const cached = currentTrackCache.get(station.apiStation);
		if (!cached) return false;

		if (Date.now() >= cached.expiresAt) {
			currentTrackCache.delete(station.apiStation);
			return false;
		}

		currentTrack = cached.track;
		metadataState = 'ready';
		scheduleNextMetadataRefresh(station, cached.track);
		return true;
	}

	function cacheCurrentTrack(station: Station, track: CurrentTrack | null) {
		const now = Date.now();
		const expiresAt = getCurrentTrackCacheExpiresAt(now, track?.end);
		currentTrackCache.set(station.apiStation, { track, expiresAt });
	}

	function clearNextMetadataRefresh() {
		if (metadataRefreshTimeout === null) return;

		window.clearTimeout(metadataRefreshTimeout);
		metadataRefreshTimeout = null;
	}

	function scheduleNextMetadataRefresh(station: Station, track: CurrentTrack | null) {
		clearNextMetadataRefresh();

		const delay = getMetadataRefreshDelay(Date.now(), track?.end);
		metadataRefreshTimeout = window.setTimeout(() => {
			metadataRefreshTimeout = null;
			if (station.apiStation !== selectedStation.apiStation) return;

			void loadCurrentTrack(station);
		}, delay);
	}

	function recordListeningHistory(track: CurrentTrack, station: Station) {
		const historySignature = `${station.apiStation}:${track.id}:${track.start}`;
		if (lastHistorySignature === historySignature) return;

		const appleMusicLookupKey = getAppleMusicLookupKey(track);
		const cachedAppleMusicUrl = appleMusicUrlCache.get(appleMusicLookupKey);
		lastHistorySignature = historySignature;
		listeningHistory.update((items) =>
			[
				{
					id: historySignature,
					title: track.title,
					artist: track.artist,
					artworkUrl: track.artworkUrl,
					appleMusicUrl: cachedAppleMusicUrl ?? null,
					isAppleMusicLookupLoading: !appleMusicUrlCache.has(appleMusicLookupKey),
					stationName: station.name,
					stationTag: station.tag,
					listenedAt: Date.now()
				},
				...items.filter((item) => item.id !== historySignature)
			].slice(0, LISTENING_HISTORY_LIMIT)
		);

		void pulseHistoryArrival();

		if (!appleMusicUrlCache.has(appleMusicLookupKey)) {
			void loadHistoryAppleMusicUrl(historySignature, track);
		}
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

	function getAppleMusicLookupKey(track: Pick<CurrentTrack, 'title' | 'artist'>) {
		return `${normalizeTrackText(track.title)}:${normalizeTrackText(track.artist)}`;
	}

	function hasNoAppleMusicMatch(track: Pick<CurrentTrack, 'title' | 'artist'> | null) {
		if (!track) return false;

		const appleMusicLookupKey = getAppleMusicLookupKey(track);
		return appleMusicUrlCache.has(appleMusicLookupKey) && appleMusicUrlCache.get(appleMusicLookupKey) === null;
	}

	function cacheAppleMusicUrl(key: string, url: string | null) {
		if (!appleMusicUrlCache.has(key) && appleMusicUrlCache.size >= APPLE_MUSIC_URL_CACHE_LIMIT) {
			const oldestKey = appleMusicUrlCache.keys().next().value;
			if (oldestKey !== undefined) appleMusicUrlCache.delete(oldestKey);
		}
		appleMusicUrlCache.set(key, url);
		appleMusicLookupRevision += 1;
	}

	async function lookupAppleMusicUrl(track: Pick<CurrentTrack, 'title' | 'artist'>) {
		const appleMusicLookupKey = getAppleMusicLookupKey(track);
		if (appleMusicUrlCache.has(appleMusicLookupKey)) {
			return appleMusicUrlCache.get(appleMusicLookupKey) ?? null;
		}

		const pendingRequest = appleMusicUrlRequests.get(appleMusicLookupKey);
		if (pendingRequest) return pendingRequest;

		const request = fetchAppleMusicUrl(track)
			.then((url) => {
				cacheAppleMusicUrl(appleMusicLookupKey, url);
				return url;
			})
			.finally(() => {
				appleMusicUrlRequests.delete(appleMusicLookupKey);
			});

		appleMusicUrlRequests.set(appleMusicLookupKey, request);
		return request;
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

	async function loadHistoryAppleMusicUrl(historyId: string, track: CurrentTrack) {
		const appleMusicLookupKey = getAppleMusicLookupKey(track);

		try {
			const url = await lookupAppleMusicUrl(track);
			updateHistoryAppleMusicUrl(historyId, url, false);
		} catch {
			cacheAppleMusicUrl(appleMusicLookupKey, null);
			updateHistoryAppleMusicUrl(historyId, null, false);
		}
	}

	function updateHistoryAppleMusicUrl(
		historyId: string,
		appleMusicUrl: string | null,
		isAppleMusicLookupLoading: boolean
	) {
		listeningHistory.update((items) =>
			items.map((item) =>
				item.id === historyId ? { ...item, appleMusicUrl, isAppleMusicLookupLoading } : item
			)
		);
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

	async function loadCurrentTrack(station: Station) {
		if (station.apiStation !== selectedStation.apiStation) return;
		const requestId = ++currentTrackRequestId;
		currentTrackRequest?.abort();
		currentTrackRequest = null;

		if (readCachedCurrentTrack(station)) return;

		const controller = new AbortController();
		currentTrackRequest = controller;
		if (!currentTrack) metadataState = 'loading';

		try {
			const params = new URLSearchParams({
				station: station.apiStation,
				number: station.number,
				name: station.name
			});
			const response = await fetch(`/api/current-track?${params}`, { signal: controller.signal });

			if (!response.ok) throw new Error(`Current track metadata returned HTTP ${response.status}`);

			const track = (await response.json()) as CurrentTrackResponse;
			if (controller.signal.aborted || !isCurrentTrackRequest(station, requestId)) return;

			currentTrack = track;
			cacheCurrentTrack(station, track);
			scheduleNextMetadataRefresh(station, track);
			metadataState = 'ready';
		} catch (error) {
			if (isAbortError(error)) return;
			if (controller.signal.aborted || !isCurrentTrackRequest(station, requestId)) return;

			metadataState = 'error';
			scheduleNextMetadataRefresh(station, null);
		} finally {
			if (currentTrackRequest === controller) currentTrackRequest = null;
		}
	}

	function isCurrentTrackRequest(station: Station, requestId: number) {
		return requestId === currentTrackRequestId && station.apiStation === selectedStation.apiStation;
	}

	function applyVolume() {
		if (!audioElement) return;
		audioElement.volume = volume / 100;
	}

	async function play() {
		if (!audioElement) return;

		const requestId = ++playRequestId;
		playbackState = 'loading';
		playbackError = '';
		applyVolume();

		try {
			await audioElement.play();
			if (requestId === playRequestId) playbackState = 'playing';
		} catch {
			if (requestId !== playRequestId) return;

			playbackState = 'error';
			playbackError = 'Playback was blocked or the stream is unavailable.';
		}
	}

	function pause() {
		playRequestId += 1;
		audioElement?.pause();
		playbackState = 'paused';
	}

	function togglePlayback() {
		if (hasActivePlayback) {
			pause();
			return;
		}

		void play();
	}

	async function selectStation(station: Station) {
		if (station.name === selectedStationName) {
			if (!hasActivePlayback) void play();
			return;
		}

		playRequestId += 1;
		selectedStationName = station.name;
		persistSelectedStationName(station.name);
		playbackError = '';
		shareMessage = '';
		currentTrack = null;
		clearNextMetadataRefresh();
		void loadCurrentTrack(station);
		playbackState = 'loading';

		await tick();
		audioElement?.load();
		await play();
	}

	function selectAdjacentStation(direction: -1 | 1) {
		const currentIndex = stations.findIndex((station) => station.name === selectedStationName);
		const nextIndex = (currentIndex + direction + stations.length) % stations.length;
		void selectStation(stations[nextIndex]);
	}

	function updateVolume(event: Event) {
		volume = Number((event.currentTarget as HTMLInputElement).value);
		applyVolume();
	}

	function toggleFavorite(name: string) {
		const station = stations.find((s) => s.name === name);
		if (!station) return;

		station.favorite = !station.favorite;
		persistFavoriteStations();
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
	onplaying={() => {
		playbackState = 'playing';
		playbackError = '';
	}}
	onwaiting={() => {
		if (playbackState !== 'paused') playbackState = 'loading';
	}}
	onpause={() => {
		if (playbackState !== 'error') playbackState = 'paused';
	}}
	onerror={() => {
		playbackState = 'error';
		playbackError = 'The selected FIP stream could not be loaded.';
	}}
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

<div class="min-h-screen bg-surface lg:h-screen lg:overflow-hidden">
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
						class="{iconHit} {pressable} size-7 border border-divider text-xs font-bold text-ink-secondary hover:bg-canvas"
						onclick={openFipInfo}
					>
						?
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
								<circle cx="12" cy="12" r="4" />
								<path
									d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
								/>
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
					{#key selectedStation.name}
						<span transition:fade={{ duration: prefersReducedMotion.current ? 0 : 140 }}>{selectedStation.name}</span>
					{/key}
				</div>
				<div class="flex items-center gap-3">
					<button
						type="button"
						aria-label={selectedStation.favorite
							? `Remove ${selectedStation.name} from favorites`
							: `Add ${selectedStation.name} to favorites`}
						aria-pressed={selectedStation.favorite}
						class="{iconHit} {pressable} size-9 {selectedStation.favorite ? 'bg-accent-subtle text-accent' : 'border border-divider text-ink-tertiary/50 hover:bg-canvas hover:text-ink-tertiary'}"
						onclick={() => toggleFavorite(selectedStation.name)}
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
						<svg viewBox="0 0 24 24" class="size-4" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
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
			<p class="mt-3 text-ink-secondary">
				Radio France · webradio
				{#if statusLabel}
					<span class="text-ink-tertiary">—</span>
					<span class="font-medium text-accent" role="status" aria-live="polite">{statusLabel}</span
					>
				{/if}
			</p>
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
					selectedName={selectedStationName}
					onSelect={(name) => {
						const station = stations.find((s) => s.name === name);
						if (station) void selectStation(station);
					}}
				/>
			</div>

			<!-- Now playing -->
			<TrackSummary
				rowClass="mt-8 flex items-center gap-4"
				title={currentTrack?.title ?? selectedStation.name}
				artist={metadataState === 'loading' && currentTrack === null
					? 'Loading current track'
					: metadataState === 'error'
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
				<div class="h-1 overflow-hidden rounded-full bg-divider">
					<div
						class="h-full origin-left rounded-full bg-accent will-change-transform"
						style:transform={`scaleX(${prefersReducedMotion.current ? playbackProgress : playbackProgressMotion.current})`}
					></div>
				</div>
				<div class="mt-1.5 flex justify-between text-xs tabular-nums text-ink-tertiary">
					<span>Live</span>
					<span>{isLoading ? 'Buffering' : isPlaying ? '∞' : 'Paused'}</span>
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
					aria-pressed={hasActivePlayback}
					class="{pressable} flex h-14 flex-1 items-center justify-center gap-2 rounded-2xl bg-ink font-semibold text-surface hover:bg-ink/90"
					onclick={togglePlayback}
				>
					{#if hasActivePlayback}
						<svg viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true">
							<rect x="6" y="4" width="4" height="16" rx="1" />
							<rect x="14" y="4" width="4" height="16" rx="1" />
						</svg>
						{isLoading ? 'Cancel' : 'Pause'}
					{:else}
						<svg viewBox="0 0 24 24" class="size-4" fill="currentColor" aria-hidden="true">
							<path d="M7 4l13 8-13 8V4z" />
						</svg>
						Play
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
						{@const active = s.name === selectedStationName}
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
								onclick={() => toggleFavorite(s.name)}
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
					<span class="rounded-full bg-canvas px-2 py-1 text-xs tabular-nums text-ink-tertiary">
						{$listeningHistory.length}/{LISTENING_HISTORY_LIMIT}
					</span>
				</div>

				{#if $listeningHistory.length}
					<ol
						class="history-scroll-mask mt-4 space-y-2 pr-1 lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:overscroll-contain"
						aria-label="Tracks listened to in this session"
						aria-live="polite"
						aria-relevant="additions"
					>
						{#each $listeningHistory as item, index (item.id)}
							<li
								class="relative rounded-2xl border border-divider bg-canvas/40 p-3 transition-colors hover:bg-canvas motion-reduce:transition-none"
								in:fly={{
									y: prefersReducedMotion.current ? 0 : -12,
									duration: prefersReducedMotion.current ? 0 : 220,
									opacity: prefersReducedMotion.current ? 1 : 0,
									easing: quintOut
								}}
								out:fade={{ duration: prefersReducedMotion.current ? 0 : 90 }}
								animate:flip={{ duration: prefersReducedMotion.current ? 0 : 220, easing: cubicOut }}
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
										badgeLabel={index === 0 ? 'Latest' : ''}
										titleFirst
										{pressable}
									/>
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
</div>

