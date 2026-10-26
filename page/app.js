// The page: edits this plugin's own options — the allow list, the block
// list, the per-model rules and the summary length — and saves them with
// magpie.options.set. No reads, no network: the rules are checked here with
// the same order the middleware uses, so "Try a request" answers before a
// save. Saving applies from the next request.
(async () => {
  const V = globalThis.GuardView
  const $ = (id) => document.getElementById(id)
  const el = (tag, cls) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    return e
  }

  // Opened inside magpie the bridge is there; opened as a file (a preview,
  // a look at the layout) it is not, and the page shows the example options
  // read-only instead of an empty form.
  const hosted = typeof globalThis.magpie !== "undefined" && !!globalThis.magpie &&
    typeof globalThis.magpie.options === "object"

  let lang = "en"
  let draft = V.settings(hosted ? {} : V.SAMPLE)
  let providers = hosted ? [] : V.providerList(V.SAMPLE_PROVIDERS)
  let savedJSON = JSON.stringify(V.toOptions(draft))
  let saving = false
  let flashTimer = null

  const t = (key) => V.text(lang)[key] || key

  // ---- words -------------------------------------------------------------

  function words() {
    document.querySelectorAll("[data-t]").forEach((e) => {
      e.textContent = t(e.dataset.t)
    })
    document.title = t("title")
    $("allowInput").placeholder = t("agentPlaceholder")
    $("blockInput").placeholder = t("agentPlaceholder")
    $("clientsNote").textContent = t("clientsNote")
    $("note").textContent = t(hosted ? "pageNote" : "previewNote")
  }

  function status(text, kind) {
    const e = $("status")
    e.textContent = text
    e.className = "status" + (kind ? " " + kind : "")
  }

  function flash(key) {
    status(t(key), "dirty")
    clearTimeout(flashTimer)
    flashTimer = setTimeout(paintStatus, 1600)
  }

  function dirty() {
    return JSON.stringify(V.toOptions(draft)) !== savedJSON
  }

  function paintStatus() {
    if (!hosted) {
      status(t("previewOnly"))
      $("save").disabled = true
      return
    }
    if (saving) status(t("saving"))
    else if (dirty()) status(t("unsaved"), "dirty")
    else status(t("saved"))
    $("save").disabled = saving || !dirty()
  }

  function touch() {
    paintStatus()
  }

  // ---- chips -------------------------------------------------------------

  function chip(value, onRemove, blocked) {
    const span = el("span", "chip" + (blocked ? " blocked" : ""))
    span.append(document.createTextNode(value))
    const b = el("button")
    b.type = "button"
    b.textContent = "×"
    b.title = t("remove")
    b.setAttribute("aria-label", t("remove") + " " + value)
    b.addEventListener("click", onRemove)
    span.append(b)
    return span
  }

  function chips(host, list, kind, onRemove) {
    host.replaceChildren(...list.map((value, i) => chip(value, () => onRemove(i), kind === "block")))
  }

  function suggest(host, taken, onPick) {
    const have = new Set(taken.map((x) => V.agentName(x)))
    const usable = V.KNOWN.filter((k) => !have.has(V.agentName(k.name)))
    host.replaceChildren(...usable.map((k) => {
      const b = el("button")
      b.type = "button"
      b.textContent = k.note ? k.name + " · " + k.note : k.name
      b.addEventListener("click", () => onPick(k.name))
      return b
    }))
    host.hidden = usable.length === 0
  }

  // ---- the two client lists ---------------------------------------------

  function addAgent(listName, inputId) {
    const input = $(inputId)
    const r = V.addValue(draft[listName], input.value, "agent")
    if (!r.added) {
      flash(r.why === "duplicate" ? "duplicate" : "emptyInput")
      return
    }
    draft[listName] = r.list
    input.value = ""
    touch()
    render()
    input.focus()
  }

  // paintList draws one client list's chips and its suggestions; the add
  // button and Enter are wired once, below, so a repaint never adds a
  // second listener.
  function paintList(listName, chipsId, suggestId) {
    chips($(chipsId), draft[listName], listName, (i) => {
      draft[listName] = V.removeAt(draft[listName], i)
      touch()
      render()
    })
    suggest($(suggestId), draft[listName], (name) => {
      const input = $(listName === "allow" ? "allowInput" : "blockInput")
      input.value = name
      addAgent(listName, listName === "allow" ? "allowInput" : "blockInput")
    })
  }

  // ---- per-model rules ---------------------------------------------------

  function ruleCard(rule, i) {
    const box = el("div", "rule")

    const head = el("div", "rule-head")
    const title = el("div", "rule-title")
    const badge = el("span", "badge")
    badge.textContent = String(i + 1)
    const name = el("span")
    name.textContent = t("ruleN")
    title.append(badge, name)
    const btns = el("div", "rule-btns")
    const up = el("button")
    up.type = "button"
    up.textContent = "↑"
    up.title = t("up")
    up.disabled = i === 0
    up.addEventListener("click", () => {
      draft.byModel = V.move(draft.byModel, i, i - 1)
      touch()
      render()
    })
    const down = el("button")
    down.type = "button"
    down.textContent = "↓"
    down.title = t("down")
    down.disabled = i === draft.byModel.length - 1
    down.addEventListener("click", () => {
      draft.byModel = V.move(draft.byModel, i, i + 1)
      touch()
      render()
    })
    const rm = el("button")
    rm.type = "button"
    rm.textContent = "×"
    rm.title = t("remove")
    rm.addEventListener("click", () => {
      draft.byModel = V.removeAt(draft.byModel, i)
      touch()
      render()
    })
    btns.append(up, down, rm)
    head.append(title, btns)
    box.append(head)

    const body = el("div", "rule-body three")
    body.append(field("byModel", "models", rule.match || [], "glob", i, "match", true))
    body.append(field("byModel", "allowField", rule.allow || [], "agent", i, "allow", false))
    body.append(field("byModel", "blockField", rule.block || [], "agent", i, "block", false))
    box.append(body)
    return box
  }

  function providerCard(rule, i) {
    const box = el("div", "rule")

    const head = el("div", "rule-head")
    const title = el("div", "rule-title")
    const badge = el("span", "badge")
    badge.textContent = String(i + 1)
    const name = el("span")
    name.textContent = t("provider")
    title.append(badge, name)
    const btns = el("div", "rule-btns")
    const up = el("button")
    up.type = "button"
    up.textContent = "↑"
    up.title = t("up")
    up.disabled = i === 0
    up.addEventListener("click", () => {
      draft.byProvider = V.move(draft.byProvider, i, i - 1)
      touch()
      render()
    })
    const down = el("button")
    down.type = "button"
    down.textContent = "↓"
    down.title = t("down")
    down.disabled = i === draft.byProvider.length - 1
    down.addEventListener("click", () => {
      draft.byProvider = V.move(draft.byProvider, i, i + 1)
      touch()
      render()
    })
    const rm = el("button")
    rm.type = "button"
    rm.textContent = "×"
    rm.title = t("remove")
    rm.addEventListener("click", () => {
      draft.byProvider = V.removeAt(draft.byProvider, i)
      touch()
      render()
    })
    btns.append(up, down, rm)
    head.append(title, btns)
    box.append(head)

    const body = el("div", "rule-body three")
    body.append(field("byProvider", "provider", rule.match || [], "glob", i, "match", true))
    const allowField = field("byProvider", "allowField", rule.allow || [], "agent", i, "allow", false)
    const note = el("p", "note-inline")
    note.textContent = t("providerAllowEmpty")
    allowField.append(note)
    body.append(allowField)
    body.append(field("byProvider", "blockField", rule.block || [], "agent", i, "block", false))
    box.append(body)
    return box
  }

  // providerPicker is a menu, not a wall of chips: the provider ids this
  // magpie has, filtered as you type, in a panel that floats over the page
  // instead of pushing it longer. An id that is not listed is typed below.
  function providerPicker(list, onPick) {
    const wrap = el("div", "picker")
    const det = el("details")
    // only one picker open at a time, where the browser knows the attribute
    det.name = "guard-provider"
    const sum = el("summary")
    sum.textContent = t("pickProvider")
    det.append(sum)

    const panel = el("div", "pick-panel")
    const search = el("input")
    search.type = "text"
    search.className = "pick-search"
    search.placeholder = t("searchProvider")
    search.autocomplete = "off"
    search.spellcheck = false
    panel.append(search)

    const have = new Set(list.map((x) => x.toLowerCase()))
    const items = providers.filter((p) => !have.has(p.id.toLowerCase()))
    const choose = (p) => onPick(p.id)
    const rows = items.map((p) => {
      const b = el("button", "pick-item")
      b.type = "button"
      const id = el("span", "pick-id")
      id.textContent = p.id
      b.append(id)
      if (p.name && p.name !== p.id) {
        const name = el("span", "pick-name")
        name.textContent = p.name
        b.append(name)
      }
      b.addEventListener("click", () => choose(p))
      return b
    })
    const menu = el("div", "pick-list")
    menu.append(...rows)
    const none = el("p", "pick-empty")
    none.textContent = t("noProviderMatch")
    none.hidden = rows.length > 0
    panel.append(menu, none)

    search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase()
      let shown = 0
      rows.forEach((b, n) => {
        const p = items[n]
        const hit = !q || p.id.toLowerCase().indexOf(q) >= 0 || p.name.toLowerCase().indexOf(q) >= 0
        b.hidden = !hit
        if (hit) shown++
      })
      none.hidden = shown > 0
    })
    search.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      const at = rows.findIndex((b) => !b.hidden)
      if (at >= 0) choose(items[at])
    })

    det.append(panel)
    wrap.append(det)
    return wrap
  }

  // providerListEditor is one top-level list of provider ids — allowed or
  // blocked — with the same picker the rule cards use.
  function providerListEditor(host, listName, labelKey, blocked) {
    host.replaceChildren()
    const label = el("label")
    label.textContent = t(labelKey)
    host.append(label)

    const box = el("div", "chips")
    box.id = listName + "Chips"
    chips(box, draft[listName], blocked ? "block" : "allow", (i) => {
      draft[listName] = V.removeAt(draft[listName], i)
      touch()
      render()
    })
    host.append(box)

    const adder = el("div", "adder")
    const input = el("input")
    input.type = "text"
    input.id = listName + "Input"
    input.placeholder = t("providerPlaceholder")
    input.autocomplete = "off"
    input.spellcheck = false
    const add = el("button")
    add.type = "button"
    add.className = "quiet"
    add.id = listName + "Add"
    add.textContent = t("add")
    const submit = () => {
      const r = V.addValue(draft[listName], input.value, "glob")
      if (!r.added) {
        flash(r.why === "duplicate" ? "duplicate" : "emptyInput")
        return
      }
      draft[listName] = r.list
      input.value = ""
      touch()
      render()
    }
    add.addEventListener("click", submit)
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      submit()
    })
    adder.append(input, add)
    host.append(adder)

    if (providers.length) {
      host.append(providerPicker(draft[listName], (id) => {
        const r = V.addValue(draft[listName], id, "glob")
        if (!r.added) return
        draft[listName] = r.list
        touch()
        render()
      }))
    }
  }

  function field(section, labelKey, list, kind, i, which, required) {
    const wrap = el("div", "fld")
    const label = el("label")
    label.textContent = t(labelKey) + (required && !list.length ? " · " + t("noMatch") : "")
    wrap.append(label)

    const box = el("div", "chips")
    chips(box, list, kind === "agent" ? "agent" : "model", (n) => {
      const rule = draft[section][i]
      rule[which] = V.removeAt(rule[which], n)
      touch()
      render()
    })
    wrap.append(box)

    const adder = el("div", "adder")
    const input = el("input")
    input.type = "text"
    input.id = section + "-" + i + "-" + which
    input.autocomplete = "off"
    input.spellcheck = false
    input.placeholder = which === "match"
      ? (section === "byProvider" ? t("providerPlaceholder") : "claude-*")
      : "claude-code"
    const add = el("button")
    add.type = "button"
    add.textContent = t("add")
    const submit = () => {
      const r = V.addValue(draft[section][i][which], input.value, kind)
      if (!r.added) {
        flash(r.why === "duplicate" ? "duplicate" : "emptyInput")
        return
      }
      draft[section][i][which] = r.list
      input.value = ""
      touch()
      render()
      const again = document.getElementById(input.id)
      if (again) again.focus()
    }
    add.addEventListener("click", submit)
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return
      e.preventDefault()
      submit()
    })
    adder.append(input, add)
    wrap.append(adder)
    // the picker sits under the field, where the eye goes after typing
    if (section === "byProvider" && which === "match" && providers.length) {
      wrap.append(providerPicker(list, (id) => {
        const r = V.addValue(draft.byProvider[i].match, id, "glob")
        if (!r.added) return
        draft.byProvider[i].match = r.list
        touch()
        render()
      }))
    }
    return wrap
  }

  function renderRules() {
    $("rules").replaceChildren(...draft.byModel.map((rule, i) => ruleCard(rule, i)))
    const empty = $("rulesEmpty")
    empty.hidden = draft.byModel.length > 0
    empty.textContent = t("none")

    $("providerRules").replaceChildren(...draft.byProvider.map((rule, i) => providerCard(rule, i)))
    const none = $("providersEmpty")
    none.hidden = draft.byProvider.length > 0
    none.textContent = t("none")
    let picked = providers.length
      ? t("providersFrom").replace("{n}", String(providers.length))
      : t("providersNone")
    if (!hosted && providers.length) picked += " · " + t("example")
    $("providersNote").textContent = picked
  }

  // ---- painting ----------------------------------------------------------

  function render() {
    words()
    paintList("allow", "allowChips", "allowSuggest")
    paintList("block", "blockChips", "blockSuggest")
    providerListEditor($("providerAllowBox"), "providerAllow", "providerAllowLabel", false)
    providerListEditor($("providerBlockBox"), "providerBlock", "providerBlockLabel", true)
    renderRules()

    const blocked = new Set(draft.block.map((x) => V.agentName(x)))
    const both = draft.allow.find((x) => blocked.has(V.agentName(x)))
    $("allowWarn").hidden = !both
    $("allowWarn").textContent = both ? both + " " + t("blockWins") : ""

    $("statAllow").textContent = String(draft.allow.length)
    $("statBlock").textContent = String(draft.block.length)
    $("statModels").textContent = String(draft.byModel.filter((rule) => rule.match.length).length)
    $("statProviders").textContent = String(draft.byProvider.filter((rule) => rule.match.length).length)

    $("json").textContent = JSON.stringify(V.toOptions(draft), null, 2)
    paintStatus()
  }

  // ---- saving ------------------------------------------------------------

  async function save() {
    if (!hosted || saving) return
    saving = true
    paintStatus()
    let failed = false
    try {
      const out = V.toOptions(draft)
      const got = await magpie.options.set(out)
      draft = V.settings(got || out)
      savedJSON = JSON.stringify(V.toOptions(draft))
      render()
    } catch (e) {
      failed = true
      status(t("failed") + ": " + e.message, "bad")
    } finally {
      saving = false
      if (!failed) paintStatus()
    }
  }

  // ---- wiring ------------------------------------------------------------

  $("allowAdd").addEventListener("click", () => addAgent("allow", "allowInput"))
  $("allowInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addAgent("allow", "allowInput")
    }
  })
  $("blockAdd").addEventListener("click", () => addAgent("block", "blockInput"))
  $("blockInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault()
      addAgent("block", "blockInput")
    }
  })
  $("ruleAdd").addEventListener("click", () => {
    draft.byModel = draft.byModel.concat([{ match: [], allow: [], block: [] }])
    touch()
    render()
  })
  $("providerAdd").addEventListener("click", () => {
    draft.byProvider = draft.byProvider.concat([{ match: [], allow: [], block: [] }])
    touch()
    render()
  })
  $("save").addEventListener("click", save)
  document.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") {
      e.preventDefault()
      if (!$("save").disabled) save()
    }
  })

  // ---- start -------------------------------------------------------------

  if (hosted) {
    try {
      const theme = await magpie.ready
      lang = theme.lang
    } catch {}
    try {
      draft = V.settings((await magpie.options.get()) || {})
      savedJSON = JSON.stringify(V.toOptions(draft))
    } catch (e) {
      $("error").hidden = false
      $("error").textContent = t("loadFail") + ": " + e.message
    }
    try {
      providers = V.providerList(await magpie.read("providers:list"))
    } catch {
      providers = []
    }
  }
  words()
  render()
  if (hosted) {
    magpie.onTheme((theme) => {
      lang = theme.lang
      render()
    })
  }
})()
