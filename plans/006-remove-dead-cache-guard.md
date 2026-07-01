# Plan 006: Remove the unreachable guard in `readCachedCurrentTrack`

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
> treat it as a STOP condition. In particular, re-verify the "Why this is
> dead code" reasoning below still holds against the live code — if an
> `await` was introduced between the `requestId` increment and the call to
> `readCachedCurrentTrack`, the branch this plan removes is no longer dead
> and this plan no longer applies. STOP if so.

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none (recommended to run after Plan 003, which touches the
  same file, to reduce merge friction — not a hard technical dependency)
- **Category**: tech-debt
- **Planned at**: commit `32cd2be`, 2026-06-30

## Why this matters

`readCachedCurrentTrack` has a branch that can never execute given how it's
called today. It's not causing a bug, but it's a small trap for future
readers: it implies a race condition is being guarded against here, when the
actual race guard lives further down in `loadCurrentTrack`'s `catch`/`then`
continuation (after a real `await`, where a race can genuinely occur).
Removing the dead branch makes the function's real behavior — "return the
live cached track if fresh, or report a cache miss" — match what it reads
like.

## Current state

`src/routes/+page.svelte`, the only call site (inside `loadCurrentTrack`,
lines 542–548):

```ts
async function loadCurrentTrack(station: Station) {
    if (station.apiStation !== selectedStation.apiStation) return;
    const requestId = ++currentTrackRequestId;
    currentTrackRequest?.abort();
    currentTrackRequest = null;

    if (readCachedCurrentTrack(station, requestId)) return;
```

Note there is no `await` between `const requestId = ++currentTrackRequestId;`
and the call to `readCachedCurrentTrack(station, requestId)` — everything in
between is synchronous (`AbortController.abort()` and a `null` assignment).
No other code in this file can run in between, so by the time
`readCachedCurrentTrack` executes, `requestId === currentTrackRequestId` is
guaranteed true, and `station.apiStation === selectedStation.apiStation` was
already just checked true on the line above with nothing able to change it
synchronously.

The function being simplified (lines 369–385):

```ts
function readCachedCurrentTrack(station: Station, requestId: number) {
	const cached = currentTrackCache.get(station.apiStation);
	if (!cached) return false;

	if (Date.now() >= cached.expiresAt) {
		currentTrackCache.delete(station.apiStation);
		return false;
	}

	if (!isCurrentTrackRequest(station, requestId)) return true;

	currentTrack = cached.track;
	metadataState = 'ready';
	metadataError = '';
	scheduleNextMetadataRefresh(station, cached.track);
	return true;
}
```

The `if (!isCurrentTrackRequest(station, requestId)) return true;` line is
the dead branch — it always evaluates to `false` given the call site above,
so it never actually returns early; execution always falls through to
`currentTrack = cached.track; ...`.

`isCurrentTrackRequest` itself (lines 584–586) is used correctly elsewhere,
in the async continuation after a real `await` — do not touch it:

```ts
function isCurrentTrackRequest(station: Station, requestId: number) {
	return requestId === currentTrackRequestId && station.apiStation === selectedStation.apiStation;
}
```

## Commands you will need

| Purpose   | Command         | Expected on success   |
| --------- | --------------- | --------------------- |
| Typecheck | `bun run check` | `0 ERRORS 0 WARNINGS` |

No test suite exists in this repo — don't invent one for this plan.

## Scope

**In scope**:

- `src/routes/+page.svelte` only, and only the `readCachedCurrentTrack`
  function and its single call site.

**Out of scope**:

- `isCurrentTrackRequest` — still legitimately used elsewhere (the `catch`
  and `then` paths of the async fetch in `loadCurrentTrack`, after a real
  `await`). Do not remove or change it.
- Any other function in this file.

## Git workflow

- Branch: `advisor/006-remove-dead-cache-guard`
- One commit; message style e.g. `Remove unreachable guard in readCachedCurrentTrack`.
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Simplify `readCachedCurrentTrack`

Change:

```ts
function readCachedCurrentTrack(station: Station, requestId: number) {
	const cached = currentTrackCache.get(station.apiStation);
	if (!cached) return false;

	if (Date.now() >= cached.expiresAt) {
		currentTrackCache.delete(station.apiStation);
		return false;
	}

	if (!isCurrentTrackRequest(station, requestId)) return true;

	currentTrack = cached.track;
	metadataState = 'ready';
	metadataError = '';
	scheduleNextMetadataRefresh(station, cached.track);
	return true;
}
```

to:

```ts
function readCachedCurrentTrack(station: Station) {
	const cached = currentTrackCache.get(station.apiStation);
	if (!cached) return false;

	if (Date.now() >= cached.expiresAt) {
		currentTrackCache.delete(station.apiStation);
		return false;
	}

	currentTrack = cached.track;
	metadataState = 'ready';
	metadataError = '';
	scheduleNextMetadataRefresh(station, cached.track);
	return true;
}
```

(The `requestId` parameter is removed since it's no longer used.)

**Verify**: `bun run check` will still show an error at this point (the call
site hasn't been updated yet) — that's expected; proceed to Step 2 before
verifying.

### Step 2: Update the call site

Change:

```ts
if (readCachedCurrentTrack(station, requestId)) return;
```

to:

```ts
if (readCachedCurrentTrack(station)) return;
```

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS`.

### Step 3: Manual smoke test

Run `bun run dev`, open the app, switch stations a few times back and forth
quickly (e.g. click "Next station" rapidly), and confirm the now-playing
panel still updates correctly for whichever station you land on, with no
stuck/stale metadata.

**Verify**: No console errors; now-playing title/artist matches the
currently selected station within a couple seconds of settling on it.

## Test plan

No automated tests exist in this repo. Step 3's manual smoke test is this
plan's verification — this is a pure code-simplification with no intended
behavior change, so the bar is "still behaves identically under rapid
station switching," not new coverage.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run check` exits with `0 ERRORS 0 WARNINGS`
- [ ] `grep -n "readCachedCurrentTrack(station, requestId)" src/routes/+page.svelte` returns no matches (old two-arg call site is gone)
- [ ] `grep -n "function readCachedCurrentTrack(station: Station)" src/routes/+page.svelte` returns exactly one match (new one-arg signature)
- [ ] Manual smoke test in Step 3 shows no regression under rapid station switching
- [ ] No files outside `src/routes/+page.svelte` are modified (`git status`)
- [ ] `plans/README.md` status row for 006 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The call site in `loadCurrentTrack` has an `await` (or any other
  async/state-mutating call) inserted between the `requestId` increment and
  the call to `readCachedCurrentTrack` that wasn't there when this plan was
  written — that would make the removed branch reachable again, and this
  plan's premise wrong. Revert your change and report this instead.
- `isCurrentTrackRequest` has any other call site besides the two already
  noted (the removed one, and the async continuation in `loadCurrentTrack`)
  — re-check with `grep -n "isCurrentTrackRequest(" src/routes/+page.svelte`
  before starting; if it returns more than 3 matches (the definition plus 2
  call sites), STOP and report what the extra call site is.

## Maintenance notes

- This is a pure simplification; if `loadCurrentTrack` is ever refactored to
  introduce a genuine async gap before the cache check (e.g. an `await` added
  for some new pre-check), the removed guard's reasoning needs
  re-evaluation — re-add a request-identity check at that point if so.
