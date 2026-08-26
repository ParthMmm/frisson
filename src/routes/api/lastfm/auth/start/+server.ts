import { error, redirect } from '@sveltejs/kit';
import { createLastFmApi, LASTFM_AUTH_URL, readLastFmCredentials } from '$lib/lastfm-api.server';
import {
	authTokenCookieSerializeOptions,
	LASTFM_AUTH_TOKEN_COOKIE,
	lastFmCookieSecure,
	resolveLastFmPublicOrigin,
} from '$lib/lastfm-session.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ fetch, platform, cookies, url }) => {
	const credentials = readLastFmCredentials(platform?.env);
	if (!credentials) error(500, 'Last.fm API is not configured');

	const api = createLastFmApi({ credentials, fetch });
	let token: string;
	try {
		token = await api.getToken();
	} catch {
		error(502, 'Last.fm auth token request failed');
	}

	const publicOrigin = resolveLastFmPublicOrigin(url);
	const secure = lastFmCookieSecure(publicOrigin);
	cookies.set(LASTFM_AUTH_TOKEN_COOKIE, token, authTokenCookieSerializeOptions(secure));

	const authUrl = new URL(LASTFM_AUTH_URL);
	authUrl.searchParams.set('api_key', credentials.apiKey);
	authUrl.searchParams.set('token', token);
	authUrl.searchParams.set('cb', `${publicOrigin.origin}/api/lastfm/auth/callback`);
	redirect(302, authUrl.toString());
};
