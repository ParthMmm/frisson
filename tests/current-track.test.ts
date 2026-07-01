import {
	buildCurrentTrack,
	selectCurrentLiveTrack,
	type LiveTrackMetadata,
} from '../src/lib/current-track';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assertPresent<T>(actual: T | null, message: string): T {
	if (actual === null) {
		throw new Error(`${message}: expected value, received null`);
	}
	return actual;
}

const endingLiveTrack: LiveTrackMetadata = {
	id: 'ending-live-song',
	title: 'Fightscene (feat. La Peace)',
	artist: 'Dabrye',
	artworkUrl: 'https://www.radiofrance.fr/pikapi/images/cover/200x200',
	start: 1_500,
	end: 1_790,
};
const nextLiveTrack: LiveTrackMetadata = {
	id: 'next-live-song',
	title: 'Reservoir drogue',
	artist: '113',
	artworkUrl: 'https://www.radiofrance.fr/pikapi/images/next-cover/200x200',
	start: 1_800,
	end: 2_000,
};

assertEqual(
	selectCurrentLiveTrack({ now: endingLiveTrack, next: nextLiveTrack }, 1_800),
	nextLiveTrack,
	'live metadata promotes next when playback reaches its start',
);
assertEqual(
	selectCurrentLiveTrack({ now: endingLiveTrack, next: nextLiveTrack }, 2_001),
	null,
	'expired live metadata next is ignored after its end',
);
assertEqual(
	selectCurrentLiveTrack({ now: endingLiveTrack, next: nextLiveTrack }, 1_795),
	null,
	'expired live metadata now is ignored before next is eligible',
);
assertEqual(
	selectCurrentLiveTrack({ now: endingLiveTrack, next: nextLiveTrack }, 1_789),
	endingLiveTrack,
	'non-expired live metadata now is kept before its end',
);

const crossfadeTrack = assertPresent(
	buildCurrentTrack(
		'FIP_HIP_HOP',
		{
			id: 'next-graph-song',
			title: 'Reservoir drogue',
			artist: '113',
			album: 'Graph Album',
			year: 2006,
			start: 1_800,
			end: 2_000,
		},
		endingLiveTrack,
	),
	'crossfade mismatch builds a current track',
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
assertEqual(crossfadeTrack.year, null, 'mismatched graph year is not shown for live metadata');

const liveOnlyTrack = assertPresent(
	buildCurrentTrack('FIP_HIP_HOP', null, nextLiveTrack),
	'live-only metadata builds a current track',
);

assertEqual(liveOnlyTrack.id, 'next-live-song', 'live-only metadata id is used');
assertEqual(liveOnlyTrack.title, 'Reservoir drogue', 'live-only metadata title is used');
assertEqual(liveOnlyTrack.album, 'Single', 'live-only metadata uses the default album');
assertEqual(liveOnlyTrack.year, null, 'live-only metadata has no year');
assertEqual(liveOnlyTrack.artworkUrl, nextLiveTrack.artworkUrl, 'live-only artwork is used');
assertEqual(liveOnlyTrack.start, 1_800, 'live-only start timing is used');
assertEqual(liveOnlyTrack.end, 2_000, 'live-only end timing is used');

assertEqual(
	buildCurrentTrack('FIP_HIP_HOP', null, null),
	null,
	'both-null metadata returns no current track',
);

const graphOnlyTrack = assertPresent(
	buildCurrentTrack(
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
	),
	'graph-only metadata builds a current track',
);

assertEqual(graphOnlyTrack.id, 'graph-song', 'graph metadata id is used without live metadata');
assertEqual(graphOnlyTrack.album, 'Album', 'graph details are kept without live metadata');
