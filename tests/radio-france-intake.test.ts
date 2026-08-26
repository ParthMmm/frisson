import {
	loadRadioFranceCurrentTrack,
	parseLiveMetadataRow,
	type RadioFranceFetch,
} from '../src/lib/radio-france-intake';
import { getStationById } from '../src/lib/station-catalog';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assert(condition: unknown, message: string) {
	if (!condition) throw new Error(message);
}

async function assertRejects(task: Promise<unknown>, message: string) {
	try {
		await task;
	} catch {
		return;
	}
	throw new Error(message);
}

const station = getStationById('FIP_HIP_HOP')!;
const nowMs = 2_000_000_000_000;
const nowSeconds = nowMs / 1000;

function makeFetcher(
	graphPayload: unknown,
	livePayload: unknown,
	graphStatus = 200,
	liveStatus = 200,
): RadioFranceFetch {
	return async (input) => {
		const url = String(input);
		if (url.includes('livemeta')) {
			return new Response(JSON.stringify(livePayload), { status: liveStatus });
		}
		return new Response(JSON.stringify(graphPayload), { status: graphStatus });
	};
}

const graphPayload = {
	data: {
		live: {
			song: {
				id: 'graph-song',
				start: nowSeconds - 60,
				end: nowSeconds + 240,
				track: {
					title: 'A Song',
					albumTitle: 'An Album',
					mainArtists: ['An Artist'],
					productionDate: 2024,
				},
			},
		},
	},
};
const livePayload = {
	now: {
		cover: 'cover-id',
		songUuid: 'live-song',
		firstLine: 'A Song',
		secondLine: 'An Artist',
		startTime: nowSeconds - 60,
		endTime: nowSeconds + 240,
	},
	next: [],
};

{
	const track = await loadRadioFranceCurrentTrack({
		fetch: makeFetcher(graphPayload, livePayload),
		token: 'token',
		station,
		nowMs,
	});
	assert(track !== null, 'valid provider payloads produce a track');
	assertEqual(track?.id, 'live-song', 'live identity remains preferred');
	assertEqual(
		track?.artworkUrl,
		'https://www.radiofrance.fr/pikapi/images/cover-id/200x200',
		'live artwork keeps provider URL shape',
	);
	assertEqual(track?.album, 'An Album', 'matching live metadata keeps GraphQL album');
	assertEqual(track?.year, 2024, 'matching live metadata keeps GraphQL year');
}

{
	const parsed = parseLiveMetadataRow({
		cover: 'cover',
		songUuid: 'song',
		firstLine: 'Title',
		secondLine: 'Artist',
	});
	assert(parsed !== null, 'complete live rows parse');
	assertEqual(
		parseLiveMetadataRow({ cover: 'cover', songUuid: 'song', firstLine: 'Title' }),
		null,
		'malformed live rows are ignored',
	);
}

{
	const track = await loadRadioFranceCurrentTrack({
		fetch: makeFetcher(graphPayload, { now: { cover: 'cover' } }),
		token: 'token',
		station,
		nowMs,
	});
	assertEqual(track?.id, 'graph-song', 'malformed live data falls back to GraphQL');
	assertEqual(track?.album, 'An Album', 'GraphQL fallback keeps album details');
}

{
	const track = await loadRadioFranceCurrentTrack({
		fetch: makeFetcher(graphPayload, null, 200, 503),
		token: 'token',
		station,
		nowMs,
	});
	assertEqual(track?.id, 'graph-song', 'live fetch failure falls back to GraphQL');
}

{
	await assertRejects(
		loadRadioFranceCurrentTrack({
			fetch: makeFetcher({ errors: [{ message: 'GraphQL failed' }] }, livePayload),
			token: 'token',
			station,
			nowMs,
		}),
		'GraphQL errors must fail intake',
	);
	await assertRejects(
		loadRadioFranceCurrentTrack({
			fetch: makeFetcher({ data: null }, livePayload),
			token: 'token',
			station,
			nowMs,
		}),
		'missing GraphQL live data must fail intake',
	);
	await assertRejects(
		loadRadioFranceCurrentTrack({
			fetch: makeFetcher(graphPayload, livePayload, 502),
			token: 'token',
			station,
			nowMs,
		}),
		'GraphQL HTTP failures must fail intake',
	);
}

{
	const abortFetcher: RadioFranceFetch = async (input) => {
		if (!String(input).includes('livemeta')) throw new DOMException('Aborted', 'AbortError');
		return new Response(JSON.stringify(livePayload));
	};
	await assertRejects(
		loadRadioFranceCurrentTrack({
			fetch: abortFetcher,
			token: 'token',
			station,
			nowMs,
		}),
		'aborted provider requests must propagate',
	);
}
