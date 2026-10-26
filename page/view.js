// The page's copy of the middleware's rules, so the preview answers what
// guard.gateway.js will do: block first, then the first byModel entry whose
// match hits the model, then the top-level allow list. An empty list never
// turns a request away. Keep this in step with guard.gateway.js — the tests
// check the same names and the same order.
const AGENTS = {
  "claude-code": "claude",
  "claude-cli": "claude",
  "claude-desktop": "claude",
  "codex-cli": "codex",
  "codex-cli-rs": "codex",
  "cursor-local": "cursor",
}

// KNOWN is what the suggestions offer: the names people mean, with the name
// magpie actually sends in brackets where the two differ.
const KNOWN = [
  { name: "claude-code", note: "magpie: claude" },
  { name: "codex", note: "magpie: codex" },
  { name: "cursor", note: "magpie: cursor-local" },
  { name: "cline", note: "" },
  { name: "opencode", note: "" },
  { name: "other", note: "" },
]

// SAMPLE is what the page shows when it is opened outside magpie — a file
// preview, or a look at the layout — where there is no options to read.
const SAMPLE = {
  allow: ["claude-code", "codex"],
  block: ["cursor", "other"],
  providerAllow: ["relay-a", "relay-b"],
  providerBlock: ["relay-c"],
  byModel: [{ match: ["claude-*", "gpt-5*"], allow: ["claude-code", "codex"] }],
  byProvider: [{ match: ["relay-a"], allow: ["claude-code"], block: ["other"] }],
  maxLog: 6,
}

const SAMPLE_PROVIDERS = [
  { id: "relay-a", name: "Relay A" },
  { id: "relay-b", name: "Relay B" },
  { id: "relay-c", name: "" },
]

