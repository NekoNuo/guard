<p align="center"><img src="assets/icon.svg" width="88" height="88" alt="Client guard"></p>

# @magpie-community/middleware-guard

[简体中文](README.md) · **English**

Serves only the clients you name, as [magpie](https://usemagpie.ai) gateway middleware. A request is matched — by the agent magpie saw it come from, by the model it asks for, and by the provider or group in that model's name — against lists of globs. One that fails them is turned away with a 403 whose text names the agent, the rule it hit and where to change it. Everything else is sent on untouched.

This is the plugin for a relay that serves one client only, or is banned for serving another: everyone the lists do not name is turned away before a provider sees the request. It is not a signature check — it reads the name magpie puts on the request, nothing else.

There are two ways in, and the difference is the page:

```sh
magpie plugin add ./packages/guard       # the folder: the middleware and its page
magpie plugin add ./guard.gateway.js     # the file: the middleware alone, no page
magpie plugin                            # guard  on  gateway middleware  onRequest, onProvider · onUsage
                                         #              page  Client guard (reads providers:list)
```

The folder shows as `guard`, the file as `guard.gateway.js`. Both run the same middleware; only the folder brings the page, because a page is HTML, CSS and scripts in files beside the middleware and a single `.js` file has none.

Edit the lists on the page — **Plugins › guard**, then **Client guard** in the sidebar — or set the options by hand under **Plugins › Installed › Options**:

```sh
magpie plugin options guard '{"allow":["claude-code","codex"]}'
```

The name to use is the one in `plugins.json`: `guard` for the folder, `guard.gateway.js` for the single file. The 403 text names `guard.gateway.js`, the file this package ships; edit the same row.

The page is the picker; the JSON below is what it writes, and what `magpie plugin options` takes. A multiple choice is an array.

## The page

The page holds the two client lists, the two provider lists and the two kinds of rule, with a count of each at the top:

- **Allowed clients** and **Blocked clients** — a list of chips each, added by typing a name (or picking one of the suggestions) and removed with ×. The suggestions spell out what magpie calls each client: `claude-code` arrives as `claude`, `cursor` as `cursor-local`.
- **Allowed providers** and **Blocked providers** — the provider ids a request may go to, each with **Choose a provider** and a field for an id that is not listed. A model must name one of the allowed providers while that list is not empty; a model named without a provider is turned away then too.
- **Per-model rules** — one card per `byModel` entry: its model globs, the clients it allows, and the clients it blocks, with ↑ ↓ × to order and remove. Order matters: the first entry whose glob hits the model applies, and its block list is asked before its allow list.
- **Per-provider rules** — one card per `byProvider` entry: the provider ids it covers, the clients allowed on them, and the clients blocked there. **Choose a provider** opens a menu of the ids `providers:list` returned — filtered as you type, scrolling when there are many, and floating over the page rather than stretching the card. An id that is not listed is typed into the field below. A card's allow list stands in for **Allowed clients**; left empty, that list still applies.
- **Save** (or ⌘S / Ctrl-S) writes the options; **Options as JSON** at the bottom shows exactly what will be written.

The page declares one permission — `providers:list`, for the provider ids — and reads no requests: it cannot list who is calling, or see a body, a prompt or a usage row. Only this plugin's own options go in and out, through `magpie.options.get/set`. What it saves applies from the next request. Hand-written options it does not understand — a key this page does not manage — are kept as they are. Opened as a file, outside magpie, it shows the example from `package.json` read-only and says so.

A single-file install has no page. If the lists are long enough to want the page, install the folder instead; the options are the same either way.

## Options

```json
{ "allow": ["claude-code", "codex"],
  "block": ["cursor", "other"],
  "providerAllow": ["relay-a", "relay-b"],
  "providerBlock": ["relay-c"],
  "byModel": [{ "match": ["claude-*", "gpt-5*"], "allow": ["claude-code", "codex"], "block": ["cursor"] }],
  "byProvider": [{ "match": ["relay-a"], "allow": ["claude-code"], "block": ["other"] }],
  "maxLog": 6 }
```

- **`block`.** Agents to turn away. Asked first, and wins over everything.
- **`providerAllow` / `providerBlock`.** Provider ids, group ids or globs, matched on the model's name (`relay-a` in `relay-a/claude-sonnet-4-5`). `providerBlock` turns a matching provider away; a non-empty `providerAllow` turns away every model that names a provider not on it — and one that names no provider at all. Empty lists do nothing. This filters where the request may go, whichever client sent it.
- **`byModel`.** Entries of `match` (a glob, or a list of them), `allow` and `block`. The first entry whose `match` hits the model applies: its `block` list turns agents away, and its `allow` list decides the rest. An empty `allow` lets anyone; an empty `block` blocks no one. A model rule is more specific than a provider one, so it decides first when both hit.
- **`byProvider`.** Entries of `match` (provider ids, group ids or globs), `allow` and `block`. The first entry whose `match` hits the model's provider or group name applies: its `block` list turns agents away, and a non-empty `allow` list stands in for the top-level one. An empty `allow` here leaves the top-level list in force — write `["*"]` to let anyone in. That name is the one the agent asked for, not the provider routing lands on. For `group/<id>` the group's id (`translate`), `group` (every group), and the whole `group/<id>` can be written; a rule for `zifeiyu` covers only clients that ask for `zifeiyu/…` directly, because a group's members are not visible here. A model asked without a `/` matches no provider entry.
- **`allow`.** For a model no `byModel` entry matched and a provider no `byProvider` entry named. Empty means anyone.
- **`maxLog`.** How many lines the usage summary prints, 1 to 40; 6 if unset. It has no control on the page; set it with `magpie plugin options`.

In order: `block`, `providerBlock`, `providerAllow`, the model rule's `block`, the provider entry's `block`, the model rule's `allow`, the provider entry's `allow`, then `allow`. **Nothing is denied by default** — only a list that names something turns a request away, and an empty list never does. A field of the wrong type is treated as one that was not set — a typo in `allow` cannot turn away every request — and magpie's log gets a line saying so. Options that are not a JSON object turn nothing away either.

## What an agent is called

`ctx.agent` is the name magpie works out for a request, mostly from its User-Agent. Measured on 0.1.1433:

| What the client sends | `ctx.agent` |
|---|---|
| `claude-cli/1.0.0 (external, cli)`, `claude-code/2.0.1` | `claude` |
| `codex_cli_rs/0.50.0`, `codex/1.2` | `codex` |
| `cursor/0.48.0` | `cursor-local` |
| `Cline/3.1.0` | `cline` |
| `opencode/0.3.1` | `opencode` |
| `Go-http-client/1.1` | `Go-http-client` |
| `Mozilla/5.0` | `Mozilla` |
| no User-Agent at all | `other` |

So an allow list written for people — `claude-code`, `codex` — would not match `claude` on its own. Rules and agents are both lower-cased, and the usual spellings are mapped first: `claude-code`, `claude-cli`, `claude-desktop` → `claude`; `codex-cli`, `codex_cli_rs` → `codex`; `cursor-local` → `cursor`. `*` is a wildcard, matched against the whole name, so `cursor*` covers `cursor-local` and `other` covers a request with no User-Agent.

A model is matched as the agent asked for it and by its last `/`-separated part, so `claude-*` reaches `relay/claude-sonnet-4-5` as well as `claude-sonnet-4-5`.

## What a turned-away request gets

`ctx.reject(403, …)`, written in the agent's own API — an Anthropic request gets an Anthropic error body, a Chat one a Chat error. The text is one sentence, for example:

```
magpie's guard turned this request away: agent "Mozilla" is not on the allow list of
byModel[0] (match "claude-*", "gpt-5*") for model "relay/claude-sonnet-4-5"
— change the lists in Plugins › guard.gateway.js › Options.
```

## What it records

A request the guard turns away never reaches magpie's request list, so each one is counted here, and one line goes to magpie's log — once per client every 15 s, so a client turned away for the first time is said at once:

```
guard: turned away cursor-local for model relay-a/claude-sonnet-4-5 — provider "relay-a" block "cursor"
```

The first request a client makes on a provider is said once too, so the log shows who is arriving:

```
guard: first request from claude on relay-a
```

When `byProvider` rules exist but the model's provider or group name matches none of them — a group, usually — one line says so, once per name, instead of leaving the rules looking broken:

```
guard: no byProvider rule matches "translate" — the model is named group/translate,
and those rules read that name, not the provider it routes to
```

`onUsage` sees every request that ended — agent, provider, status, `rejected` — and keeps a tally of agent × provider with calls, last time and last status, printed as a summary once a minute and every 25 rows, at most `maxLog` lines:

```
guard: 12 requests seen here, 3 turned away here
  claude → relay: 9, last 200 at 02:37:03
  codex → relay: 3, last 200 at 02:36:51
```

No body, prompt, tool argument or error text is ever read or printed; the model and provider names above are all a line holds.

**A tally is a share, not a total.** moejs compiles this middleware once and gives each request a runtime, and magpie keeps more than one, so the counters start at zero in each and the summary covers only what that runtime saw. Use it to see *who* is coming through and what they are hitting; use magpie's **Plugins** page for every call and failure of the hooks, and the request list for the complete record. Neither replaces the other.

## What it cannot do

- **Show you the client of a request in the page.** A page may read `usage:summary` and `providers:list`; neither carries a request's agent, and the frame has no network to ask for one. magpie's Requests page and the guard lines in magpie's log are where a client is visible.
- **Turn a request away for the routed provider exactly.** `onRequest` runs before routing, so it cannot know which provider or group a request will land on; `onProvider` runs after, where `ctx.reject` no longer stops anything. `byProvider` matches the name in the model — a routing name the agent asked for. A group carries its own name (`group/…`) and can lead to several providers, or into another group; a bare model carries none. A group's members are not visible this early, so a rule for `zifeiyu` (or for a nested `tral`) covers `zifeiyu/…`, not a client that asks for the outer group — write the outer group's id instead, or block the client globally.
- **Appear in the request list when it turns something away.** The record is written after middleware, and a request the guard stopped never gets there.
- **See the Test / Detect protocol button.** That check sends `content: "hi"` with `User-Agent: Go-http-client/1.1` and does not go through `serveAgent`, so no middleware sees it. To police it, wrap the relay in a provider plugin (Bun, with its own `fetch`) that decides whether to send it and with which User-Agent.

## Limits

A hook has 250 ms. Anything it throws, or a wrong return, and the request is sent as it came: this fails open, never closed. Options changes take effect from the next request in the app; `magpie serve` reloads them when it starts, so restart it, or turn the plugin off and on in the app.

## Checking it

Install the folder, open **Plugins › guard** and then **Client guard**, and the page should show the lists from the package's example options. Add `claude-code` and `codex` to **Allowed clients**, `cursor` and `other` to **Blocked clients**, put `claude-*` and `gpt-5*` with those two clients under **Per-model rules**, and — to give one relay its own policy — add a **Per-provider rules** card on that provider's id with the clients it may serve. Press **Save**: `Saved` replaces `Unsaved changes`, and **Options as JSON** shows what was written.

Then, with the relay serving, three requests, one per User-Agent:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3425/v1/messages \
  -H 'content-type: application/json' -H 'User-Agent: claude-code/2.0.1' \
  -d '{"model":"claude-sonnet-4-5","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
# 200, or the relay's own error — not 403

curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3425/v1/messages \
  -H 'content-type: application/json' -H 'User-Agent: codex_cli_rs/0.50.0' \
  -d '{"model":"gpt-5-codex","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
# 200, or the relay's own error — not 403

curl -sS http://127.0.0.1:3425/v1/messages \
  -H 'content-type: application/json' -H 'User-Agent: Mozilla/5.0' \
  -d '{"model":"claude-sonnet-4-5","max_tokens":1,"messages":[{"role":"user","content":"hi"}]}'
# 403, with the sentence above naming Mozilla and the rule
```

`Plugins › Installed` then shows the row's hooks (`onRequest, onProvider · onUsage`) and, once requests have gone through, its calls, average time and failures. `onProvider` is a no-op there: routing is done by then, so nothing can be turned away, and this plugin never rewrites a body.
