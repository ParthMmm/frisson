# Plan 001: Move the Radio France API token out of source into a Cloudflare env binding

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 32cd2be..HEAD -- src/routes/api/current-track/+server.ts src/app.d.ts .gitignore`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `32cd2be`, 2026-06-30

## Why this matters

`src/routes/api/current-track/+server.ts` has a Radio France GraphQL API token
hardcoded as a plain string constant, committed to git. Anyone who can read
the repository (public or not) gets the token, and it lives forever in git
history even if later deleted from the working tree. This project deploys via
`@sveltejs/adapter-cloudflare` (see `vite.config.ts`), which is built on
Cloudflare Workers and exposes secrets/bindings through `event.platform.env`
at runtime — that's the idiomatic place for this value, not a source file.
This plan moves the token to a Cloudflare env binding, with a local-dev
fallback via `.dev.vars` (which `adapter-cloudflare` auto-loads for `vite dev`
through `wrangler`'s `getPlatformProxy`, confirmed in
`node_modules/@sveltejs/adapter-cloudflare/index.js`, which imports
`getPlatformProxy` from `wrangler`).

## Current state

- `src/routes/api/current-track/+server.ts` — the only file with the
  hardcoded token. Relevant lines today:

  ```ts
  // line 50-52
  const RADIO_FRANCE_GRAPHQL_ENDPOINT = 'https://openapi.radiofrance.fr/v1/graphql';
  const RADIO_FRANCE_TOKEN = '<redacted>';
  const RADIO_FRANCE_LIVEMETA_ENDPOINT = 'https://api.radiofrance.fr/livemeta/live';
  ```

  ```ts
  // line 71-89 — the GET handler, current signature and header usage
  export const GET: RequestHandler = async ({ fetch, request, url }) => {
      const station = url.searchParams.get('station')?.trim();
      const stationNumber = url.searchParams.get('number')?.trim();
      const stationName = url.searchParams.get('name')?.trim();

      if (!station || !stationNumber || !stationName) error(400, 'Missing station metadata');

      const response = await fetch(RADIO_FRANCE_GRAPHQL_ENDPOINT, {
          method: 'POST',
          headers: {
              'content-type': 'application/json',
              'x-token': RADIO_FRANCE_TOKEN
          },
          body: JSON.stringify({
              query: CURRENT_TRACK_QUERY,
              variables: { station }
          }),
          signal: request.signal
      });
  ```

- `src/app.d.ts` — the `App.Platform` interface is currently empty (commented
  out), so `event.platform` has no typed shape yet:

  ```ts
  declare global {
  	namespace App {
  		// interface Error {}
  		// interface Locals {}
  		// interface PageData {}
  		// interface PageState {}
  		// interface Platform {}
  	}
  }
  ```

- `.gitignore` currently ignores `.env`/`.env.*` (with explicit un-ignores for
  `.env.example`/`.env.test`) but does **not** mention `.dev.vars`, which is
  the file Cloudflare's tooling (via `wrangler`) reads for local secret
  emulation:

  ```
  # Env
  .env
  .env.*
  !.env.example
  !.env.test
  ```

- There is no `wrangler.toml`/`wrangler.jsonc` in this repo. That's fine —
  `adapter-cloudflare` generates what it needs at build time and
  `getPlatformProxy` still reads `.dev.vars` for local dev regardless.

## Commands you will need

| Purpose                        | Command         | Expected on success           |
| ------------------------------ | --------------- | ----------------------------- |
| Typecheck                      | `bun run check` | `0 ERRORS 0 WARNINGS`         |
| Dev server (manual smoke test) | `bun run dev`   | server starts on a local port |

There is no test suite in this repo (`package.json` has no `test` script) —
do not invent one for this plan; that gap is tracked separately.

## Scope

**In scope** (the only files you should touch):

- `src/routes/api/current-track/+server.ts`
- `src/app.d.ts`
- `.gitignore`
- `.dev.vars` (new file, must never be committed)
- `.dev.vars.example` (new file, committed, placeholder only)

**Out of scope** (do NOT touch, even though related):

- `src/routes/api/apple-music/+server.ts` — it has no token/secret, nothing to move.
- Adding a `wrangler.toml`/`wrangler.jsonc` — not required for this fix; don't
  introduce one as a side effect.
- Production secret configuration (`wrangler secret put ...` or the Cloudflare
  dashboard) — that's a deploy-time action for a human with account access,
  not something you can do from this checkout. Note it in your final report
  instead of attempting it.

## Git workflow

- Branch: `advisor/001-radio-france-token-env-var`
- One commit for this plan; message style matches recent history, e.g.
  `Move Radio France API token to Cloudflare env binding` (see `git log
--oneline -5` for tone — short, imperative, no period).
- Do NOT push or open a PR unless explicitly instructed.

## Steps

### Step 1: Ignore `.dev.vars` and add a placeholder example file

Edit `.gitignore`'s `# Env` section to also ignore `.dev.vars`:

```
# Env
.env
.env.*
!.env.example
!.env.test
.dev.vars
```

Create `.dev.vars.example` at the repo root (this file IS committed — it's a
placeholder, not the secret):

```
RADIO_FRANCE_TOKEN=replace-with-real-token
```

**Verify**: `git check-ignore .dev.vars` → prints `.dev.vars` (confirms it's
now ignored). `git status --porcelain .dev.vars.example` → shows it as
untracked (ready to be added later in the commit step).

### Step 2: Create the local `.dev.vars` file with the real token

Open `src/routes/api/current-track/+server.ts` and find the current literal
value assigned to `RADIO_FRANCE_TOKEN` (line 51 as of this plan). Copy that
exact literal string — do not paraphrase or regenerate it — into a new file
`.dev.vars` at the repo root:

```
RADIO_FRANCE_TOKEN=<paste the exact current literal value here>
```

**Verify**: `git status --porcelain .dev.vars` → prints nothing (file is
ignored per Step 1, so `git status` won't list it — if it _does_ show up,
STOP, Step 1 didn't take effect, fix that before continuing).

### Step 3: Type the platform env binding

In `src/app.d.ts`, replace the commented-out `// interface Platform {}` line
with:

```ts
interface Platform {
	env: {
		RADIO_FRANCE_TOKEN: string;
	};
}
```

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS` (this alone doesn't
exercise the new type yet — full confirmation happens in Step 5).

### Step 4: Read the token from `platform.env` instead of the hardcoded constant

In `src/routes/api/current-track/+server.ts`:

1. Delete the `RADIO_FRANCE_TOKEN` constant (line 51).
2. Change the handler signature from
   `async ({ fetch, request, url }) => {` to
   `async ({ fetch, request, url, platform }) => {`.
3. Right after the existing `if (!station || !stationNumber || !stationName)
error(400, 'Missing station metadata');` line, add:

   ```ts
   const token = platform?.env.RADIO_FRANCE_TOKEN;
   if (!token) error(500, 'Radio France API token is not configured');
   ```

4. Change the `'x-token': RADIO_FRANCE_TOKEN` header line to `'x-token':
token`.

**Verify**: `bun run check` → `0 ERRORS 0 WARNINGS`.

### Step 5: Smoke-test locally

Run `bun run dev` and, in a separate terminal, request the endpoint for the
main FIP station:

```
curl -s "http://localhost:5173/api/current-track?station=FIP&number=7&name=FIP"
```

(Adjust the port to whatever `bun run dev` printed.)

**Verify**: Response is either `null` or a JSON object with `title`/`artist`
fields — not a 500 with "Radio France API token is not configured". A 500
here means `.dev.vars` isn't being picked up; double check Step 2 and that
`.dev.vars` sits at the repo root (same level as `package.json`), then re-run
`bun run dev` (env files are read at server start, not hot-reloaded).

## Test plan

No automated tests exist for this route yet (see Plan for finding #1, not
selected in this round). The manual `curl` check in Step 5 is the
verification for this plan. If a future plan adds a test harness for this
endpoint, it should mock `platform.env.RADIO_FRANCE_TOKEN` rather than reading
a real token.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `bun run check` exits with `0 ERRORS 0 WARNINGS`
- [ ] `grep -n "RADIO_FRANCE_TOKEN = '" src/routes/api/current-track/+server.ts` returns no matches (constant is gone)
- [ ] `grep -n "platform?.env.RADIO_FRANCE_TOKEN" src/routes/api/current-track/+server.ts` returns exactly one match
- [ ] `git check-ignore .dev.vars` prints `.dev.vars`
- [ ] `git status --porcelain` does NOT list `.dev.vars` as untracked or staged
- [ ] `.dev.vars.example` exists and is tracked (`git ls-files .dev.vars.example` prints the path after commit)
- [ ] Manual `curl` smoke test from Step 5 returns track data or `null`, not a 500
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row for 001 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The code at `src/routes/api/current-track/+server.ts` doesn't match the
  "Current state" excerpts above (drifted since this plan was written).
- `.dev.vars` shows up in `git status` after Step 1 — do not proceed to add
  the real token to a file that might get committed.
- `bun run dev` can't reach the Radio France API at all (network restrictions
  in your environment) — report this as an environment limitation rather than
  guessing whether the code change is correct.
- You find `RADIO_FRANCE_TOKEN` referenced anywhere outside
  `src/routes/api/current-track/+server.ts` (the audit found only one
  location; if that's wrong, the fix needs to cover more files than scoped
  here).

## Maintenance notes

- Before this change reaches production, a human with Cloudflare account
  access must set the real secret via `wrangler secret put
RADIO_FRANCE_TOKEN` (for a Workers deploy) or the Pages dashboard's
  environment variables UI (for a Pages deploy) — whichever this project
  actually uses. This plan does not determine which; check the deploy
  pipeline before shipping.
- If a teammate clones the repo fresh, `bun run dev` will 500 on
  `/api/current-track` until they create their own `.dev.vars` from
  `.dev.vars.example` with a real token. Consider mentioning this in
  `README.md`'s "Getting started" section as a follow-up.
- Plan 002 (endpoint input validation) touches the same file immediately
  after this one — if you're executing both, do this one first.