const TEXT = {
  en: {
    title: "Client guard",
    subtitle: "Who may use this gateway, and which models they may ask for.",
    statAllow: "allowed",
    statBlock: "blocked",
    statModels: "model rules",
    statProviders: "provider rules",
    allowTitle: "Allowed clients",
    allowHint: "Only these clients get through. Leave the list empty to let anyone in.",
    blockTitle: "Blocked clients",
    blockHint: "Turned away whatever the allow lists say. Asked first.",
    byModelTitle: "Per-model rules",
    byModelHint: "The first rule whose model glob hits applies: its block list turns clients away, and its allow list decides the rest — empty means anyone. Order matters.",
    byProviderTitle: "Per-provider rules",
    byProviderHint: "For requests whose model names a provider or group: relay-a/claude-sonnet-4-5. The first entry that hits applies: its block list turns clients away, and its allow list stands in for Allowed clients — left empty, that list still applies. A client asking group/translate matches \"translate\", \"group\" (every group), or the whole \"group/translate\"; a provider id only hits when the client asks for zifeiyu/… directly.",
    provider: "Provider or group",
    providerPlaceholder: "provider id or group, e.g. zifeiyu",
    providerAllowEmpty: "empty: the Allowed clients list still applies",
    blockField: "Blocked",
    providersFrom: "{n} providers in this magpie",
    providersNone: "no provider ids read — typing one works too",
    pickProvider: "Choose a provider",
    searchProvider: "Search providers",
    noProviderMatch: "No match — type an id below",
    clientsNote: "The page reads no requests, so it cannot list who is calling. magpie's Requests page and the guard lines in magpie's log show each request's client.",
    providerListsTitle: "Providers",
    providerListsHint: "Only requests whose model names one of these providers — relay-a/claude-sonnet-4-5 — get through. A model named without a provider is turned away while the allowed list is not empty. This is the name the agent asked for, not the provider routing lands on.",
    providerAllowLabel: "Allowed providers",
    providerBlockLabel: "Blocked providers",
    jsonTitle: "Options as JSON",
    save: "Save",
    add: "Add",
    addRule: "Add rule",
    models: "Models",
    allowField: "Allowed",
    up: "Move up",
    down: "Move down",
    remove: "Remove",
    rule: "Rule",
    saved: "Saved",
    unsaved: "Unsaved changes",
    saving: "Saving…",
    failed: "Could not save",
    ruleN: "rule",
    duplicate: "already listed",
    noMatch: "needs at least one model glob",
    emptyInput: "type a name first",
    agentPlaceholder: "client, e.g. claude-code",
    loadFail: "Could not read the options",
    none: "none",
    blockWins: "is both allowed and blocked; blocked wins.",
    back: "the page can only change this plugin's options",
    pageNote: "Saving writes this plugin's options. It applies from the next request.",
    previewOnly: "Preview — not connected to magpie",
    previewNote: "This is an example, opened outside magpie. In magpie's window the same page edits this plugin's options.",
    example: "example",
  },
  zh: {
    title: "客户端白名单",
    subtitle: "谁可以用这个网关，以及能用哪些模型。",
    statAllow: "允许",
    statBlock: "拒绝",
    statModels: "模型规则",
    statProviders: "供应商规则",
    allowTitle: "允许的客户端",
    allowHint: "只有列表里的客户端能进。留空表示不限。",
    blockTitle: "拒绝的客户端",
    blockHint: "无论白名单怎么写都会被拒，最优先。",
    byModelTitle: "按模型区分",
    byModelHint: "从上往下，第一条模型 glob 命中的规则生效：先按它的拒绝名单拦，再按允许名单放行；允许名单留空表示不限。顺序有意义。",
    byProviderTitle: "按供应商区分",
    byProviderHint: "针对模型里写了供应商或分组的请求：relay-a/claude-sonnet-4-5。从上往下第一条命中的生效：先按它的拒绝名单拦，再按允许名单；这里的允许名单会代替上面的「允许的客户端」，留空则沿用上面那份。客户端请求 group/translate 时，这里可以填 translate（只这个分组）、group（所有分组），或整串 group/translate；填供应商 id 只有在客户端按 zifeiyu/模型 直连时才会命中。",
    provider: "供应商 / 分组",
    providerPlaceholder: "供应商 id 或分组名，如 zifeiyu",
    providerAllowEmpty: "留空：仍沿用「允许的客户端」",
    blockField: "拒绝",
    providersFrom: "本机 magpie 的 {n} 个供应商",
    providersNone: "没读到供应商 id，也可以直接输入",
    pickProvider: "选择供应商",
    searchProvider: "搜索供应商",
    noProviderMatch: "没有匹配，可在下方直接输入",
    clientsNote: "页面读不到请求，所以列不出真实在打的客户端；每条请求的客户端看 magpie 的 Requests 页和日志里的 guard: 行。",
    providerListsTitle: "供应商",
    providerListsHint: "只有模型里写了这些供应商之一的请求（relay-a/claude-sonnet-4-5）才放行。允许名单非空时，没有写供应商前缀的模型也会被拒。匹配的是 agent 请求里写的名字，不是路由最终落到的 provider。",
    providerAllowLabel: "允许的供应商",
    providerBlockLabel: "拒绝的供应商",
    jsonTitle: "当前 options（JSON）",
    save: "保存",
    add: "添加",
    addRule: "添加规则",
    models: "模型",
    allowField: "允许",
    up: "上移",
    down: "下移",
    remove: "删除",
    rule: "规则",
    saved: "已保存",
    unsaved: "有未保存的修改",
    saving: "保存中…",
    failed: "保存失败",
    ruleN: "规则",
    duplicate: "已经在列表里",
    noMatch: "至少要有一个模型 glob",
    emptyInput: "先输入一个名字",
    agentPlaceholder: "客户端，如 claude-code",
    loadFail: "读取 options 失败",
    none: "无",
    blockWins: "同时在允许和拒绝列表里，以拒绝为准。",
    back: "这个页面只能改本插件的 options",
    pageNote: "保存会写入本插件的 options，从下一个请求开始生效。",
    previewOnly: "预览 — 未连接 magpie",
    previewNote: "这是页面在 magpie 之外打开时的示例。在 magpie 窗口里，同一页面改的是本插件的 options。",
    example: "示例",
  },
}

