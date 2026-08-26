import { error, json } from '@sveltejs/kit';
import { isAbortError } from '$lib/errors';
import { getStationById } from '$lib/station-catalog';
import { loadRadioFranceCurrentTrack, RadioFranceIntakeError } from '$lib/radio-france-intake';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ fetch, request, url, platform }) => {
	const stationId = url.searchParams.get('station')?.trim();
	if (!stationId) error(400, 'Missing station');

	const station = getStationById(stationId);
	if (!station) error(400, 'Unknown station');

	const token = platform?.env.RADIO_FRANCE_TOKEN;
	if (!token) error(500, 'Radio France API token is not configured');

	try {
		const currentTrack = await loadRadioFranceCurrentTrack({
			fetch,
			token,
			station,
			signal: request.signal,
		});
		return json(currentTrack);
	} catch (cause) {
		if (isAbortError(cause)) throw cause;
		if (cause instanceof RadioFranceIntakeError) error(502, cause.message);
		throw cause;
	}
};
