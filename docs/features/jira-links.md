# Jira links

Issue keys like `PROJ-4821` are links wherever they show up: session names, the
session tab strip, the title-bar breadcrumb, terminal output and transcripts.
Hovering one shows a card with the issue's title and status. The app only ever
**reads** from Jira — one GET per issue, nothing else.

Built for Jira Server / Data Center: a personal access token as a bearer
token and `/rest/api/2`. Jira Cloud wants an email + API token (Basic auth) and
has retired `/rest/api/2/search`, so it isn't supported yet.

Off until **Settings › Integrations › Jira** is switched on and has a URL —
`jiraOn` (`src/lib/jira.ts`) is the one check every surface uses.

## One detector

`findIssueKeys` (`src/lib/jira.ts`) matches `ABC-123`: 2–10 uppercase
letters/digits starting with a letter, a dash, a number that doesn't start with
0, on word boundaries — and only from the **Project keys** you list. With no
projects listed nothing links: otherwise `UTF-8` and `SHA-256` are issue keys
too, and hovering one would be a wasted request to a rate-limited Jira.

The same function feeds every surface, so a key that links in the terminal
links in the sidebar.

| Surface | How |
|---|---|
| Sidebar row, session tab, breadcrumb | The key is lifted out of the name (`stripIssueKey`) into a small monospace chip (`IssueChip`), so "PROJ-4821 · Fix alert noise" reads "Fix alert noise [PROJ-4821]". Click opens Jira |
| Terminal | An xterm link provider beside the URL one: underline on hover, click opens, hover shows the card. Reads settings per line, so turning Jira on applies to open terminals |
| Transcript (Markdown) | `remarkIssueLinks`, a remark plugin with no dependencies: keys in prose become links; code spans, code blocks and existing links are left alone |

Search already matches keys, because they're part of the name: type `4821`.

Blue (`--link`) is a link color, never a status — the reserved
success/warning/attention/destructive set stays reserved (see
[design.md](../design.md#status-vocabulary)).

## The card

`IssueCard`, mounted once by App and driven by `showIssueCard` /
`hideIssueCard` — 300ms before it opens, a 150ms grace so the pointer can reach
it. It shows status, title, assignee, reporter, priority, created and last
updated (full date, `DD.MM.YYYY HH:MM`, local time) and
which open sessions already mention the key, with **Open in Jira**, **Copy
key** and **New session for this**.

## Staying under Jira's rate limit

Jira here is watched for 429s, so the app asks as little as it can:

- **Nothing in the background.** No polling, no prefetch; chips and links render
  from the name or the line alone. A request happens only when a card opens
  (after a 300ms hover — also when a card is already open and the pointer
  moves to another key, so sweeping across a column of keys costs one request
  for the key it stops on, not one per key) or when a key is typed into New session (debounced
  500ms, so `PROJ-4821` doesn't also look up `PROJ-4`, `PROJ-48`…).
- **One request per key per ten minutes** (`fetchIssue`), with only the fields
  the card shows. Concurrent asks share the in-flight request.
- **Failures are remembered for a minute**, so a 404 or an off-VPN timeout
  doesn't cost a request per hover.
- **A 429 pauses everything** for as long as `Retry-After` says (10s–1h, a
  minute if absent), in the backend, before any request leaves.
- **A refused token pauses for five minutes.** On Jira Server repeated 401s
  count toward a CAPTCHA lockout of the account.

## The token

Settings store the **name** of an environment variable, never the token. The
backend (`src-tauri/src/jira.rs`) resolves it from the app's own environment,
then from the `env` block of `~/.claude/settings.json` — where a Claude Code user
already keeps theirs. The token never crosses IPC; Settings only learns "found"
or "not found" (`jira_token_found`).

No token, no card details: keys still link, and the card says how to add one.

Requests don't follow redirects. Behind an SSO proxy, being off the VPN answers
with a 302 to the login page; the card says "Jira redirected to sign-in — VPN?"
rather than failing to parse a login page.

## My issues

With Jira on, **My issues** joins the navigation block (and the folded rail):
your open issues — `assignee = currentUser() AND resolution = Unresolved`,
latest update first, at most 50 — grouped In progress, then To do.

A row is one quiet line: a priority glyph (signal bars; a red `!` for
critical — only critical and high carry color, `priorityLevel` folds each
scheme's names onto four levels), the key, a session's status dot when a
session's name already carries the key, the title, and the last update. A
status chip shows only when the status says something the group doesn't
(Escalated, Feedback, Backlog — not "In Progress" under In progress). No
buttons on rows: double-click or Enter does the one thing — **Open session**
if there is one, **New session** otherwise.

A click opens the inspector on the right: status, priority, reporter, created
and updated, the description and latest comment, the session, and the action
with **Open in Jira** and **Copy key**. Description and comment are one more
request (`fetchIssueDetail`, cached like a card), asked 300ms after the
selection settles so clicking through the list doesn't ask for every row.

It costs one request when you open it, reused for five minutes (`fetchMyIssues`);
**Refresh** asks again, but never more than once per 30 seconds, and a failed
refresh keeps the list it had with the reason above it. The answer is keyed by
the token variable, so pointing Settings at another token asks again. Each result also fills the per-issue cache, so
hovering a key from the list asks nothing more. Nothing polls. Needs a token:
Jira's `currentUser()` is whoever owns it.

## Starting a session from a ticket

New session has a **Jira issue** field (shown only while Jira is on). Paste
a key or any Jira URL that carries one; with a token, its title is looked up.
The session is named `KEY · title` unless you gave it a name, and Claude's
prompt is pre-filled — not submitted — with the key, title and link, the same
way [starting from a To-Do](todo.md) works. "New session for this" on a card
opens the dialog with the issue filled in.

## Files

- `src/lib/jira.ts` (+ `jira.test.ts`) — detector, URL, input parsing, cache,
  card store, remark plugin
- `src/components/IssueChip.tsx`, `src/components/IssueCard.tsx`
- `src/components/JiraView.tsx` (+ test) — My issues and its inspector
- `src/components/Terminal.tsx` — the link provider
- `src-tauri/src/jira.rs` — key validation, token lookup, the GETs (one
  issue, its description and latest comment, your issues) behind one helper that keeps the rate-limit rules
