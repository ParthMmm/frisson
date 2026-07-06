# Issue tracker: GitHub

Issues and PRDs for this repo live as GitHub issues in `ParthMmm/frisson`. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --repo ParthMmm/frisson --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **Read an issue**: `gh issue view <number> --repo ParthMmm/frisson --comments`, filtering comments by `jq` and also fetching labels.
- **List issues**: `gh issue list --repo ParthMmm/frisson --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'` with appropriate `--label` and `--state` filters.
- **Comment on an issue**: `gh issue comment <number> --repo ParthMmm/frisson --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --repo ParthMmm/frisson --add-label "..."` / `--remove-label "..."`
- **Close**: `gh issue close <number> --repo ParthMmm/frisson --comment "..."`

Running `gh` inside this clone should infer the same repo from `git remote -v`.

## Pull requests as a triage surface

**PRs as a request surface: no.**

Do not pull PRs into the `/triage` queue unless this file is changed later. Collaborators' in-flight PRs should not be triaged as incoming requests.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either — resolve with `gh pr view 42 --repo ParthMmm/frisson` and fall back to `gh issue view 42 --repo ParthMmm/frisson`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Run `gh issue view <number> --repo ParthMmm/frisson --comments`.
