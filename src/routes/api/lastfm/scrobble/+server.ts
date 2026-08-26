import { json } from '@sveltejs/kit';
import {
	createLastFmApi,
	LASTFM_WRITE_INVALID_SESSION,
	LASTFM_WRITE_REJECTED,
	LASTFM_WRITE_RETRYABLE,
	lastFmWriteHttpStatus,
	parseLastFmScrobbleSubmission,
	readLastFmCredentials,
} from '$lib/lastfm-api.server';
import {
	LASTFM_SESSION_COOKIE,
	lastFmCookieDeleteOptions,
	lastFmCookieSecure,
	readSessionCookie,
} from '$lib/lastfm-session.server';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request, cookies, fetch, platform, url }) => {
	const credentials = readLastFmCredentials(platform?.env);
	if (!credentials) {
		return json(LASTFM_WRITE_RETRYABLE, { status: 500 });
	}

	const session = readSessionCookie(cookies.get(LASTFM_SESSION_COOKIE));
	if (!session) {
		return json(LASTFM_WRITE_INVALID_SESSION, { status: 401 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return json(LASTFM_WRITE_REJECTED, { status: 400 });
	}

	const submission = parseLastFmScrobbleSubmission(body);
	if (!submission) {
		return json(LASTFM_WRITE_REJECTED, { status: 400 });
	}

	const api = createLastFmApi({ credentials, fetch });
	const result = await api.scrobble(session.sessionKey, submission);
	if (!result.ok && result.invalidSession) {
		cookies.delete(LASTFM_SESSION_COOKIE, lastFmCookieDeleteOptions(lastFmCookieSecure(url)));
	}
	return json(result, { status: lastFmWriteHttpStatus(result) });
};
