import { isAbortError } from './errors';
import {
	buildCurrentTrack,
	selectCurrentLiveTrack,
	type GraphTrackMetadata,
	type LiveMetadataSnapshot,
	type LiveTrackMetadata,
} from './current-track';
import type { CurrentTrack } from './api';
import type { StationCatalogEntry } from './station-catalog';

export const RADIO_FRANCE_GRAPHQL_ENDPOINT = 'https://openapi.radiofrance.fr/v1/graphql';
export const RADIO_FRANCE_LIVEMETA_ENDPOINT = 'https://api.radiofrance.fr/livemeta/live';

export const CURRENT_TRACK_QUERY = `
\tquery CurrentTrack($station: StationsEnum!) {
\t\tlive(station: $station) {
\t\t\tsong {
\t\t\t\tid
\t\t\t\tstart
\t\t\t\tend
\t\t\t\ttrack {
\t\t\t\t\ttitle
\t\t\t\t\talbumTitle
\t\t\t\t\tmainArtists
\t\t\t\t\tproductionDate
\t\t\t\t}
\t\t\t}
\t\t}
\t}
`;

export type RadioFranceTrack = {
	title?: string;
	albumTitle?: string | null;
	mainArtists?: string[] | null;
	productionDate?: number | null;
};

export type RadioFranceSong = {
	id?: string;
	start?: number;
	end?: number;
	track?: RadioFranceTrack | null;
};

export type RadioFranceCurrentTrackResponse = {
	data?: {
		live?: {
			song?: RadioFranceSong | null;
		} | null;
	} | null;
	errors?: { message?: string }[];
};

export type LiveMetadataRow = {
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

export type RadioFranceFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export type RadioFranceStationIdentity = Pick<StationCatalogEntry, 'id' | 'name' | 'number'>;

export interface RadioFranceIntakeOptions {
	fetch: RadioFranceFetch;
	token: string;
	station: RadioFranceStationIdentity;
	signal?: AbortSignal;
	nowMs?: number;
}

/** Provider failures stay distinct from route errors until the HTTP adapter maps them. */
export class RadioFranceIntakeError extends Error {
	readonly name = 'RadioFranceIntakeError';

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
	}
}

export async function loadRadioFranceCurrentTrack({
	fetch: fetcher,
	token,
	station,
	signal,
	nowMs,
}: RadioFranceIntakeOptions): Promise<CurrentTrack | null> {
	try {
		const [graphResult, liveResult] = await Promise.allSettled([
			fetchGraphCurrentTrack(fetcher, token, station.id, signal),
			loadCurrentLiveMetadata(fetcher, station, signal),
		]);
		if (liveResult.status === 'rejected') throw liveResult.reason;
		if (graphResult.status === 'rejected') throw graphResult.reason;

		const graphResponse = graphResult.value;
		const liveSnapshot = liveResult.value;

		if (!graphResponse.ok) {
			throw new RadioFranceIntakeError(
				`Radio France metadata returned HTTP ${graphResponse.status}`,
			);
		}

		const payload = await readGraphPayload(graphResponse);
		if (payload.errors !== undefined && !Array.isArray(payload.errors)) {
			throw new RadioFranceIntakeError('Radio France metadata returned invalid errors');
		}
		if (payload.errors?.length) {
			throw new RadioFranceIntakeError(payload.errors[0]?.message ?? 'Metadata unavailable');
		}

		const live = payload.data?.live;
		if (!live) throw new RadioFranceIntakeError('Metadata unavailable');

		const graphTrack = toGraphTrackMetadata(live.song);
		const liveTrack = selectCurrentLiveTrack(liveSnapshot, (nowMs ?? Date.now()) / 1000);
		return buildCurrentTrack(station.id, graphTrack, liveTrack);
	} catch (cause) {
		if (isAbortError(cause) || cause instanceof RadioFranceIntakeError) throw cause;
		throw new RadioFranceIntakeError('Radio France metadata unavailable', { cause });
	}
}

/** Compatibility names for callers that describe this seam as a fetch. */
export const fetchCurrentTrack = loadRadioFranceCurrentTrack;
export const getCurrentTrack = loadRadioFranceCurrentTrack;

async function fetchGraphCurrentTrack(
	fetcher: RadioFranceFetch,
	token: string,
	station: string,
	signal: AbortSignal | undefined,
): Promise<Response> {
	try {
		return await fetcher(RADIO_FRANCE_GRAPHQL_ENDPOINT, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'x-token': token,
			},
			body: JSON.stringify({
				query: CURRENT_TRACK_QUERY,
				variables: { station },
			}),
			signal,
		});
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		throw new RadioFranceIntakeError('Radio France metadata unavailable', { cause });
	}
}

async function readGraphPayload(response: Response): Promise<RadioFranceCurrentTrackResponse> {
	try {
		const payload: unknown = await response.json();
		if (!payload || typeof payload !== 'object') {
			throw new RadioFranceIntakeError('Radio France metadata returned an invalid payload');
		}
		return payload as RadioFranceCurrentTrackResponse;
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		if (cause instanceof RadioFranceIntakeError) throw cause;
		throw new RadioFranceIntakeError('Radio France metadata returned invalid JSON', { cause });
	}
}

export async function loadCurrentLiveMetadata(
	fetcher: RadioFranceFetch,
	station: Pick<RadioFranceStationIdentity, 'name' | 'number'>,
	signal?: AbortSignal,
): Promise<LiveMetadataSnapshot | null> {
	try {
		const stationFormat = station.name === 'FIP' ? 'webrf_fip_player' : 'webrf_webradio_player';
		const response = await fetcher(
			`${RADIO_FRANCE_LIVEMETA_ENDPOINT}/${station.number}/${stationFormat}`,
			{ signal },
		);

		if (!response.ok) return null;

		const metadata = (await response.json()) as LiveMetadataResponse;
		return {
			now: parseLiveMetadataRow(metadata.now),
			next: parseLiveMetadataRow(metadata.next?.[0]),
		};
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		return null;
	}
}

export function toGraphTrackMetadata(
	song: RadioFranceSong | null | undefined,
): GraphTrackMetadata | null {
	if (!song?.track) return null;

	const artists = Array.isArray(song.track.mainArtists)
		? song.track.mainArtists.filter((artist): artist is string => typeof artist === 'string')
		: [];

	return {
		id: song.id,
		title: String(song.track.title ?? '').trim(),
		artist: artists.join(', ') || 'Unknown artist',
		album: song.track.albumTitle,
		year: song.track.productionDate,
		start: song.start,
		end: song.end,
	};
}

export function parseLiveMetadataRow(
	row: LiveMetadataRow | null | undefined,
): LiveTrackMetadata | null {
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
