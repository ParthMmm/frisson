# Plan 003: Persist favorite stations across reloads

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 32cd2be..HEAD -- src/routes/+page.svelte`
> If this file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (recommended to run before Plan 006, which touches the
  same file, to reduce merge friction — not a hard technical dependency)
- **Category**: bug
- **Planned at**: commit `32cd2be`, 2026-06-30

## Why this matters

The README advertises "**Favorites** for quick access to your go-to
stations," and `toggleFavorite` lets a user star a station from either the
now-playing panel or the station list. But the `favorite` flag lives only in
the in-memory `stations` `$state` array — nothing writes it to `localStorage`.
Reload the page (or reopen the tab tomorrow) and every favorite silently
resets to the hardcoded defaults in the source (`FIP Groove` and `FIP
Nouveautés` start favorited; everything the user actually picked is gone).
Compare this to `theme` and `listeningHistory`, both of which are read from
`localStorage` on mount and written back on every change — favorites are the
one piece of user-facing state that doesn't follow that pattern. This plan
makes it follow it.

This plan is intentionally scoped to **persistence only** — it does not add
favorites-first sorting or a dedicated "favorites" filter/view. That's a
separate, larger UI decision (see the advisor's "direction" suggestions) and
is out of scope here.

## Current state

`src/routes/+page.svelte`:

- The station list with hardcoded `favorite` defaults (lines 63–163),
  abbreviated:

  ```ts
  let stations = $state<Station[]>([
      { name: 'FIP', ..., favorite: false },
      { name: 'FIP Rock', ..., favorite: false },
      { name: 'FIP Jazz', ..., favorite: false },
      { name: 'FIP Groove', ..., favorite: true },
      { name: 'FIP Monde', ..., favorite: false },
      { name: 'FIP Nouveautés', ..., favorite: true },
      { name: 'FIP Reggae', ..., favorite: false },
      { name: 'FIP Electro', ..., favorite: false },
      { name: 'FIP Metal', ..., favorite: false },
      { name: 'FIP Pop', ..., favorite: false },
      { name: 'FIP Hip-Hop', ..., favorite: false }
  ]);
  ```

- The existing persistence pattern to match, for listening history (lines
  46–53 for the storage keys, 226–277 for read/write):

  ```ts
  const LISTENING_HISTORY_STORAGE_KEY = 'frisson-listening-history-v1';
  const LEGACY_LISTENING_HISTORY_STORAGE_KEY = 'fip-listening-history-v1';
  const THEME_STORAGE_KEY = 'frisson-theme';
  const LEGACY_THEME_STORAGE_KEY = 'fip-theme';
  ```

  ```ts
  onMount(() => {
      // app.html already set this pre-paint; just mirror it into state.
      theme = (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light';
      listeningHistory.set(readPersistedListeningHistory());
      const unsubscribeListeningHistory = listeningHistory.subscribe(persistListeningHistory);
      void loadCurrentTrack(selectedStation);
      ...
  ```

  ```ts
  function readPersistedListeningHistory() {
  	try {
  		const stored =
  			localStorage.getItem(LISTENING_HISTORY_STORAGE_KEY) ??
  			localStorage.getItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
  		if (!stored) return [];

  		const parsed: unknown = JSON.parse(stored);
  		if (!Array.isArray(parsed)) return [];

  		return parsed
  			.filter(isListeningHistoryItem)
  			.map((item) => ({ ...item, isAppleMusicLookupLoading: false }))
  			.slice(0, LISTENING_HISTORY_LIMIT);
  	} catch {
  		return [];
  	}
  }

  function persistListeningHistory(items: ListeningHistoryItem[]) {
  	try {
  		if (items.length === 0) {
  			localStorage.removeItem(LISTENING_HISTORY_STORAGE_KEY);
  			localStorage.removeItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
  			return;
  		}

  		localStorage.setItem(LISTENING_HISTORY_STORAGE_KEY, JSON.stringify(items));
  		localStorage.removeItem(LEGACY_LISTENING_HISTORY_STORAGE_KEY);
  	} catch {
  		/* private browsing, storage quota, etc. */
  	}
  }
  ```

- The function being fixed (lines 658–661):

  ```ts
  function toggleFavorite(name: string) {
  	const station = stations.find((s) => s.name === name);
  	if (station) station.favorite = !station.favorite;
  }
  ```

There is no legacy `fip-`-prefixed key to migrate for favorites — this is new
persistence, not a rename of existing storage (unlike theme/history, which
carry a `LEGACY_*` fallback from the app's pre-rename `fip-theme`/`fip-*`
keys). Do not add a legacy key for this one.

## Commands you will need

| Purpose   | Command         | Expected on success   |
| --------- | --------------- | --------------------- |
| Typecheck | `bun run check` | `0 ERRORS 0 WARNINGS` |

No test suite exists in this repo — don't invent one for this plan.

## Scope

**In scope**:

- `src/routes/+page.svelte` only.

**Out of scope**:

- Any change to `Tuner.svelte` or `TrackSummary.svelte`.
- Favorites-first sorting, a dedicated favorites filter/view, or any change
  to how the station list is ordered or displayed. This plan only makes the
  existing star toggle survive a reload — it does not change what favoriting
  a station _does_ beyond that.
- Adding a legacy-key migration — there is nothing to migrate from.

## Git workflow

- Branch: `advisor/003-favorite-stations-persistence`
- One commit; message style e.g. `Persist favorite stations across reloads`.
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Add a storage key constant

Next to the existing storage key constants (around line 50–53), add:

```ts
const FAVORITE_STATIONS_STORAGE_KEY = 'frisson-favorite-stations-v1';
```

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS`.

### Step 2: Add read/persist helpers, following the listening-history pattern

Add these two functions near `readPersistedListeningHistory` /
`persistListeningHistory` (same section of the file):

```ts
function applyPersistedFavoriteStations() {
	try {
		const stored = localStorage.getItem(FAVORITE_STATIONS_STORAGE_KEY);
		if (!stored) return;

		const parsed: unknown = JSON.parse(stored);
		if (!Array.isArray(parsed)) return;

		const favoriteNames = new Set(
			parsed.filter((name): name is string => typeof name === 'string'),
		);
		for (const station of stations) {
			station.favorite = favoriteNames.has(station.name);
		}
	} catch {
		/* private browsing, malformed data, etc. */
	}
}

function persistFavoriteStations() {
	try {
		const favoriteNames = stations
			.filter((station) => station.favorite)
			.map((station) => station.name);

		if (favoriteNames.length === 0) {
			localStorage.removeItem(FAVORITE_STATIONS_STORAGE_KEY);
			return;
		}

		localStorage.setItem(FAVORITE_STATIONS_STORAGE_KEY, JSON.stringify(favoriteNames));
	} catch {
		/* private browsing, storage quota, etc. */
	}
}
```

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS`.

### Step 3: Apply persisted favorites on mount

In `onMount`, add a call to `applyPersistedFavoriteStations()` before
`listeningHistory.set(...)` (favorites should be in place before the first
render settles, same timing rationale as the theme mirror above it):

```ts
onMount(() => {
    // app.html already set this pre-paint; just mirror it into state.
    theme = (document.documentElement.dataset.theme as 'light' | 'dark') ?? 'light';
    applyPersistedFavoriteStations();
    listeningHistory.set(readPersistedListeningHistory());
    ...
```

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS`.

### Step 4: Persist on every toggle

Change `toggleFavorite` from:

```ts
function toggleFavorite(name: string) {
	const station = stations.find((s) => s.name === name);
	if (station) station.favorite = !station.favorite;
}
```

to:

```ts
function toggleFavorite(name: string) {
	const station = stations.find((s) => s.name === name);
	if (!station) return;

	station.favorite = !station.favorite;
	persistFavoriteStations();
}
```

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS`.

### Step 5: Manual smoke test

Run `bun run dev`, open the app in a browser, star a station that isn't
favorited by default (e.g. "FIP Rock"), then reload the page.

**Verify**: "FIP Rock" is still shown as favorited after reload. Open
DevTools → Application → Local Storage and confirm a
`frisson-favorite-stations-v1` key exists with a JSON array containing
`"FIP Rock"` (and the two defaults, if you didn't unfavorite them).

Then unfavorite every station and reload again.

**Verify**: no station is favorited after reload, and the
`frisson-favorite-stations-v1` key is removed from Local Storage (per the
`removeItem` branch in `persistFavoriteStations`).

## Test plan

No automated tests exist in this repo. Steps 3 and 5 above are this plan's
verification. If a future plan introduces component/unit tests, good
candidates here would be: `applyPersistedFavoriteStations` restoring a saved
set, ignoring malformed/non-array JSON, and `persistFavoriteStations` writing
the expected array and clearing the key when nothing is favorited.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run check` exits with `0 ERRORS 0 WARNINGS`
- [ ] `grep -n "FAVORITE_STATIONS_STORAGE_KEY" src/routes/+page.svelte` shows at least 3 matches (constant, read, write)
- [ ] `grep -n "persistFavoriteStations()" src/routes/+page.svelte` shows it called from `toggleFavorite`
- [ ] Manual smoke test in Step 5 passes (favorite state survives reload; clearing all favorites removes the storage key)
- [ ] No files outside `src/routes/+page.svelte` are modified (`git status`)
- [ ] `plans/README.md` status row for 003 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code in `+page.svelte` doesn't match the "Current state" excerpts
  (drifted since this plan was written) — in particular, if `toggleFavorite`
  or the storage-key constants section has moved or changed shape.
- You find favorites already being read from/written to `localStorage`
  somewhere this plan didn't account for — that would mean the finding was
  wrong; report it instead of layering a second persistence path on top.

## Maintenance notes

- If favorites-first sorting or a dedicated favorites view is added later
  (see the advisor's "direction" suggestions), it will read the same
  `station.favorite` flag this plan now persists — no storage format change
  needed for that follow-up.
- `FAVORITE_STATIONS_STORAGE_KEY` uses a `-v1` suffix like the other storage
  keys in this file; if the stored shape ever needs to change (e.g. storing
  more than just names), bump to `-v2` and add a migration read, following
  the `LEGACY_*` pattern already used for theme/history.
