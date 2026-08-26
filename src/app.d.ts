// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		interface Platform {
			env: {
				RADIO_FRANCE_TOKEN: string;
				LASTFM_API_KEY: string;
				LASTFM_SHARED_SECRET: string;
			};
		}
	}
}

export {};
