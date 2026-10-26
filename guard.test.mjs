import * as mod from "./guard.gateway.js"
import { check } from "../../scripts/middleware.mjs"
import { expect, test } from "bun:test"

check(import.meta.dir, mod)

test("answers onRequest, onProvider and onUsage, and nothing else", () => {
  expect(Object.keys(mod).sort()).toEqual(["onProvider", "onRequest", "onUsage"])
})

test("leaves a request it lets through exactly as it came, returning undefined", () => {
  let rejected
  const ctx = { protocol: "anthropic", model: "relay/claude-sonnet-4-5", stream: true, path: "/v1/messages", options: { allow: ["claude-code"] }, state: {}, agent: "claude", reject: (status, message) => { rejected = { status, message } } }
  const body = { model: "relay/claude-sonnet-4-5", stream: true, messages: [{ role: "user", content: "hi" }] }
  expect(mod.onRequest(body, ctx)).toBeUndefined()
  expect(rejected).toBeUndefined()
  expect(body).toEqual({ model: "relay/claude-sonnet-4-5", stream: true, messages: [{ role: "user", content: "hi" }] })
})

test("turns away with 403, and the message names the agent, the rule and where to change it", () => {
  let seen
  const ctx = { protocol: "chat", model: "relay/gpt-5-codex", path: "/v1/chat/completions", options: { byModel: [{ match: ["claude-*", "gpt-5*"], allow: ["claude-code"] }] }, state: {}, agent: "mozilla", reject: (status, message) => { seen = { status, message } } }
  mod.onRequest({ model: "relay/gpt-5-codex" }, ctx)
  expect(seen.status).toBe(403)
  expect(seen.message).toContain('agent "mozilla"')
  expect(seen.message).toContain("byModel[0]")
  expect(seen.message).toContain("gpt-5*")
  expect(seen.message).toContain("Plugins › guard.gateway.js › Options")
})

test("onUsage counts agent × provider and prints a summary of at most maxLog lines", () => {
  const lines = []
  const log = console.log
  console.log = (...parts) => lines.push(parts.join(" "))
  try {
    const options = { maxLog: 2 }
    const row = (agent, provider, status) => ({ time: Date.now(), agent, provider, model: "m1", status, rejected: false })
    mod.onUsage(row("claude", "relay", 200), options)
    mod.onUsage(row("mozilla", "relay", 403), options)
    mod.onUsage(row("codex", "relay-2", 200), options)
  } finally {
    console.log = log
  }
  expect(lines.length).toBeLessThanOrEqual(3) // header + maxLog entries
  expect(lines.join("\n")).not.toContain("messages")
})
