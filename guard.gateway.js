// Serves only the clients you name: a request is matched, by the agent
// magpie saw it come from and by the model it asks for, against lists of
// globs. One that fails them is turned away with a 403 whose text names the
// agent, the rule it hit and where to change it. Everything else is sent on
// untouched: this middleware never reads or edits a body.
//
//   {"allow": ["claude-code", "codex"],
//    "block": ["cursor", "other"],
//    "providerAllow": ["relay-a", "relay-b"],
//    "providerBlock": ["relay-c"],
//    "byModel": [{"match": ["claude-*", "gpt-5*"], "allow": ["claude-code", "codex"],
//                 "block": ["cursor"]}],
//    "byProvider": [{"match": ["relay-a"], "allow": ["claude-code"], "block": ["other"]}],
//    "maxLog": 6}
//
// The rules, in the order they decide:
//
//   block          first: an agent matching any entry is turned away.
//   providerBlock  a model naming a provider on the blocked providers list.
//   providerAllow  with a non-empty allowed providers list: a model naming
//                  a provider that is not on it, or naming no provider at all.
//   byModel        a matching entry's block list.
//   byProvider     a matching entry's block list.
//   byModel        the same entry's allow list, which stands in for the
//                  global one; an empty allow means anyone. A model rule is
//                  more specific than a provider one.
//   byProvider     the entry's allow list, when it is not empty.
//   allow          the global list, for a model no model rule matched and a
//                  provider no entry named, or whose lists left it alone.
//
// providerAllow, providerBlock and byProvider read the model's first
// /-separated part — the provider or group the agent named, not the one
// routing lands on. For group/<id> "group", the group's id and the whole
// "group/<id>" can all be written. A model asked without one names no
// provider: it passes providerBlock, and providerAllow turns it away while
// that list is not empty. A group's members are not visible here, so a rule
// for a member's provider id does not reach a request that goes through the
// group.
//
// So an empty list never turns a request away, and with no options at all
// nothing is turned away either. Nothing is denied by default: only a list
// that names something does that.
//
// An agent is matched lower-cased, * being a wildcard, against magpie's name
// for it and its usual spellings: a Claude Code request reaches this as
// "claude", not "claude-code" (see AGENTS), and one with no User-Agent at
// all as "other". A model is matched as the agent asked for it and by its
// last /-separated part, so "claude-*" reaches "relay/claude-sonnet-4-5".
//
// This runs before routing, so it cannot stop a request per provider. What
// it can do is read the name the agent asked for: byProvider matches the
// first /-separated part of it — a provider id, or a group's id — which is a
// routing name, not the provider the request ends up on. That one is not
// known this early, and a group can lead to several.
//
// What it records, and what it cannot: a request this turns away never
// reaches magpie's request list, so each one is counted here and said in a
// line (once per client every 15 s, and no body or prompt is ever printed).
// onUsage keeps the same tally for what did go through: the first request
// from a client on a provider is said once, then the counts — agent and
// provider, calls, last time and last status — are printed once a minute and
// every 25 rows, as at most maxLog lines. moejs gives each request a runtime,
// and magpie keeps more than one, so a tally covers only what this runtime
// saw: magpie's Plugins page counts every call and failure of the hooks, and
// its request list is the whole record. Neither is a substitute for the
// other.

const EDIT = "Plugins › guard.gateway.js › Options"
const DEFAULT_MAX_LOG = 6
const MAX_MAX_LOG = 40
const SUMMARY_EVERY_MS = 60000
const SUMMARY_EVERY_ROWS = 25
const TURNED_AWAY_EVERY_MS = 15000

// AGENTS maps the names users write to the names magpie hands this
// middleware. Claude Code arrives as "claude" whatever its User-Agent says,
// Codex as "codex"; the spellings on the left are what people put in an
// allow list.
const AGENTS = {
  "claude-code": "claude",
  "claude-cli": "claude",
  "claude-desktop": "claude",
  "codex-cli": "codex",
  "codex-cli-rs": "codex",
  "cursor-local": "cursor",
}

