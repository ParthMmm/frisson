export type CurrentTrack = {
	id: string;
	title: string;
	artist: string;
	album: string;
	year: number | null;
	artworkUrl: string | null;
	start: number;
	end: number;
};

export type AppleMusicLookupResponse = {
	url: string | null;
};
