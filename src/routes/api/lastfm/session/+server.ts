import { json } from '@sveltejs/kit';
import type { LastFmPublicSession } from '$lib/lastfm-scrobbler';
import {
	LASTFM_SESSION_COOKIE,
	lastFmCookieDeleteOptions,
	lastFmCookieSecure,
	readSessionCookie,
	resolveLastFmPublicOrigin,
} from '$lib/lastfm-session.server';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ cookies }) => {
	const session = readSessionCookie(cookies.get(LASTFM_SESSION_COOKIE));
	const body: LastFmPublicSession = session
		? { connected: true, username: session.username }
		: { connected: false, username: null };
	return json(body);
};

export const DELETE: RequestHandler = async ({ cookies, url }) => {
	cookies.delete(
		LASTFM_SESSION_COOKIE,
		lastFmCookieDeleteOptions(lastFmCookieSecure(resolveLastFmPublicOrigin(url))),
	);
	return new Response(null, { status: 204 });
};