export function onRequest(body, ctx) {
  if (!ctx || typeof ctx.reject !== "function") return
  let cfg
  try {
    cfg = config(ctx.options)
  } catch {
    return
  }
  if (!cfg.gated) return

  // The name as magpie gave it is what a person looking at the log wants to
  // see; the name rules are matched by is the normalised one (agentName).
  const raw = typeof ctx.agent === "string" ? ctx.agent.trim() : ""
  const agent = agentName(raw)
  const model = modelName(body, ctx)
  const hit = decide(cfg, agent, model)
  if (!hit) {
    noteUnmatchedProvider(cfg, model)
    return
  }

  // A request turned away here is in no request list, so it is counted and
  // said here, as one line, never more often than TURNED_AWAY_EVERY_MS.
  noteTurnedAway(raw || "unknown", model, hit)
  ctx.reject(403, message(raw, model, hit))
}

// onProvider is called once for every provider a request is tried on, after
// routing. Nothing can be turned away there, and this plugin never rewrites
// a body, so each try is left exactly as it came: it returns undefined, not
// a body. It is exported so the hooks this middleware answers are named as
// they are, and does nothing else.
export function onProvider(body, ctx) {
  return undefined
}

// onUsage gets every request that ended, whether it succeeded or not, and
// only what a row holds: provider, account, key, model, tokens, times,
// status, error type and cost. Never a body, a prompt or an error text.
export function onUsage(row, options) {
  try {
    if (!row || typeof row !== "object") return
    const cfg = config(options)
    const agent = typeof row.agent === "string" && row.agent.trim() ? row.agent.trim().toLowerCase() : "unknown"
    const provider = typeof row.provider === "string" && row.provider ? row.provider : "unknown"
    const key = agent + " → " + provider
    let u = usage[key]
    if (!u) usage[key] = u = { calls: 0, at: 0, status: 0, turnedAway: 0 }
    u.calls++
    // The first request a client makes on a provider is said once, so the
    // log shows who is arriving without a line per request.
    if (u.calls === 1) {
      try {
        console.log("guard: first request from " + agent + " on " + provider)
      } catch {
        // As above.
      }
    }
    u.at = Number(row.time) > 0 ? Number(row.time) : Date.now()
    u.status = Number(row.status) || 0
    if (row.rejected === true) u.turnedAway++
    usageTotal++
    summarize(cfg.maxLog)
  } catch {
    // Counting is never a reason to fail a request.
  }
}

// ---- the decision ---------------------------------------------------------

// decide answers the rule that turns this request away, or null. block is
// asked first, so it wins over anything; then a provider's own block; then
// the model's list, which is the most specific; then the provider's allow
// list, and at last the top-level one.
function decide(cfg, agent, model) {
  for (const rule of cfg.block) {
    if (glob(agentName(rule), agent)) return { kind: "block", rule }
  }
  const names = providerNames(model)
  for (const rule of cfg.providerBlock) {
    if (names.some((name) => glob(rule, name))) return { kind: "providerListBlock", rule }
  }
  if (cfg.providerAllow.length && !names.some((name) => someGlob(cfg.providerAllow, name))) {
    return { kind: "providerListAllow", rule: "", head: names.length ? names[names.length - 1] : "" }
  }
  const prov = providerRule(cfg.byProvider, names)
  const own = modelRule(cfg.byModel, model)
  if (own) {
    for (const rule of own.block) {
      if (glob(agentName(rule), agent)) return { kind: "modelBlock", rule, entry: own, index: own.index }
    }
  }
  if (prov) {
    for (const rule of prov.rule.block) {
      if (glob(agentName(rule), agent)) return { kind: "providerBlock", rule, entry: prov.rule, index: prov.index }
    }
  }
  if (own) {
    // An entry with an empty allow means anyone may use the model.
    if (own.allow.length && !someMatch(own.allow, agent)) return { kind: "byModel", rule: own }
    return null
  }
  if (prov && prov.rule.allow.length) {
    if (!someMatch(prov.rule.allow, agent)) return { kind: "provider", entry: prov.rule, index: prov.index }
    return null
  }
  if (cfg.allow.length && !someMatch(cfg.allow, agent)) return { kind: "allow", rule: "" }
  return null
}

// providerNames is what a byProvider rule may be written against: the
// model's first /-separated part, which is the provider id — or, for
// group/<id>, "group" (every group), the group's own id, and the whole
// "group/<id>" as the client writes it.
function providerNames(model) {
  const cut = model.indexOf("/")
  if (cut <= 0) return []
  const head = model.slice(0, cut)
  const rest = model.slice(cut + 1)
  if (head === "group" && rest) return ["group", rest, "group/" + rest]
  return [head]
}

