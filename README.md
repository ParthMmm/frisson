# Frisson

A sleek, fast web player for [FIP](https://www.fip.fr) and its family of thematic stations — Rock, Jazz, Groove, Monde, Nouveautés, Reggae, Electro, Metal, Pop, and Hip-Hop.

Built with real playback and real metadata: switching stations changes what's actually streaming, and the now-playing panel shows live artwork and track info pulled straight from Radio France.

## Features

- **11 FIP stations** in one tuner, switchable instantly
- **Live now-playing** — title, artist, and artwork, kept fresh via Radio France's metadata feed
- **Light & dark themes** with no flash on load
- **Favorites** for quick access to your go-to stations
- **Listening history** so you can find that track you liked five songs ago

## Stack

- [Svelte 5](https://svelte.dev) (runes) + [SvelteKit](https://kit.svelte.dev)
- [Tailwind CSS v4](https://tailwindcss.com), theme tokens in [`layout.css`](src/routes/layout.css)
- [Cloudflare adapter](https://developers.cloudflare.com/pages) for deployment

See [`DESIGN.md`](DESIGN.md) for the design system and UI conventions.

## Getting started

```sh
bun install
bun run dev
```

Open the app, then:

```sh
bun run dev -- --open
```

## Building

```sh
bun run build
bun run preview   # preview the production build locally
```

## Project structure

```
src/
├── routes/
│   ├── +page.svelte          # main player UI
│   ├── layout.css            # design tokens (color, radius)
│   └── api/
│       ├── current-track/    # live metadata endpoint
│       └── apple-music/      # artwork lookup
└── lib/
    ├── Tuner.svelte           # station dial
    ├── TrackSummary.svelte    # now-playing card
    └── api.ts                 # Radio France data fetching
```
