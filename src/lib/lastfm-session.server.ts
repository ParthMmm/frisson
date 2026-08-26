import { env } from '$env/dynamic/private';
import { toSessionKey, type SessionKey } from './lastfm-api.server';

export const LASTFM_SESSION_COOKIE = 'frisson-lastfm-session';
export const LASTFM_COOKIE_PATH = '/api/lastfm' as const;

export const LASTFM_SESSION_MAX_AGE = 60 * 60 * 24 * 365;

export type LastFmSessionCookie = {
	sessionKey: SessionKey;
	username: string;
};

export type LastFmCookieSerializeOptions = {
	path: typeof LASTFM_COOKIE_PATH;
	httpOnly: true;
	secure: boolean;
	sameSite: 'lax';
	maxAge: number;
};

export function lastFmCookieSecure(url: URL): boolean {
	return url.protocol === 'https:';
}

/**
 * Prefer PORTLESS_URL when the Vite app sits behind the Portless HTTPS proxy.
 * Without it, OAuth callbacks and Secure cookies see the loopback origin.
 */
export function resolveLastFmPublicOrigin(requestUrl: URL): URL {
	const fromEnv = env.PORTLESS_URL?.trim();
	if (fromEnv) {
		try {
			return new URL(fromEnv);
		} catch {
			// Fall through to the request URL.
		}
	}
	return requestUrl;
}

export function readSessionCookie(value: string | undefined): LastFmSessionCookie | null {
	if (!value) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== 'object') return null;
	const record = parsed as Record<string, unknown>;
	if (typeof record.sessionKey !== 'string' || typeof record.username !== 'string') return null;
	const sessionKey = toSessionKey(record.sessionKey);
	const username = record.username.trim();
	if (!sessionKey || username.length === 0) return null;
	return { sessionKey, username };
}

export function serializeSessionCookieValue(session: LastFmSessionCookie): string {
	return JSON.stringify({
		sessionKey: session.sessionKey,
		username: session.username,
	});
}

export function sessionCookieSerializeOptions(secure: boolean): LastFmCookieSerializeOptions {
	return {
		...lastFmCookieBase(secure),
		maxAge: LASTFM_SESSION_MAX_AGE,
	};
}

export function lastFmCookieDeleteOptions(secure: boolean) {
	return lastFmCookieBase(secure);
}

function lastFmCookieBase(secure: boolean): {
	path: typeof LASTFM_COOKIE_PATH;
	httpOnly: true;
	secure: boolean;
	sameSite: 'lax';
} {
	return {
		path: LASTFM_COOKIE_PATH,
		httpOnly: true,
		secure,
		sameSite: 'lax',
	};
}
