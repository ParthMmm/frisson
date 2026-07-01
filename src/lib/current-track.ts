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

export function buildCurrentTrack(
	station: string,
	graphTrack: GraphTrackMetadata,
	liveTrack: LiveTrackMetadata | null,
): CurrentTrack {
	const liveTrackMatchesGraph =
		liveTrack !== null &&
		normalizeTrackText(liveTrack.title) === normalizeTrackText(graphTrack.title) &&
		normalizeTrackText(liveTrack.artist) === normalizeTrackText(graphTrack.artist);
	const shouldUseGraphDetails = liveTrack === null || liveTrackMatchesGraph;

	return {
		id: liveTrack?.id ?? graphTrack.id ?? `${station}:${graphTrack.start ?? 0}`,
		title: liveTrack?.title ?? graphTrack.title,
		artist: liveTrack?.artist ?? graphTrack.artist,
		album: shouldUseGraphDetails ? graphTrack.album || 'Single' : 'Single',
		year: shouldUseGraphDetails ? (graphTrack.year ?? null) : null,
		artworkUrl: liveTrack?.artworkUrl ?? null,
		start: liveTrack?.start ?? graphTrack.start ?? 0,
		end: liveTrack?.end ?? graphTrack.end ?? 0,
	};
}
