import { error, json } from '@sveltejs/kit';
import { normalizeTrackText } from '$lib/text';
import type { AppleMusicLookupResponse } from '$lib/api';
import type { RequestHandler } from './$types';

type AppleMusicSearchResult = {
	trackName?: string;
	artistName?: string;
	trackViewUrl?: string;
};

type AppleMusicSearchResponse = {
	results?: AppleMusicSearchResult[];
};

type CachedAppleMusicLookup = {
	url: string | null;
	expiresAt: number;
};

const LOOKUP_CACHE_TTL_MS = 10 * 60_000;
const LOOKUP_CACHE_LIMIT = 128;
const MAX_QUERY_LENGTH = 200;

const lookupCache = new Map<string, CachedAppleMusicLookup>();

export const GET: RequestHandler = async ({ fetch, url }) => {
	const title = url.searchParams.get('title')?.trim();
	const artist = url.searchParams.get('artist')?.trim();

	if (!title || !artist) error(400, 'Missing title or artist');
	if (title.length > MAX_QUERY_LENGTH || artist.length > MAX_QUERY_LENGTH) {
		error(400, 'Title or artist is too long');
	}


	const cacheKey = `${normalizeTrackText(title)}|${normalizeTrackText(artist)}`;
	const cached = readCachedLookup(cacheKey);
	if (cached) return json({ url: cached.url } satisfies AppleMusicLookupResponse);

	const searchUrl = new URL('https://itunes.apple.com/search');
	searchUrl.search = new URLSearchParams({
		term: `${title} ${artist}`,
		country: 'US',
		media: 'music',
		entity: 'song',
		limit: '5',
	}).toString();

	const response = await fetch(searchUrl);
	if (!response.ok) error(502, 'Apple Music search failed');

	const payload = (await response.json()) as AppleMusicSearchResponse;
	const results = payload.results ?? [];
	const normalizedTitle = normalizeTrackText(title);
	const normalizedArtist = normalizeTrackText(artist);
	const match =
		results.find(
			(result) =>
				normalizeTrackText(result.trackName) === normalizedTitle &&
				normalizeTrackText(result.artistName) === normalizedArtist &&
				result.trackViewUrl,
		) ?? results.find((result) => result.trackViewUrl);

	const resultUrl = match?.trackViewUrl ?? null;
	cacheLookup(cacheKey, resultUrl);

	return json({ url: resultUrl } satisfies AppleMusicLookupResponse);
};

function readCachedLookup(key: string) {
	const cached = lookupCache.get(key);
	if (!cached) return null;

	if (Date.now() >= cached.expiresAt) {
		lookupCache.delete(key);
		return null;
	}

	return cached;
}

function cacheLookup(key: string, url: string | null) {
	if (lookupCache.size >= LOOKUP_CACHE_LIMIT) {
		const oldestKey = lookupCache.keys().next().value;
		if (oldestKey) lookupCache.delete(oldestKey);
	}

	lookupCache.set(key, { url, expiresAt: Date.now() + LOOKUP_CACHE_TTL_MS });
}
