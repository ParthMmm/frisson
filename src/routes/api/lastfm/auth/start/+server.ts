import { error, redirect } from '@sveltejs/kit';
import { LASTFM_AUTH_URL, readLastFmCredentials } from '$lib/lastfm-api.server';
import { resolveLastFmPublicOrigin } from '$lib/lastfm-session.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, url }) => {
	const credentials = readLastFmCredentials(platform?.env);
	if (!credentials) error(500, 'Last.fm API is not configured');

	const publicOrigin = resolveLastFmPublicOrigin(url);
	const authUrl = new URL(LASTFM_AUTH_URL);
	authUrl.searchParams.set('api_key', credentials.apiKey);
	authUrl.searchParams.set('cb', `${publicOrigin.origin}/api/lastfm/auth/callback`);
	redirect(302, authUrl.toString());
};
