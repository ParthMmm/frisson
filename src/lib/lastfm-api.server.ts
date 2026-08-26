import type {
	LastFmScrobbleSubmission,
	LastFmWriteResult,
	LastFmWriteTrack,
} from './lastfm-scrobbler';

export const LASTFM_API_URL = 'https://ws.audioscrobbler.com/2.0/';
export const LASTFM_AUTH_URL = 'https://www.last.fm/api/auth/';

const MAX_TRACK_TEXT = 200;
const UNSIGNED_PARAM_KEYS = new Set(['format', 'callback', 'api_sig']);

export type SessionKey = string & { readonly __brand: 'SessionKey' };

export type LastFmCredentials = {
	apiKey: string;
	sharedSecret: string;
};

export interface LastFmApi {
	getSession(token: string): Promise<{ sessionKey: SessionKey; username: string }>;
	updateNowPlaying(sessionKey: SessionKey, track: LastFmWriteTrack): Promise<LastFmWriteResult>;
	scrobble(
		sessionKey: SessionKey,
		submission: LastFmScrobbleSubmission,
	): Promise<LastFmWriteResult>;
}

export const LASTFM_WRITE_OK: LastFmWriteResult = { ok: true };
export const LASTFM_WRITE_INVALID_SESSION: LastFmWriteResult = {
	ok: false,
	retryable: false,
	invalidSession: true,
};
export const LASTFM_WRITE_RETRYABLE: LastFmWriteResult = {
	ok: false,
	retryable: true,
	invalidSession: false,
};
export const LASTFM_WRITE_REJECTED: LastFmWriteResult = {
	ok: false,
	retryable: false,
	invalidSession: false,
};

export class LastFmApiRequestError extends Error {
	constructor(
		message: string,
		readonly code: number | null,
	) {
		super(message);
		this.name = 'LastFmApiRequestError';
	}
}

export function toSessionKey(value: string): SessionKey | null {
	const trimmed = value.trim();
	if (trimmed.length === 0) return null;
	return trimmed as SessionKey;
}

export function readLastFmCredentials(
	env: { LASTFM_API_KEY?: string; LASTFM_SHARED_SECRET?: string } | undefined,
): LastFmCredentials | null {
	const apiKey = env?.LASTFM_API_KEY?.trim();
	const sharedSecret = env?.LASTFM_SHARED_SECRET?.trim();
	if (!apiKey || !sharedSecret) return null;
	return { apiKey, sharedSecret };
}

export function signLastFmParams(params: Record<string, string>, sharedSecret: string): string {
	const base = Object.keys(params)
		.filter((key) => !UNSIGNED_PARAM_KEYS.has(key))
		.sort()
		.map((key) => `${key}${params[key]}`)
		.join('');
	return md5Hex(`${base}${sharedSecret}`);
}

export function lastFmWriteResultFromErrorCode(code: number): LastFmWriteResult {
	if (code === 9) return LASTFM_WRITE_INVALID_SESSION;
	if (code === 11 || code === 16) return LASTFM_WRITE_RETRYABLE;
	return LASTFM_WRITE_REJECTED;
}

export function lastFmWriteHttpStatus(result: LastFmWriteResult): number {
	if (result.ok) return 200;
	if (result.invalidSession) return 401;
	if (result.retryable) return 503;
	return 400;
}

export function parseLastFmWriteTrack(body: unknown): LastFmWriteTrack | null {
	if (!body || typeof body !== 'object') return null;
	const record = body as Record<string, unknown>;
	const title = parseRequiredText(record.title);
	const artist = parseRequiredText(record.artist);
	if (title === null || artist === null) return null;
	const album = parseAlbum(record.album);
	if (album === null) return null;
	const durationSeconds = parseDurationSeconds(record.durationSeconds);
	if (durationSeconds === undefined) return null;
	return { title, artist, album, durationSeconds };
}

export function parseLastFmScrobbleSubmission(body: unknown): LastFmScrobbleSubmission | null {
	const track = parseLastFmWriteTrack(body);
	if (!track || !body || typeof body !== 'object') return null;
	const listenedAt = (body as Record<string, unknown>).listenedAt;
	if (typeof listenedAt !== 'number' || !Number.isFinite(listenedAt)) return null;
	return { ...track, listenedAt: Math.floor(listenedAt) };
}