function text(lang) {
  const l = String(lang || "en").toLowerCase()
  return l.startsWith("zh") ? TEXT.zh : TEXT.en
}

// agentName is the name rules are matched by: lower-cased, spaces and
// underscores as hyphens, a version tail dropped, usual spellings mapped to
// magpie's own.
function agentName(v) {
  if (typeof v !== "string") return ""
  let s = v.trim().toLowerCase()
  if (!s) return ""
  const cut = s.search(/[\s/()]/)
  if (cut > 0) s = s.slice(0, cut)
  s = s.replace(/_/g, "-").replace(/-+/g, "-")
  return AGENTS[s] || s
}

const cache = {}
function glob(rule, value) {
  if (typeof rule !== "string" || !rule) return false
  const key = rule.toLowerCase()
  let re = cache[key]
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
    cache[key] = re
  }
  return re.test(String(value).toLowerCase())
}

function modelRule(rules, model) {
  if (!model) return null
  const tail = model.slice(model.lastIndexOf("/") + 1)
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    for (const g of rule.match) {
      if (glob(g, model) || (tail && tail !== model && glob(g, tail))) return { rule, index: i }
    }
  }
  return null
}

// providerNames is what a provider rule may be written against: the model's
// first /-separated part — or, for group/<id>, "group", the group's id, and
// the whole "group/<id>".
function providerNames(model) {
  const cut = String(model || "").indexOf("/")
  if (cut <= 0) return []
  const head = model.slice(0, cut)
  const rest = model.slice(cut + 1)
  if (head === "group" && rest) return ["group", rest, "group/" + rest]
  return [head]
}

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

// decide answers what would happen, with the rule that decides it: null
// when the request goes through, else { kind, index?, rule? }.
function decide(options, agent, model) {
  const s = settings(options)
  const a = agentName(agent)
  for (const rule of s.block) {
    if (glob(agentName(rule), a)) return { kind: "block", rule }
  }
  const names = providerNames(model)
  for (const rule of s.providerBlock) {
    if (names.some((name) => glob(rule, name))) return { kind: "providerListBlock", rule }
  }
  if (s.providerAllow.length && !names.some((name) => someGlob(s.providerAllow, name))) {
    return { kind: "providerListAllow", head: names.length ? names[names.length - 1] : "" }
  }
  const prov = providerRule(s.byProvider, names)
  const own = modelRule(s.byModel, model)
  if (own) {
    for (const rule of own.rule.block) {
      if (glob(agentName(rule), a)) return { kind: "modelBlock", rule, entry: own.rule, index: own.index }
    }
  }
  if (prov) {
    for (const rule of prov.rule.block) {
      if (glob(agentName(rule), a)) return { kind: "providerBlock", rule, index: prov.index, entry: prov.rule }
    }
  }
  if (own) {
    if (own.rule.allow.length && !own.rule.allow.some((r) => glob(agentName(r), a))) {
      return { kind: "byModel", index: own.index, rule: own.rule }
    }
    return null
  }
  if (prov && prov.rule.allow.length) {
    if (!prov.rule.allow.some((r) => glob(agentName(r), a))) {
      return { kind: "provider", index: prov.index, rule: prov.rule }
    }
    return null
  }
  if (s.allow.length && !s.allow.some((r) => glob(agentName(r), a))) return { kind: "allow" }
  return null
}

// settings reads hand-written options the way the middleware does: a field
// of the wrong type is treated as one that was not set.
function settings(raw) {
  const extra = {}
  const out = {
    allow: [], block: [], providerAllow: [], providerBlock: [],
    byModel: [], byProvider: [], maxLog: 6, extra,
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const key of Object.keys(raw)) {
    if (key !== "allow" && key !== "block" && key !== "providerAllow" && key !== "providerBlock" &&
      key !== "byModel" && key !== "byProvider" && key !== "maxLog") extra[key] = raw[key]
  }
  out.allow = strings(raw.allow)
  out.block = strings(raw.block)
  out.providerAllow = strings(raw.providerAllow)
  out.providerBlock = strings(raw.providerBlock)
  if (Array.isArray(raw.byModel)) {
    for (const e of raw.byModel) {
      if (!e || typeof e !== "object" || Array.isArray(e)) continue
      const match = typeof e.match === "string" ? strings([e.match]) : strings(e.match)
      if (!match.length) continue
      out.byModel.push({ match, allow: strings(e.allow), block: strings(e.block) })
    }
  }
  out.byProvider = providerRules(raw.byProvider)
  const n = Number(raw.maxLog)
  if (isFinite(n) && n >= 1) out.maxLog = Math.min(Math.floor(n), 40)
  return out
}

