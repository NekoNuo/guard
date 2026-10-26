import { expect, test } from "bun:test"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const dir = import.meta.dir
const page = join(dir, "page")
const read = (f) => readFileSync(join(page, f), "utf8")
const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))

// view.js is a classic script, as the page loads it
const scope = {}
new Function("globalThis", read("view.js"))(scope)
const V = scope.GuardView

test("the package is a page and a middleware at once", () => {
  expect(pkg.magpie.middleware).toBe("./guard.gateway.js")
  expect(pkg.magpie.page).toEqual({
    title: "Client guard",
    titles: { zh: "客户端白名单", "zh-TW": "客戶端白名單" },
    file: "page/index.html",
    icon: "page/icon.svg",
  })
  expect(pkg.main).toBeUndefined()
  expect(pkg.exports).toBeUndefined()
  expect(pkg.files).toContain("page")
  for (const f of ["index.html", "app.js", "view.js", "style.css", "icon.svg"])
    expect(readdirSync(page)).toContain(f)
})

test("the page reads providers:list, and nothing else, and reaches no network", () => {
  expect(pkg.magpie.permissions).toEqual(["providers:list"])
  const reads = new Set()
  for (const f of readdirSync(page).filter((f) => f.endsWith(".js"))) {
    const src = read(f)
    for (const m of src.matchAll(/magpie\.read\(\s*"([^"]+)"/g)) reads.add(m[1])
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|sendBeacon|EventSource|importScripts/)
  }
  expect([...reads]).toEqual(["providers:list"])
  const html = read("index.html")
  expect(html).toContain('<script src="_magpie/bridge.js"></script>')
  for (const m of html.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/g)) {
    expect(m[1]).toMatch(/\ssrc="/)
    expect(m[2].trim()).toBe("")
  }
  for (const m of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
    if (m[1].startsWith("_magpie/")) continue
    expect(m[1]).not.toMatch(/^(?:[a-z]+:|\/|\.\.)/i)
    expect(readdirSync(page)).toContain(m[1])
  }
})

test("the page's rules are the middleware's rules", () => {
  const o = { allow: ["claude-code", "codex"], block: ["cursor", "other"], byModel: [{ match: ["claude-*", "gpt-5*"], allow: ["claude-code", "codex"] }] }
  // block first, over anything
  expect(V.decide(o, "cursor", "claude-sonnet-4-5")).toMatchObject({ kind: "block", rule: "cursor" })
  // byModel: the first entry that hits, as asked or by its last /-part
  expect(V.decide(o, "mozilla", "relay/claude-sonnet-4-5")).toMatchObject({ kind: "byModel", index: 0 })
  expect(V.decide(o, "codex", "relay/gpt-5-codex")).toBeNull()
  // a model no entry hits falls back to allow
  expect(V.decide(o, "mozilla", "relay/deepseek-v4")).toMatchObject({ kind: "allow" })
  expect(V.decide(o, "claude", "relay/deepseek-v4")).toBeNull()
  // an empty list never turns a request away
  expect(V.decide({}, "mozilla", "anything")).toBeNull()
  expect(V.decide({ byModel: [{ match: ["claude-*"], allow: [] }] }, "mozilla", "claude-3")).toBeNull()
  // block still wins over a byModel entry that would let it in
  expect(V.decide({ block: ["*"], byModel: [{ match: ["*"], allow: [] }] }, "claude", "m")).toMatchObject({ kind: "block" })
})

test("a model rule has both lists, and its block is asked before a provider's allow", () => {
  const o = { byModel: [{ match: ["claude-*"], allow: ["claude-code", "codex"], block: ["codex"] }] }
  expect(V.decide(o, "codex", "relay-a/claude-sonnet")).toMatchObject({ kind: "modelBlock", rule: "codex" })
  expect(V.decide(o, "claude", "relay-a/claude-sonnet")).toBeNull()
  expect(V.decide(o, "mozilla", "relay-a/claude-sonnet")).toMatchObject({ kind: "byModel" })
  const o2 = { byProvider: [{ match: ["relay-a"], allow: ["cursor"] }], byModel: [{ match: ["claude-*"], allow: ["claude-code"], block: ["cursor"] }] }
  expect(V.decide(o2, "cursor", "relay-a/claude-sonnet")).toMatchObject({ kind: "modelBlock" })
})

