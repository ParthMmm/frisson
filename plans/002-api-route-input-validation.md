# Plan 002: Validate station parameters on `/api/current-track` and cap query length on `/api/apple-music`

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 32cd2be..HEAD -- src/routes/api/current-track/+server.ts src/routes/api/apple-music/+server.ts src/routes/+page.svelte`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: plans/001-radio-france-token-env-var.md
- **Category**: security
- **Planned at**: commit `32cd2be`, 2026-06-30

## Why this matters

`/api/current-track` accepts `station`, `number`, and `name` as free-form
query params and uses `number` directly as a URL path segment when calling
Radio France's live-metadata API
(`` `${RADIO_FRANCE_LIVEMETA_ENDPOINT}/${stationNumber}/${stationFormat}` ``).
Nothing validates these against the 11 stations this app actually knows
about, so the route works as an open proxy: anyone can call it with
arbitrary values and make the server issue outbound requests to
`api.radiofrance.fr` with an attacker-chosen path suffix, using the app's own
API token (see Plan 001) to do it. `/api/apple-music` has the same
"unauthenticated proxy" shape with no length limit on `title`/`artist`,
though lower severity since it targets a public, tokenless API. Locking both
routes down to the shapes the UI actually sends removes the abuse surface and
protects the Radio France token's rate limit/quota from being drained by
traffic this app didn't generate.

This plan depends on Plan 001 landing first only to avoid both plans editing
the same lines of `current-track/+server.ts` at once — there's no functional
coupling.

## Current state

- `src/routes/+page.svelte` lines 63–163 define the only 11 valid station
  combinations this app ever sends. Each entry has `name`, `number`, and
  `apiStation` (this is the `station` GraphQL variable) — for example:

  ```ts
  { name: 'FIP', number: '7', tag: '105.1 MHZ', shortName: 'FIP', streamUrl: '...', apiStation: 'FIP', favorite: false },
  { name: 'FIP Rock', number: '64', ..., apiStation: 'FIP_ROCK', favorite: false },
  { name: 'FIP Jazz', number: '65', ..., apiStation: 'FIP_JAZZ', favorite: false },
  { name: 'FIP Groove', number: '66', ..., apiStation: 'FIP_GROOVE', favorite: true },
  { name: 'FIP Monde', number: '69', ..., apiStation: 'FIP_WORLD', favorite: false },
  { name: 'FIP Nouveautés', number: '70', ..., apiStation: 'FIP_NOUVEAUTES', favorite: true },
  { name: 'FIP Reggae', number: '71', ..., apiStation: 'FIP_REGGAE', favorite: false },
  { name: 'FIP Electro', number: '74', ..., apiStation: 'FIP_ELECTRO', favorite: false },
  { name: 'FIP Metal', number: '77', ..., apiStation: 'FIP_METAL', favorite: false },
  { name: 'FIP Pop', number: '78', ..., apiStation: 'FIP_POP', favorite: false },
  { name: 'FIP Hip-Hop', number: '95', ..., apiStation: 'FIP_HIP_HOP', favorite: false }
  ```

  The full `(apiStation, number, name)` triples the server must accept are:

  | apiStation       | number | name             |
  | ---------------- | ------ | ---------------- |
  | `FIP`            | `7`    | `FIP`            |
  | `FIP_ROCK`       | `64`   | `FIP Rock`       |
  | `FIP_JAZZ`       | `65`   | `FIP Jazz`       |
  | `FIP_GROOVE`     | `66`   | `FIP Groove`     |
  | `FIP_WORLD`      | `69`   | `FIP Monde`      |
  | `FIP_NOUVEAUTES` | `70`   | `FIP Nouveautés` |
  | `FIP_REGGAE`     | `71`   | `FIP Reggae`     |
  | `FIP_ELECTRO`    | `74`   | `FIP Electro`    |
  | `FIP_METAL`      | `77`   | `FIP Metal`      |
  | `FIP_POP`        | `78`   | `FIP Pop`        |
  | `FIP_HIP_HOP`    | `95`   | `FIP Hip-Hop`    |

  Cross-check this table against the live `stations` array in
  `+page.svelte` before using it — if it has drifted (a station added,
  removed, or renumbered), update the table to match reality first.

- `src/routes/api/current-track/+server.ts`, current param handling (line
  71–76, or line ~76–83 if Plan 001 already landed and shifted lines):

  ```ts
  export const GET: RequestHandler = async ({ fetch, request, url }) => {
      const station = url.searchParams.get('station')?.trim();
      const stationNumber = url.searchParams.get('number')?.trim();
      const stationName = url.searchParams.get('name')?.trim();

      if (!station || !stationNumber || !stationName) error(400, 'Missing station metadata');
  ```

  and the path built from `stationNumber` inside `loadCurrentLiveMetadata`
  (line ~127–131):

  ```ts
  const stationFormat = stationName === 'FIP' ? 'webrf_fip_player' : 'webrf_webradio_player';
  const response = await fetch(
  	`${RADIO_FRANCE_LIVEMETA_ENDPOINT}/${stationNumber}/${stationFormat}`,
  	{ signal },
  );
  ```

- `src/routes/api/apple-music/+server.ts`, current param handling (line
  25–29):

  ```ts
  export const GET: RequestHandler = async ({ fetch, url }) => {
      const title = url.searchParams.get('title')?.trim();
      const artist = url.searchParams.get('artist')?.trim();

      if (!title || !artist) error(400, 'Missing title or artist');
  ```

## Commands you will need

| Purpose   | Command         | Expected on success   |
| --------- | --------------- | --------------------- |
| Typecheck | `bun run check` | `0 ERRORS 0 WARNINGS` |

No test suite exists in this repo — don't invent one for this plan.

## Scope

**In scope**:

- `src/routes/api/current-track/+server.ts`
- `src/routes/api/apple-music/+server.ts`

**Out of scope**:

- `src/routes/+page.svelte` — read-only reference for the station table above;
  do not modify it, and do not refactor it to share the station list with the
  server (that's a reasonable future dedup, but a bigger change than this
  fix — flag it in your report as a follow-up if you want, don't do it here).
- Rate limiting / IP throttling — that's an infra-level concern (Cloudflare
  rate limiting rules, not app code) and out of scope for this plan.

## Git workflow

- Branch: `advisor/002-api-route-input-validation` (branch from the result of
  Plan 001 if it's already landed; otherwise from `main`).
- One commit; message style e.g. `Validate station params on API routes`.
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Add a station allowlist to `current-track/+server.ts`

Near the top of the file, after the existing type definitions and before the
`GET` handler, add:

```ts
const KNOWN_STATIONS: Record<string, { number: string; name: string }> = {
	FIP: { number: '7', name: 'FIP' },
	FIP_ROCK: { number: '64', name: 'FIP Rock' },
	FIP_JAZZ: { number: '65', name: 'FIP Jazz' },
	FIP_GROOVE: { number: '66', name: 'FIP Groove' },
	FIP_WORLD: { number: '69', name: 'FIP Monde' },
	FIP_NOUVEAUTES: { number: '70', name: 'FIP Nouveautés' },
	FIP_REGGAE: { number: '71', name: 'FIP Reggae' },
	FIP_ELECTRO: { number: '74', name: 'FIP Electro' },
	FIP_METAL: { number: '77', name: 'FIP Metal' },
	FIP_POP: { number: '78', name: 'FIP Pop' },
	FIP_HIP_HOP: { number: '95', name: 'FIP Hip-Hop' },
};
```

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS`.

### Step 2: Reject requests that don't match the allowlist

Change the top of the `GET` handler from:

```ts
if (!station || !stationNumber || !stationName) error(400, 'Missing station metadata');
```

to:

```ts
if (!station || !stationNumber || !stationName) error(400, 'Missing station metadata');

const known = KNOWN_STATIONS[station];
if (!known || known.number !== stationNumber || known.name !== stationName) {
	error(400, 'Unknown station');
}
```

Leave everything below this (the GraphQL fetch, `loadCurrentLiveMetadata`
call, response shaping) untouched — `station`, `stationNumber`, and
`stationName` are now guaranteed to be one of the 11 known combinations by
the time they're used.

**Verify**:

```
bun run check
```

→ `0 ERRORS 0 WARNINGS`.

Then, with `bun run dev` running, confirm both the happy path and the
rejection:

```
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5173/api/current-track?station=FIP&number=7&name=FIP"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5173/api/current-track?station=NOT_REAL&number=1&name=Nope"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5173/api/current-track?station=FIP&number=999&name=FIP"
```

Expected: first prints `200`, second and third print `400`.

### Step 3: Cap query length on `apple-music/+server.ts`

Change:

```ts
export const GET: RequestHandler = async ({ fetch, url }) => {
    const title = url.searchParams.get('title')?.trim();
    const artist = url.searchParams.get('artist')?.trim();

    if (!title || !artist) error(400, 'Missing title or artist');
```

to:

```ts
const MAX_QUERY_LENGTH = 200;

export const GET: RequestHandler = async ({ fetch, url }) => {
    const title = url.searchParams.get('title')?.trim();
    const artist = url.searchParams.get('artist')?.trim();

    if (!title || !artist) error(400, 'Missing title or artist');
    if (title.length > MAX_QUERY_LENGTH || artist.length > MAX_QUERY_LENGTH) {
        error(400, 'Title or artist is too long');
    }
```

Place the `MAX_QUERY_LENGTH` constant above the `GET` export, next to the
other top-level constants in the file (`LOOKUP_CACHE_TTL_MS`,
`LOOKUP_CACHE_LIMIT`).

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS`. Then:

```
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5173/api/apple-music?title=Bonnie%20and%20Clyde&artist=Serge%20Gainsbourg"
curl -s -o /dev/null -w "%{http_code}\n" "http://localhost:5173/api/apple-music?title=$(python3 -c 'print("a"*300)')&artist=x"
```

Expected: first prints `200`, second prints `400`.

## Test plan

No automated tests exist for these routes. The `curl` checks in Steps 2 and 3
are this plan's verification. If a test harness is added later (see the
rejected/deferred "no test coverage" finding), it should include cases for:
known station accepted, unknown `station` rejected, mismatched
`number`/`name` for a known `station` rejected, and over-length
`title`/`artist` rejected on `/api/apple-music`.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run check` exits with `0 ERRORS 0 WARNINGS`
- [ ] `grep -n "KNOWN_STATIONS" src/routes/api/current-track/+server.ts` shows the constant and its usage (at least 2 matches)
- [ ] `grep -n "MAX_QUERY_LENGTH" src/routes/api/apple-music/+server.ts` shows the constant and its usage (at least 2 matches)
- [ ] Manual curl checks in Steps 2 and 3 return the expected status codes
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 002 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The station table in `+page.svelte` doesn't match the table in this plan
  (a station was added/removed/renumbered since this plan was written) — fix
  the table to match live `+page.svelte` before writing `KNOWN_STATIONS`, and
  note the discrepancy in your report.
- The code at either `+server.ts` file doesn't match the "Current state"
  excerpts (drifted since this plan was written).
- You can't reach the local dev server to run the `curl` verifications
  (network/sandbox restriction) — report this as an environment limitation.

## Maintenance notes

- If a new FIP station is added in `+page.svelte`, `KNOWN_STATIONS` in
  `current-track/+server.ts` must be updated in the same change, or the new
  station's now-playing metadata will silently 400. This duplication is a
  known, deliberate tradeoff (kept the diff small); a future refactor could
  extract a shared `src/lib/stations.ts` module imported by both the page and
  the server route so there's one source of truth — worth doing if the
  station list starts changing often.
- `MAX_QUERY_LENGTH = 200` is a generous, arbitrary ceiling meant only to stop
  abuse, not to reflect any real title/artist length limit — don't read
  meaning into the exact number.
