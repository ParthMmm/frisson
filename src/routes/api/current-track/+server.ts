import { error, json } from '@sveltejs/kit';
import { normalizeTrackText } from '$lib/text';
import { isAbortError } from '$lib/errors';
import type { CurrentTrack } from '$lib/api';
import type { RequestHandler } from './$types';


type LiveTrackMetadata = {
	title: string;
	artist: string;
	artworkUrl: string;
	start: number | null;
	end: number | null;
};

type RadioFranceTrack = {
	title?: string;
	albumTitle?: string | null;
	mainArtists?: string[] | null;
	productionDate?: number | null;
};

type RadioFranceSong = {
	id?: string;
	start?: number;
	end?: number;
	track?: RadioFranceTrack | null;
};

type RadioFranceCurrentTrackResponse = {
	data?: {
		live?: {
			song?: RadioFranceSong | null;
		} | null;
	} | null;
	errors?: { message?: string }[];
};

type LiveMetadataResponse = {
	now?: {
		cover?: unknown;
		songUuid?: unknown;
		firstLine?: unknown;
		secondLine?: unknown;
		startTime?: unknown;
		endTime?: unknown;
	} | null;
};

const RADIO_FRANCE_GRAPHQL_ENDPOINT = 'https://openapi.radiofrance.fr/v1/graphql';
const RADIO_FRANCE_TOKEN = 'b0b8d190-44b8-449f-b3fc-62cf10d3c461';
const RADIO_FRANCE_LIVEMETA_ENDPOINT = 'https://api.radiofrance.fr/livemeta/live';
const CURRENT_TRACK_QUERY = `
	query CurrentTrack($station: StationsEnum!) {
		live(station: $station) {
			song {
				id
				start
				end
				track {
					title
					albumTitle
					mainArtists
					productionDate
				}
			}
		}
	}
`;

export const GET: RequestHandler = async ({ fetch, request, url }) => {
	const station = url.searchParams.get('station')?.trim();
	const stationNumber = url.searchParams.get('number')?.trim();
	const stationName = url.searchParams.get('name')?.trim();

	if (!station || !stationNumber || !stationName) error(400, 'Missing station metadata');

	const response = await fetch(RADIO_FRANCE_GRAPHQL_ENDPOINT, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'x-token': RADIO_FRANCE_TOKEN
		},
		body: JSON.stringify({
			query: CURRENT_TRACK_QUERY,
			variables: { station }
		}),
		signal: request.signal
	});

	if (!response.ok) error(502, `Radio France metadata returned HTTP ${response.status}`);

	const payload = (await response.json()) as RadioFranceCurrentTrackResponse;
	if (payload.errors?.length) error(502, payload.errors[0]?.message ?? 'Metadata unavailable');

	const song = payload.data?.live?.song;
	if (!song?.track) return json(null satisfies CurrentTrack | null);

	const graphTitle = String(song.track.title ?? '').trim();
	const graphArtist = song.track.mainArtists?.join(', ') || 'Unknown artist';
	const liveTrack = await loadCurrentLiveMetadata(fetch, stationName, stationNumber, request.signal);
	const liveTrackMatchesGraph =
		liveTrack !== null &&
		normalizeTrackText(liveTrack.title) === normalizeTrackText(graphTitle) &&
		normalizeTrackText(liveTrack.artist) === normalizeTrackText(graphArtist);
	const shouldUseGraphDetails = liveTrack === null || liveTrackMatchesGraph;

	return json({
		id: song.id ?? `${station}:${song.start ?? 0}`,
		title: liveTrack?.title ?? graphTitle,
		artist: liveTrack?.artist ?? graphArtist,
		album: shouldUseGraphDetails ? song.track.albumTitle || 'Single' : 'Single',
		year: shouldUseGraphDetails ? (song.track.productionDate ?? null) : null,
		artworkUrl: liveTrack?.artworkUrl ?? null,
		start: liveTrack?.start ?? song.start ?? 0,
		end: liveTrack?.end ?? song.end ?? 0
	} satisfies CurrentTrack);
};

async function loadCurrentLiveMetadata(
	fetch: typeof globalThis.fetch,
	stationName: string,
	stationNumber: string,
	signal: AbortSignal
): Promise<LiveTrackMetadata | null> {
	try {
		const stationFormat = stationName === 'FIP' ? 'webrf_fip_player' : 'webrf_webradio_player';
		const response = await fetch(
			`${RADIO_FRANCE_LIVEMETA_ENDPOINT}/${stationNumber}/${stationFormat}`,
			{ signal }
		);

		if (!response.ok) return null;

		const metadata = (await response.json()) as LiveMetadataResponse;
		const now = metadata.now;
		const cover = now?.cover;
		const songUuid = now?.songUuid;
		const title = String(now?.firstLine ?? '').trim();
		const artist = String(now?.secondLine ?? '').trim();

		if (!cover || !songUuid || !title || !artist) return null;

		return {
			title,
			artist,
			artworkUrl: `https://www.radiofrance.fr/pikapi/images/${cover}/200x200`,
			start: typeof now?.startTime === 'number' ? now.startTime : null,
			end: typeof now?.endTime === 'number' ? now.endTime : null
		};
	} catch (error) {
		if (isAbortError(error)) throw error;
		return null;
	}
}

