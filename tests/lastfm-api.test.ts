import {
	createLastFmApi,
	lastFmWriteResultFromErrorCode,
	signLastFmParams,
	toSessionKey,
} from '../src/lib/lastfm-api.server';
import type { LastFmScrobbleSubmission, LastFmWriteTrack } from '../src/lib/lastfm-scrobbler';

function assertEqual<T>(actual: T, expected: T, message: string) {
	if (actual !== expected) {
		throw new Error(`${message}: expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assertEqual(
	signLastFmParams({ api_key: 'xxx', method: 'auth.getToken', format: 'json' }, 'yyy'),
	'a17389f9e1b35409ac8559af0d9a9ced',
	'signature is md5 of sorted key+value plus secret, excluding format',
);

assertEqual(
	signLastFmParams(
		{ api_key: 'xxx', method: 'auth.getToken', callback: 'https://example.test', api_sig: 'nope' },
		'yyy',
	),
	'a17389f9e1b35409ac8559af0d9a9ced',
	'signature ignores callback and api_sig',
);

{
	const error9 = lastFmWriteResultFromErrorCode(9);
	assert(!error9.ok && error9.invalidSession && !error9.retryable, 'error 9 is invalidSession');
	const error11 = lastFmWriteResultFromErrorCode(11);
	assert(!error11.ok && error11.retryable && !error11.invalidSession, 'error 11 is retryable');
}

const sessionKey = toSessionKey('sk-test');
assert(sessionKey, 'test session key');

const track: LastFmWriteTrack = {
	title: 'Fightscene',
	artist: 'Dabrye',
	album: 'Two/Three',
	durationSeconds: 200,
};

const submission: LastFmScrobbleSubmission = {
	...track,
	listenedAt: 1_500,
};

{
	const api = createLastFmApi({
		credentials: { apiKey: 'xxx', sharedSecret: 'yyy' },
		fetch: async () =>
			new Response(JSON.stringify({ error: 9, message: 'Invalid session key' }), { status: 200 }),
	});
	const result = await api.scrobble(sessionKey, submission);
	assert(!result.ok && result.invalidSession && !result.retryable, 'scrobble maps error 9');
}

{
	const api = createLastFmApi({
		credentials: { apiKey: 'xxx', sharedSecret: 'yyy' },
		fetch: async () =>
			new Response(JSON.stringify({ error: 11, message: 'Service Offline' }), { status: 200 }),
	});
	const result = await api.updateNowPlaying(sessionKey, track);
	assert(!result.ok && result.retryable && !result.invalidSession, 'now-playing maps error 11');
}

{
	let body = '';
	const api = createLastFmApi({
		credentials: { apiKey: 'xxx', sharedSecret: 'yyy' },
		fetch: async (_input, init) => {
			body = String(init?.body ?? '');
			return new Response(JSON.stringify({ scrobbles: { '@attr': { accepted: 1 } } }), {
				status: 200,
			});
		},
	});
	const result = await api.scrobble(sessionKey, submission);
	assert(result.ok, 'successful scrobble is ok');
	const params = new URLSearchParams(body);
	assertEqual(params.get('chosenByUser'), '0', 'scrobble hard-codes chosenByUser=0');
	assertEqual(params.get('sk'), 'sk-test', 'scrobble session key comes from the branded argument');
	assert(params.get('api_sig'), 'scrobble is signed');
}
