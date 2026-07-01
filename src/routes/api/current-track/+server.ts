import { error, json } from '@sveltejs/kit';
import { isAbortError } from '$lib/errors';
import {
	buildCurrentTrack,
	selectCurrentLiveTrack,
	type GraphTrackMetadata,
	type LiveMetadataSnapshot,
	type LiveTrackMetadata,
} from '$lib/current-track';
import type { RequestHandler } from './$types';

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

type LiveMetadataRow = {
	cover?: unknown;
	songUuid?: unknown;
	firstLine?: unknown;
	secondLine?: unknown;
	startTime?: unknown;
	endTime?: unknown;
};

type LiveMetadataResponse = {
	now?: LiveMetadataRow | null;
	next?: (LiveMetadataRow | null)[] | null;
};

const RADIO_FRANCE_GRAPHQL_ENDPOINT = 'https://openapi.radiofrance.fr/v1/graphql';
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

const KNOWN_STATIONS: Record<string, { number: string; name: string }> = {
	FIP: { number: '7', name: 'FIP' },
	FIP_ROCK: { number: '64', name: 'FIP Rock' },
	FIP_JAZZ: { number: '65', name: 'FIP Jazz' },
	FIP_GROOVE: { number: '66', name: 'FIP Groove' },
	FIP_WORLD: { number: '69', name: 'FIP Monde' },
	FIP_NOUVEAUTES: { number: '70', name: 'FIP Nouveautés' },
	FIP_REGGAE: { number: '71', name: 'FIP Reggae' },
	FIP_ELECTRO: { number: '74', name: 'FIP Electro' },
	FIP_METAL: { number: '77', name: 'FIP Metal' },
	FIP_POP: { number: '78', name: 'FIP Pop' },
	FIP_HIP_HOP: { number: '95', name: 'FIP Hip-Hop' },
};

export const GET: RequestHandler = async ({ fetch, request, url, platform }) => {
	const station = url.searchParams.get('station')?.trim();
	const stationNumber = url.searchParams.get('number')?.trim();
	const stationName = url.searchParams.get('name')?.trim();

	if (!station || !stationNumber || !stationName) error(400, 'Missing station metadata');
	const token = platform?.env.RADIO_FRANCE_TOKEN;
	if (!token) error(500, 'Radio France API token is not configured');

	const knownStation = KNOWN_STATIONS[station];
	if (!knownStation || knownStation.number !== stationNumber || knownStation.name !== stationName) {
		error(400, 'Unknown station');
	}

	const liveSnapshotPromise = loadCurrentLiveMetadata(
		fetch,
		stationName,
		stationNumber,
		request.signal,
	);
	const [response, liveSnapshot] = await Promise.all([
		fetch(RADIO_FRANCE_GRAPHQL_ENDPOINT, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-token': token,
			},
			body: JSON.stringify({
				query: CURRENT_TRACK_QUERY,
				variables: { station },
			}),
			signal: request.signal,
		}),
		liveSnapshotPromise,
	]);

	if (!response.ok) error(502, `Radio France metadata returned HTTP ${response.status}`);

	const payload = (await response.json()) as RadioFranceCurrentTrackResponse;
	if (payload.errors?.length) error(502, payload.errors[0]?.message ?? 'Metadata unavailable');

	const live = payload.data?.live;
	if (!live) error(502, 'Metadata unavailable');

	const graphTrack = toGraphTrackMetadata(live.song);
	const liveTrack = selectCurrentLiveTrack(liveSnapshot, Date.now() / 1000);
	const currentTrack = buildCurrentTrack(station, graphTrack, liveTrack);

	return json(currentTrack);
};

async function loadCurrentLiveMetadata(
	fetch: typeof globalThis.fetch,
	stationName: string,
	stationNumber: string,
	signal: AbortSignal,
): Promise<LiveMetadataSnapshot | null> {
	try {
		const stationFormat = stationName === 'FIP' ? 'webrf_fip_player' : 'webrf_webradio_player';
		const response = await fetch(
			`${RADIO_FRANCE_LIVEMETA_ENDPOINT}/${stationNumber}/${stationFormat}`,
			{ signal },
		);

		if (!response.ok) return null;

		const metadata = (await response.json()) as LiveMetadataResponse;

		return {
			now: parseLiveMetadataRow(metadata.now),
			next: parseLiveMetadataRow(metadata.next?.[0]),
		};
	} catch (error) {
		if (isAbortError(error)) throw error;
		return null;
	}
}

function toGraphTrackMetadata(song: RadioFranceSong | null | undefined): GraphTrackMetadata | null {
	if (!song?.track) return null;

	return {
		id: song.id,
		title: String(song.track.title ?? '').trim(),
		artist: song.track.mainArtists?.join(', ') || 'Unknown artist',
		album: song.track.albumTitle,
		year: song.track.productionDate,
		start: song.start,
		end: song.end,
	};
}

function parseLiveMetadataRow(row: LiveMetadataRow | null | undefined): LiveTrackMetadata | null {
	if (row == null) return null;

	const {
		cover,
		songUuid: liveTrackId,
		firstLine: title,
		secondLine: artist,
		startTime,
		endTime,
	} = row;

	if (
		typeof cover !== 'string' ||
		typeof liveTrackId !== 'string' ||
		typeof title !== 'string' ||
		typeof artist !== 'string'
	) {
		return null;
	}

	const trimmedCover = cover.trim();
	const trimmedLiveTrackId = liveTrackId.trim();
	const trimmedTitle = title.trim();
	const trimmedArtist = artist.trim();
	if (!trimmedCover || !trimmedLiveTrackId || !trimmedTitle || !trimmedArtist) return null;

	return {
		id: trimmedLiveTrackId,
		title: trimmedTitle,
		artist: trimmedArtist,
		artworkUrl: `https://www.radiofrance.fr/pikapi/images/${trimmedCover}/200x200`,
		start: typeof startTime === 'number' ? startTime : null,
		end: typeof endTime === 'number' ? endTime : null,
	};
}