export function createLastFmApi(options: {
	credentials: LastFmCredentials;
	fetch: typeof fetch;
}): LastFmApi {
	const { apiKey, sharedSecret } = options.credentials;

	async function call(params: Record<string, string>): Promise<unknown> {
		const apiSig = signLastFmParams(params, sharedSecret);
		const body = new URLSearchParams({ ...params, api_sig: apiSig, format: 'json' });
		let response: Response;
		try {
			response = await options.fetch(LASTFM_API_URL, {
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body,
			});
		} catch {
			throw new LastFmApiRequestError('Last.fm request failed', null);
		}

		let payload: unknown;
		try {
			payload = await response.json();
		} catch {
			throw new LastFmApiRequestError('Last.fm returned invalid JSON', null);
		}

		const errorCode = readLastFmErrorCode(payload);
		if (errorCode !== null) {
			const message =
				payload && typeof payload === 'object' && 'message' in payload
					? String((payload as { message: unknown }).message)
					: `Last.fm error ${errorCode}`;
			throw new LastFmApiRequestError(message, errorCode);
		}

		if (!response.ok) {
			throw new LastFmApiRequestError(`Last.fm HTTP ${response.status}`, null);
		}

		return payload;
	}

	async function writeCall(params: Record<string, string>): Promise<LastFmWriteResult> {
		try {
			await call(params);
			return LASTFM_WRITE_OK;
		} catch (cause) {
			if (cause instanceof LastFmApiRequestError && cause.code !== null) {
				return lastFmWriteResultFromErrorCode(cause.code);
			}
			return LASTFM_WRITE_RETRYABLE;
		}
	}

	return {
		async getSession(token: string) {
			const payload = await call({
				method: 'auth.getSession',
				api_key: apiKey,
				token,
			});
			const session =
				payload && typeof payload === 'object' && 'session' in payload
					? (payload as { session: unknown }).session
					: null;
			if (!session || typeof session !== 'object') {
				throw new LastFmApiRequestError('Last.fm session was missing', null);
			}
			const record = session as Record<string, unknown>;
			const sessionKey = typeof record.key === 'string' ? toSessionKey(record.key) : null;
			const username = typeof record.name === 'string' ? record.name.trim() : '';
			if (!sessionKey || username.length === 0) {
				throw new LastFmApiRequestError('Last.fm session was invalid', null);
			}
			return { sessionKey, username };
		},

		updateNowPlaying(sessionKey, track) {
			return writeCall(trackWriteParams('track.updateNowPlaying', apiKey, sessionKey, track));
		},

		scrobble(sessionKey, submission) {
			return writeCall({
				...trackWriteParams('track.scrobble', apiKey, sessionKey, submission),
				timestamp: String(submission.listenedAt),
				chosenByUser: '0',
			});
		},
	};
}

function trackWriteParams(
	method: string,
	apiKey: string,
	sessionKey: SessionKey,
	track: LastFmWriteTrack,
): Record<string, string> {
	const params: Record<string, string> = {
		method,
		api_key: apiKey,
		sk: sessionKey,
		artist: track.artist,
		track: track.title,
	};
	if (track.album.length > 0) params.album = track.album;
	if (track.durationSeconds !== null) {
		params.duration = String(Math.max(0, Math.floor(track.durationSeconds)));
	}
	return params;
}

function parseRequiredText(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_TRACK_TEXT) return null;
	return trimmed;
}

function parseAlbum(value: unknown): string | null {
	if (value === undefined || value === null) return '';
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed.length > MAX_TRACK_TEXT) return null;
	return trimmed;
}

function parseDurationSeconds(value: unknown): number | null | undefined {
	if (value === undefined || value === null) return null;
	if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
	return value;
}

function readLastFmErrorCode(payload: unknown): number | null {
	if (!payload || typeof payload !== 'object' || !('error' in payload)) return null;
	const code = (payload as { error: unknown }).error;
	if (typeof code === 'number' && Number.isFinite(code)) return code;
	if (typeof code === 'string') {
		const parsed = Number(code);
		if (Number.isFinite(parsed)) return parsed;
	}
	return null;
}

const MD5_K = new Uint32Array([
	0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
	0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
	0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
	0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
	0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
	0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
	0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
	0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
]);

const MD5_S = [
	7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14,
	20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6,
	10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

function md5Hex(message: string): string {
	const source = new TextEncoder().encode(message);
	const bitLen = source.length * 8;
	const paddedLen = (((source.length + 8) >> 6) + 1) << 6;
	const padded = new Uint8Array(paddedLen);
	padded.set(source);
	padded[source.length] = 0x80;
	const view = new DataView(padded.buffer);
	view.setUint32(paddedLen - 8, bitLen >>> 0, true);
	view.setUint32(paddedLen - 4, Math.floor(bitLen / 0x1_0000_0000), true);

	let a0 = 0x67452301;
	let b0 = 0xefcdab89;
	let c0 = 0x98badcfe;
	let d0 = 0x10325476;

	for (let offset = 0; offset < paddedLen; offset += 64) {
		let a = a0;
		let b = b0;
		let c = c0;
		let d = d0;

		for (let i = 0; i < 64; i++) {
			let f: number;
			let g: number;
			if (i < 16) {
				f = (b & c) | (~b & d);
				g = i;
			} else if (i < 32) {
				f = (d & b) | (~d & c);
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) % 16;
			} else {
				f = c ^ (b | ~d);
				g = (7 * i) % 16;
			}

			const word = view.getUint32(offset + g * 4, true);
			const sum = (a + f + MD5_K[i]! + word) >>> 0;
			const rotated = (sum << MD5_S[i]!) | (sum >>> (32 - MD5_S[i]!));
			a = d;
			d = c;
			c = b;
			b = (b + rotated) >>> 0;
		}

		a0 = (a0 + a) >>> 0;
		b0 = (b0 + b) >>> 0;
		c0 = (c0 + c) >>> 0;
		d0 = (d0 + d) >>> 0;
	}

	return [a0, b0, c0, d0].map(wordToHex).join('');
}

function wordToHex(word: number): string {
	return [word, word >>> 8, word >>> 16, word >>> 24]
		.map((byte) => (byte & 0xff).toString(16).padStart(2, '0'))
		.join('');
}
