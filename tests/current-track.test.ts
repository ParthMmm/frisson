import { buildCurrentTrack } from '../src/lib/current-track';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

const crossfadeTrack = buildCurrentTrack(
	'FIP_HIP_HOP',
	{
		id: 'next-graph-song',
		title: 'Reservoir drogue',
		artist: '113',
		album: 'Single',
		year: null,
		start: 1_800,
		end: 2_000,
	},
	{
		id: 'ending-live-song',
		title: 'Fightscene (feat. La Peace)',
		artist: 'Dabrye',
		artworkUrl: 'https://www.radiofrance.fr/pikapi/images/cover/200x200',
		start: 1_500,
		end: 1_790,
	},
);

assertEqual(
	crossfadeTrack.id,
	'ending-live-song',
	'crossfade lag uses the live metadata id for the visible ending track',
);
assertEqual(
	crossfadeTrack.title,
	'Fightscene (feat. La Peace)',
	'crossfade lag keeps the visible live metadata title',
);
assertEqual(crossfadeTrack.start, 1_500, 'crossfade lag keeps the visible live metadata timing');
assertEqual(
	crossfadeTrack.album,
	'Single',
	'mismatched graph details are not shown for live metadata',
);

const graphOnlyTrack = buildCurrentTrack(
	'FIP_HIP_HOP',
	{
		id: 'graph-song',
		title: 'Reservoir drogue',
		artist: '113',
		album: 'Album',
		year: 2006,
		start: 1_800,
		end: 2_000,
	},
	null,
);

assertEqual(graphOnlyTrack.id, 'graph-song', 'graph metadata id is used without live metadata');
assertEqual(graphOnlyTrack.album, 'Album', 'graph details are kept without live metadata');