test("a provider list filters by the model's provider", () => {
  expect(V.decide({ providerAllow: ["relay-a"] }, "claude", "relay-a/x")).toBeNull()
  expect(V.decide({ providerAllow: ["relay-a"] }, "claude", "relay-b/x")).toMatchObject({ kind: "providerListAllow" })
  expect(V.decide({ providerAllow: ["relay-a"] }, "claude", "claude-x")).toMatchObject({ kind: "providerListAllow" })
  expect(V.decide({ providerBlock: ["relay-c"] }, "claude", "relay-c/x")).toMatchObject({ kind: "providerListBlock", rule: "relay-c" })
  expect(V.decide({ providerBlock: ["relay-c"] }, "claude", "claude-x")).toBeNull()
  expect(V.toOptions(V.settings({ providerAllow: ["relay-a"], providerBlock: ["relay-c"] })))
    .toEqual({ providerAllow: ["relay-a"], providerBlock: ["relay-c"] })
})

test("a provider's own lists are read on the model's first /-part", () => {
  const o = { allow: ["claude-code"], byProvider: [
    { match: ["relay-a"], allow: ["claude-code", "codex"], block: ["other"] },
    { match: ["relay-*"], allow: ["cursor"] }] }
  // the first entry that hits decides
  expect(V.decide(o, "cursor", "relay-a/claude-sonnet-4-5")).toMatchObject({ kind: "provider", index: 0 })
  expect(V.decide(o, "codex", "relay-a/claude-sonnet-4-5")).toBeNull()
  // its block list comes before the allow lists
  expect(V.decide(o, "other", "relay-a/claude-sonnet-4-5")).toMatchObject({ kind: "providerBlock", rule: "other" })
  // a glob, and a model named with a group rather than a provider
  expect(V.decide({ byProvider: [{ match: ["relay-*"], allow: ["claude-code"] }] }, "codex", "relay-b/x")).toMatchObject({ kind: "provider", index: 0 })
  // a model without a / belongs to no provider entry: the global list decides
  expect(V.decide({ allow: ["claude-code"], byProvider: [{ match: ["relay-a"], allow: ["codex"] }] }, "codex", "claude-sonnet")).toMatchObject({ kind: "allow" })
  // an empty provider allow leaves the global allow list in force
  expect(V.decide({ allow: ["claude-code"], byProvider: [{ match: ["relay-a"], block: ["cursor"] }] }, "codex", "relay-a/x")).toMatchObject({ kind: "allow" })
  // a model rule is more specific than a provider one
  expect(V.decide({ byProvider: [{ match: ["relay-a"], allow: ["codex"] }], byModel: [{ match: ["claude-*"], allow: ["claude-code"] }] }, "codex", "relay-a/claude-sonnet")).toMatchObject({ kind: "byModel", index: 0 })
  // a group is matched by its own id, by "group", or by the whole group/<id>
  expect(V.decide({ byProvider: [{ match: ["translate"], block: ["bob"] }] }, "bob", "group/translate")).toMatchObject({ kind: "providerBlock", rule: "bob" })
  expect(V.decide({ byProvider: [{ match: ["group"], block: ["bob"] }] }, "bob", "group/translate")).toMatchObject({ kind: "providerBlock" })
  expect(V.decide({ byProvider: [{ match: ["group/translate"], block: ["bob"] }] }, "bob", "group/translate")).toMatchObject({ kind: "providerBlock" })
  // a member provider's id cannot reach a group request: its members are not known
  expect(V.decide({ byProvider: [{ match: ["zifeiyu"], block: ["bob"] }] }, "bob", "group/translate")).toBeNull()
})

