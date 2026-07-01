import type { CurrentTrack } from './api';
import { normalizeTrackText } from './text';

export type GraphTrackMetadata = {
	id: string | undefined;
	title: string;
	artist: string;
	album: string | null | undefined;
	year: number | null | undefined;
	start: number | undefined;
	end: number | undefined;
};

export type LiveTrackMetadata = {
	id: string;
	title: string;
	artist: string;
	artworkUrl: string;
	start: number | null;
	end: number | null;
};

export type LiveMetadataSnapshot = {
	now: LiveTrackMetadata | null;
	next: LiveTrackMetadata | null;
};

export function selectCurrentLiveTrack(
	snapshot: LiveMetadataSnapshot | null,
	nowSeconds: number,
): LiveTrackMetadata | null {
	if (snapshot === null) return null;
	if (
		typeof snapshot.next?.start === 'number' &&
		nowSeconds >= snapshot.next.start &&
		isLiveTrackActive(snapshot.next, nowSeconds)
	) {
		return snapshot.next;
	}
	if (snapshot.now === null) return null;
	if (isLiveTrackActive(snapshot.now, nowSeconds)) return snapshot.now;
	return null;
}

function isLiveTrackActive(track: LiveTrackMetadata, nowSeconds: number) {
	return typeof track.end !== 'number' || nowSeconds < track.end;
}

export function buildCurrentTrack(
	station: string,
	graphTrack: GraphTrackMetadata | null,
	liveTrack: LiveTrackMetadata | null,
): CurrentTrack | null {
	if (graphTrack === null && liveTrack === null) return null;

	const liveTrackMatchesGraph =
		graphTrack !== null &&
		liveTrack !== null &&
		normalizeTrackText(liveTrack.title) === normalizeTrackText(graphTrack.title) &&
		normalizeTrackText(liveTrack.artist) === normalizeTrackText(graphTrack.artist);
	const shouldUseGraphDetails =
		graphTrack !== null && (liveTrack === null || liveTrackMatchesGraph);

	return {
		id: liveTrack?.id ?? graphTrack?.id ?? `${station}:${graphTrack?.start ?? 0}`,
		title: liveTrack?.title ?? graphTrack?.title ?? '',
		artist: liveTrack?.artist ?? graphTrack?.artist ?? 'Unknown artist',
		album: shouldUseGraphDetails ? graphTrack.album || 'Single' : 'Single',
		year: shouldUseGraphDetails ? (graphTrack.year ?? null) : null,
		artworkUrl: liveTrack?.artworkUrl ?? null,
		start: liveTrack?.start ?? graphTrack?.start ?? 0,
		end: liveTrack?.end ?? graphTrack?.end ?? 0,
	};
}