// providerRule is the first byProvider entry whose match hits one of those
// names. It is a routing name the agent asked for, not the provider the
// request ends up on, which is not known this early.
function providerRule(rules, names) {
  if (!names.length) return null
  for (let i = 0; i < rules.length; i++) {
    for (const g of rules[i].match) {
      for (const name of names) if (glob(g, name)) return { rule: rules[i], index: i }
    }
  }
  return null
}

function someGlob(list, value) {
  for (const rule of list) if (glob(rule, value)) return true
  return false
}

// modelRule is the first byModel entry whose match hits the model, as the
// agent asked for it or by its last /-separated part.
function modelRule(rules, model) {
  if (!model) return null
  const tail = model.slice(model.lastIndexOf("/") + 1)
  for (const rule of rules) {
    for (const g of rule.match) {
      if (glob(g, model) || (tail && tail !== model && glob(g, tail))) return rule
    }
  }
  return null
}

function someMatch(list, agent) {
  for (const rule of list) if (glob(agentName(rule), agent)) return true
  return false
}

// agentName is the name to match an agent by: lower-cased, spaces and
// underscores as hyphens, a version or User-Agent tail dropped, and the
// usual spellings mapped to magpie's own (AGENTS).
function agentName(v) {
  if (typeof v !== "string") return ""
  let s = v.trim().toLowerCase()
  if (!s) return ""
  const cut = s.search(/[\s/()]/)
  if (cut > 0) s = s.slice(0, cut)
  s = s.replace(/_/g, "-").replace(/-+/g, "-")
  return AGENTS[s] || s
}

function modelName(body, ctx) {
  if (ctx && typeof ctx.model === "string" && ctx.model) return ctx.model
  if (body && typeof body.model === "string") return body.model
  return ""
}

