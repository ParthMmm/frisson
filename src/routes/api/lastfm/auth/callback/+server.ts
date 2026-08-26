import { error, redirect } from '@sveltejs/kit';
import { createLastFmApi, readLastFmCredentials } from '$lib/lastfm-api.server';
import {
	LASTFM_AUTH_TOKEN_COOKIE,
	LASTFM_SESSION_COOKIE,
	lastFmCookieDeleteOptions,
	lastFmCookieSecure,
	resolveLastFmPublicOrigin,
	serializeSessionCookieValue,
	sessionCookieSerializeOptions,
} from '$lib/lastfm-session.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ fetch, platform, cookies, url }) => {
	const credentials = readLastFmCredentials(platform?.env);
	if (!credentials) error(500, 'Last.fm API is not configured');

	const queryToken = url.searchParams.get('token')?.trim();
	if (!queryToken) error(400, 'Last.fm auth token missing');

	const api = createLastFmApi({ credentials, fetch });
	let session;
	try {
		session = await api.getSession(queryToken);
	} catch {
		error(502, 'Last.fm session request failed');
	}

	const publicOrigin = resolveLastFmPublicOrigin(url);
	const secure = lastFmCookieSecure(publicOrigin);
	cookies.set(
		LASTFM_SESSION_COOKIE,
		serializeSessionCookieValue({
			sessionKey: session.sessionKey,
			username: session.username,
		}),
		sessionCookieSerializeOptions(secure),
	);
	cookies.delete(LASTFM_AUTH_TOKEN_COOKIE, lastFmCookieDeleteOptions(secure));
	redirect(302, '/');
};