function providerRules(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const e of v) {
    if (!e || typeof e !== "object" || Array.isArray(e)) continue
    const match = typeof e.match === "string" ? strings([e.match]) : strings(e.match)
    if (!match.length) continue
    out.push({ match, allow: strings(e.allow), block: strings(e.block) })
  }
  return out
}

function strings(v) {
  if (!Array.isArray(v)) return []
  const out = []
  for (const x of v) if (typeof x === "string" && x.trim()) out.push(x.trim())
  return out
}

// toOptions is what Save writes: the known lists, only when they say
// something, and any key this page does not manage left as it was.
function toOptions(s) {
  const out = { ...s.extra }
  if (s.allow.length) out.allow = s.allow.slice()
  if (s.block.length) out.block = s.block.slice()
  if (s.providerAllow.length) out.providerAllow = s.providerAllow.slice()
  if (s.providerBlock.length) out.providerBlock = s.providerBlock.slice()
  const rules = []
  for (const rule of s.byModel) {
    if (!rule.match.length) continue
    const entry = { match: rule.match.slice(), allow: rule.allow.slice() }
    if (rule.block.length) entry.block = rule.block.slice()
    rules.push(entry)
  }
  if (rules.length) out.byModel = rules
  const providers = []
  for (const rule of s.byProvider) {
    if (!rule.match.length) continue
    const entry = { match: rule.match.slice() }
    if (rule.allow.length) entry.allow = rule.allow.slice()
    if (rule.block.length) entry.block = rule.block.slice()
    providers.push(entry)
  }
  if (providers.length) out.byProvider = providers
  if (s.maxLog !== 6) out.maxLog = s.maxLog
  return out
}

// providerList reads what providers:list answers in either shape magpie has
// given it: a list of {id, name}, or an object keyed by id.
function providerList(v) {
  const out = []
  const seen = new Set()
  const add = (id, name) => {
    if (typeof id !== "string" || !id || seen.has(id)) return
    seen.add(id)
    out.push({ id, name: typeof name === "string" ? name : "" })
  }
  if (Array.isArray(v)) {
    for (const p of v) if (p && typeof p === "object") add(p.id, p.name)
  } else if (v && typeof v === "object") {
    for (const key of Object.keys(v)) {
      const p = v[key]
      add(key, p && typeof p === "object" ? p.name : "")
    }
  }
  return out
}

// addValue appends unless it is already there, compared the way the rules
// compare: agent names by agentName, globs as written, ignoring case.
function addValue(list, value, kind) {
  const v = typeof value === "string" ? value.trim() : ""
  if (!v) return { list, added: false, why: "empty" }
  const key = kind === "agent" ? agentName(v) : v.toLowerCase()
  for (const x of list) {
    const k = kind === "agent" ? agentName(x) : x.toLowerCase()
    if (k === key) return { list, added: false, why: "duplicate" }
  }
  return { list: list.concat([v]), added: true }
}

function removeAt(list, i) {
  return list.filter((_, n) => n !== i)
}

function move(list, from, to) {
  if (to < 0 || to >= list.length) return list
  const out = list.slice()
  const [x] = out.splice(from, 1)
  out.splice(to, 0, x)
  return out
}

globalThis.GuardView = {
  AGENTS, KNOWN, SAMPLE, SAMPLE_PROVIDERS, TEXT, text, agentName, glob, decide, settings, toOptions,
  providerList, providerNames, addValue, removeAt, move, strings,
}