// glob matches a whole string, ignoring case, * being any run of characters.
const globCache = {}
function glob(rule, value) {
  if (typeof rule !== "string" || !rule) return false
  const key = rule.toLowerCase()
  let re = globCache[key]
  if (!re) {
    const parts = key.split("*")
    let src = "^"
    for (let i = 0; i < parts.length; i++) {
      src += parts[i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      if (i < parts.length - 1) src += ".*"
    }
    src += "$"
    try {
      re = new RegExp(src)
    } catch {
      return false
    }
    globCache[key] = re
  }
  return re.test(String(value).toLowerCase())
}

// ---- the words a turned-away request gets --------------------------------

function message(agent, model, hit) {
  const who = agent ? 'agent "' + agent + '"' : "an agent magpie couldn't name"
  const which = model ? ' for model "' + model + '"' : ""
  const where = " — change the lists in " + EDIT + "."
  if (hit.kind === "block") {
    return "magpie's guard turned this request away: " + who + " is on the block list, by rule \"" + hit.rule + "\"" + which + where
  }
  if (hit.kind === "providerListBlock") {
    return "magpie's guard turned this request away: provider \"" + hit.rule + "\" is on the blocked providers list" + which + where
  }
  if (hit.kind === "providerListAllow") {
    const named = hit.head ? "provider \"" + hit.head + "\"" : "a model that names no provider"
    return "magpie's guard turned this request away: " + named + " is not on the allowed providers list" + which + where
  }
  if (hit.kind === "modelBlock") {
    return "magpie's guard turned this request away: " + who + " is on byModel[" + hit.index + "]'s block list (match \"" +
      hit.entry.match.join('", "') + "\"), by rule \"" + hit.rule + "\"" + which + where
  }
  if (hit.kind === "providerBlock") {
    return "magpie's guard turned this request away: " + who + " is on provider \"" + hit.entry.match.join('", "') +
      "\"'s block list, by rule \"" + hit.rule + "\"" + which + where
  }
  if (hit.kind === "provider") {
    return "magpie's guard turned this request away: " + who + " is not on the allow list of provider \"" +
      hit.entry.match.join('", "') + "\"" + which + where
  }
  if (hit.kind === "byModel") {
    return "magpie's guard turned this request away: " + who + " is not on the allow list of byModel[" +
      hit.rule.index + "] (match \"" + hit.rule.match.join('", "') + "\")" + which + where
  }
  return "magpie's guard turned this request away: " + who + " is not on the allow list" + which + where
}

function ruleLabel(hit) {
  if (hit.kind === "block") return 'block "' + hit.rule + '"'
  if (hit.kind === "providerListBlock") return 'providers block "' + hit.rule + '"'
  if (hit.kind === "providerListAllow") return "providers allow list"
  if (hit.kind === "modelBlock") return 'byModel[' + hit.index + "] \"" + hit.entry.match.join('", "') + '" block "' + hit.rule + '"'
  if (hit.kind === "providerBlock") return 'provider "' + hit.entry.match.join('", "') + '" block "' + hit.rule + '"'
  if (hit.kind === "provider") return 'provider "' + hit.entry.match.join('", "') + '" allow list'
  if (hit.kind === "byModel") return 'byModel[' + hit.rule.index + "] \"" + hit.rule.match.join('", "') + '"'
  return "allow list"
}

// ---- printing what happened ---------------------------------------------

const seen = {}
function warnOnce(key, text) {
  if (seen[key]) return
  seen[key] = true
  try {
    console.log("guard: " + text)
  } catch {
    // No log is never a reason to fail a request.
  }
}

const unmatchedHeads = {}

// A byProvider rule reads the model's first /-part. When a client asks for a
// group or a bare model, that part is the group's name, not a provider's, so
// the rule can never hit. Say so once per name, rather than leave the rules
// looking broken.
function noteUnmatchedProvider(cfg, model) {
  if (!cfg.byProvider.length) return
  const names = providerNames(model)
  if (!names.length || providerRule(cfg.byProvider, names)) return
  const label = names[names.length - 1]
  if (unmatchedHeads[label]) return
  unmatchedHeads[label] = true
  try {
    console.log("guard: no byProvider rule matches \"" + label + "\" — the model is named " + model +
      ", and those rules read that name, not the provider it routes to")
  } catch {
    // As above.
  }
}

const turnedAway = {}
let turnedAwayTotal = 0

function noteTurnedAway(agent, model, hit) {
  const key = agent || "unknown"
  let r = turnedAway[key]
  if (!r) turnedAway[key] = r = { calls: 0, rule: "", model: "", at: 0, since: 0, lineAt: 0 }
  r.calls++
  r.rule = ruleLabel(hit)
  r.model = model
  r.at = Date.now()
  r.since++
  turnedAwayTotal++
  // Per client, not across all of them: a client turned away for the first
  // time is said at once, however busy another one is.
  const now = r.at
  if (r.lineAt && now - r.lineAt < TURNED_AWAY_EVERY_MS) return
  r.lineAt = now
  const many = r.since
  r.since = 0
  try {
    console.log("guard: turned away " + key + (model ? " for model " + model : "") + " — " +
      r.rule + (many > 1 ? " (" + many + " since the last line)" : ""))
  } catch {
    // As above.
  }
}

const usage = {}
let usageTotal = 0
let summaryAt = 0

// summarize prints a summary once a minute, and again every 25 rows, with
// maxLog lines of detail. Its numbers are what this runtime saw (see the
// note at the top).
function summarize(maxLog) {
  const now = Date.now()
  const due = usageTotal % SUMMARY_EVERY_ROWS === 0
  if (!due && summaryAt && now - summaryAt < SUMMARY_EVERY_MS) return
  summaryAt = now
  const rows = []
  for (const key in usage) rows.push([key, usage[key]])
  rows.sort((a, b) => b[1].calls - a[1].calls)
  const shown = Math.min(maxLog, rows.length)
  try {
    console.log("guard: " + usageTotal + " requests seen here" +
      (turnedAwayTotal ? ", " + turnedAwayTotal + " turned away here" : ""))
    for (let i = 0; i < shown; i++) {
      const u = rows[i][1]
      console.log("  " + rows[i][0] + ": " + u.calls + ", last " + (u.status || "?") + " at " + clock(u.at) +
        (u.turnedAway ? ", " + u.turnedAway + " rejected" : ""))
    }
    if (rows.length > shown) console.log("  +" + (rows.length - shown) + " more (maxLog " + maxLog + ")")
  } catch {
    // As above.
  }
}

function clock(ms) {
  const d = new Date(ms)
  const two = (n) => (n < 10 ? "0" : "") + n
  return two(d.getHours()) + ":" + two(d.getMinutes()) + ":" + two(d.getSeconds())
}

// ---- options -------------------------------------------------------------

// config reads the options as they are, and treats a field of the wrong
// type as one that was not set: a typo in one list leaves the others
// working, and never turns every request away.
function config(o) {
  const cfg = {
    allow: [], block: [], byModel: [], byProvider: [],
    providerAllow: [], providerBlock: [], maxLog: DEFAULT_MAX_LOG, gated: false,
  }
  if (o === undefined || o === null) return cfg
  if (typeof o !== "object" || Array.isArray(o)) {
    warnOnce("options", "the options are " + (Array.isArray(o) ? "an array" : "a " + typeof o) +
      ", not a JSON object, so nothing is turned away")
    return cfg
  }
  cfg.allow = list(o.allow, "allow")
  cfg.block = list(o.block, "block")
  cfg.providerAllow = list(o.providerAllow, "providerAllow")
  cfg.providerBlock = list(o.providerBlock, "providerBlock")
  cfg.byModel = modelRules(o.byModel)
  cfg.byProvider = providerRules(o.byProvider)
  cfg.maxLog = maxLog(o.maxLog)
  cfg.gated = cfg.block.length > 0 || cfg.allow.length > 0 ||
    cfg.providerAllow.length > 0 || cfg.providerBlock.length > 0 ||
    cfg.byModel.some((rule) => rule.allow.length > 0 || rule.block.length > 0) ||
    cfg.byProvider.some((rule) => rule.allow.length > 0 || rule.block.length > 0)
  return cfg
}

function list(v, name) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) {
    warnOnce(name, name + " is not an array, so it is ignored")
    return []
  }
  const out = []
  let bad = false
  for (const x of v) {
    if (typeof x === "string" && x.trim()) out.push(x.trim())
    else bad = true
  }
  if (bad) warnOnce(name + ".entries", "some " + name + " entries are not strings, so they are ignored")
  return out
}