test("names are matched the way the middleware matches them", () => {
  expect(V.agentName("Claude Code")).toBe("claude")
  expect(V.agentName("claude-code")).toBe("claude")
  expect(V.agentName("codex_cli_rs")).toBe("codex")
  expect(V.agentName("CURSOR-LOCAL")).toBe("cursor")
  expect(V.agentName("Mozilla/5.0")).toBe("mozilla")
  expect(V.agentName("")).toBe("")
  expect(V.addValue(["claude-code"], "claude", "agent")).toMatchObject({ added: false, why: "duplicate" })
  expect(V.addValue(["Claude"], "cursor", "agent").list).toEqual(["Claude", "cursor"])
  expect(V.addValue([], "  ", "agent")).toMatchObject({ added: false, why: "empty" })
  expect(V.addValue(["claude-*"], "CLAUDE-*", "glob")).toMatchObject({ added: false, why: "duplicate" })
})

test("hand-written options are read leniently, and saved clean", () => {
  const s = V.settings({ allow: "claude-code", block: ["cursor"], byModel: "nope", maxLog: 0, extra: 1 })
  expect(s.allow).toEqual([])
  expect(s.block).toEqual(["cursor"])
  expect(s.byModel).toEqual([])
  expect(s.maxLog).toBe(6)
  expect(s.extra).toEqual({ extra: 1 })
  // what Save writes: only what says something, and unknown keys kept
  expect(V.toOptions(s)).toEqual({ extra: 1, block: ["cursor"] })
  const kept = V.settings({ allow: ["claude-code"], byModel: [{ match: ["claude-*"], allow: [] }], maxLog: 3 })
  expect(V.toOptions(kept)).toEqual({ allow: ["claude-code"], byModel: [{ match: ["claude-*"], allow: [] }], maxLog: 3 })
  // a byModel entry without a match would deny nothing, and is dropped
  expect(V.toOptions(V.settings({ byModel: [{ allow: ["claude-code"] }] }))).toEqual({})
  // a provider entry keeps only the lists that say something
  expect(V.toOptions(V.settings({ byProvider: [{ match: ["relay-a"], allow: [], block: ["cursor"] }] })))
    .toEqual({ byProvider: [{ match: ["relay-a"], block: ["cursor"] }] })
  expect(V.toOptions(V.settings({ byProvider: [{ allow: ["claude-code"] }] }))).toEqual({})
  // a model entry's block list is kept, and an empty one is not written
  expect(V.toOptions(V.settings({ byModel: [{ match: ["claude-*"], allow: [], block: ["cursor"] }] })))
    .toEqual({ byModel: [{ match: ["claude-*"], allow: [], block: ["cursor"] }] })
})

test("providers:list is read in either shape", () => {
  expect(V.providerList([{ id: "relay-a", name: "Relay A" }, { id: "relay-b" }]))
    .toEqual([{ id: "relay-a", name: "Relay A" }, { id: "relay-b", name: "" }])
  expect(V.providerList({ "relay-a": { name: "Relay A" }, "relay-b": null }))
    .toEqual([{ id: "relay-a", name: "Relay A" }, { id: "relay-b", name: "" }])
  expect(V.providerList(null)).toEqual([])
})

test("rules move in order, since the first match is the one that counts", () => {
  expect(V.move(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"])
  expect(V.move(["a", "b", "c"], 2, 3)).toEqual(["a", "b", "c"])
  expect(V.removeAt(["a", "b"], 0)).toEqual(["b"])
})

test("every locale it offers words for falls back sanely, and knows its titles", () => {
  const keys = Object.keys(V.TEXT.en).sort()
  expect(Object.keys(V.TEXT.zh).sort()).toEqual(keys)
  expect(V.text("zh").title).toBe(pkg.magpie.page.titles.zh)
  expect(V.text("zh-CN")).toBe(V.TEXT.zh)
  expect(V.text("zh-TW")).toBe(V.TEXT.zh)
  expect(V.text("fr")).toBe(V.TEXT.en)
})

test("the form asks for the fields it edits", () => {
  const html = read("index.html")
  for (const id of ["allowChips", "allowInput", "blockChips", "blockInput", "providerAllowBox", "providerBlockBox", "rules", "ruleAdd", "providerRules", "providerAdd", "providersNote", "clientsNote", "save", "json", "status"])
    expect(html).toContain(`id="${id}"`)
  const app = read("app.js")
  expect(app).toContain("magpie.options.get")
  expect(app).toContain("magpie.options.set")
  expect(app).toContain("magpie.ready")
})