function modelRules(v) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) {
    warnOnce("byModel", "byModel is not an array, so it is ignored")
    return []
  }
  const out = []
  let bad = false
  for (const e of v) {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      bad = true
      continue
    }
    const match = []
    if (typeof e.match === "string" && e.match.trim()) match.push(e.match.trim())
    else if (Array.isArray(e.match)) {
      for (const m of e.match) if (typeof m === "string" && m.trim()) match.push(m.trim())
    }
    if (!match.length) {
      bad = true
      continue
    }
    out.push({
      match,
      allow: list(e.allow, "byModel.allow"),
      block: list(e.block, "byModel.block"),
      index: out.length,
    })
  }
  if (bad) warnOnce("byModel.entries", "a byModel entry has no match, or is not an object, so it is ignored")
  return out
}

function providerRules(v) {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) {
    warnOnce("byProvider", "byProvider is not an array, so it is ignored")
    return []
  }
  const out = []
  let bad = false
  for (const e of v) {
    if (!e || typeof e !== "object" || Array.isArray(e)) {
      bad = true
      continue
    }
    const match = []
    if (typeof e.match === "string" && e.match.trim()) match.push(e.match.trim())
    else if (Array.isArray(e.match)) {
      for (const m of e.match) if (typeof m === "string" && m.trim()) match.push(m.trim())
    }
    if (!match.length) {
      bad = true
      continue
    }
    out.push({
      match,
      allow: list(e.allow, "byProvider.allow"),
      block: list(e.block, "byProvider.block"),
      index: out.length,
    })
  }
  if (bad) warnOnce("byProvider.entries", "a byProvider entry has no match, or is not an object, so it is ignored")
  return out
}

function maxLog(v) {
  if (v === undefined || v === null) return DEFAULT_MAX_LOG
  if (typeof v !== "number" || !isFinite(v) || v < 1) {
    warnOnce("maxLog", "maxLog is not a number of 1 or more, so " + DEFAULT_MAX_LOG + " is used")
    return DEFAULT_MAX_LOG
  }
  return Math.min(Math.floor(v), MAX_MAX_LOG)
}
