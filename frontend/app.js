const socket = io({ autoConnect: false })
const $ = (id) => document.getElementById(id)
const joinForm = $("joinForm")
const sheetForm = $("sheetForm")
const settingsForm = $("settingsForm")
const messageForm = $("messageForm")
let accessMode = "player"
let masterKey = null
let credentials = null // Secrets stay in memory for reconnect, never in URLs or browser storage.
let sessions = []
let state = null
let selectedId = null
let editingRevision = null
let dirty = false
let pendingSave = false
let settingsDirty = false
let settingsRevision = null
let pane = "map"
let activeScreen = "lobby"
let lastMessageId = null
let waitingTemplate = null
let joining = false

function notice(message) { $("notice").textContent = message }
function request(event, payload = {}) {
    return new Promise((resolve, reject) => {
        if (!socket.connected) return reject(new Error("Sem conexão. Aguarde antes de tentar novamente."))
        socket.timeout(8000).emit(event, payload, (error, response) => {
            if (error) return reject(new Error("Sem confirmação do servidor. Confira o estado antes de repetir a ação."))
            if (!response.ok) return reject(new Error(response.error))
            resolve(response)
        })
    })
}
async function perform(action, errorId = null) {
    if (errorId) $(errorId).textContent = ""
    else notice("")
    try { await action() } catch (error) { if (errorId) $(errorId).textContent = error.message; else notice(error.message) }
}
const character = () => state?.characters.find((item) => item.id === selectedId)
const hasDraft = () => dirty || settingsDirty
const discardAllowed = () => !hasDraft() || window.confirm("Descartar alterações não salvas e continuar?")
const map = createTableMap($("map"), (position) => perform(() => request("moveToken", position)))

function showScreen(screen) {
    activeScreen = screen
    $("lobby").hidden = screen !== "lobby"
    $("table").hidden = screen !== "table"
    $("returnTable").hidden = !state
    $("home").classList.toggle("active", screen === "lobby")
    $("returnTable").classList.toggle("active", screen === "table")
    if (screen === "table") requestAnimationFrame(() => map.resize())
}
function setPane(next) {
    if (next === "settings" && state?.role !== "gm") return
    pane = next
    for (const name of ["map", "sheet", "settings"]) $(`${name}Pane`).hidden = name !== next
    document.querySelectorAll("[data-pane]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.pane === next)))
    if (next === "map") requestAnimationFrame(() => map.resize())
}
function setMode(mode) {
    accessMode = mode
    const player = mode === "player"
    $("playerFields").hidden = !player
    for (const key of ["sessionId", "characterId"]) joinForm.elements[key].disabled = !player
    $("playerMode").setAttribute("aria-pressed", String(player))
    $("gmMode").setAttribute("aria-pressed", String(!player))
    $("keyCaption").textContent = player ? "Código de acesso do convite" : "Chave de acesso do mestre"
    $("accessButton").textContent = player ? "Entrar na campanha →" : "Acessar minhas campanhas →"
    $("accessHelp").textContent = player ? "Seu mestre envia a campanha, o personagem e o código de acesso." : "Use a chave configurada pelo responsável pela plataforma."
    joinForm.elements.key.value = ""
}
function updateMasterEntrance() {
    $("entrance").hidden = Boolean(masterKey)
    $("masterWelcome").hidden = !masterKey
}
function makeCampaignCard(session, demonstration = false) {
    const card = document.createElement("article")
    card.className = "campaign-card"
    const art = document.createElement("div")
    art.className = `campaign-art${demonstration ? "" : " blank"}`
    art.setAttribute("aria-hidden", "true")
    const ornament = document.createElement("span")
    ornament.textContent = demonstration ? "☾" : "✧"
    art.append(ornament)
    const content = document.createElement("div")
    content.className = "campaign-content"
    const badge = document.createElement("span")
    badge.className = "eyebrow"
    badge.textContent = demonstration ? "MODELO DEMONSTRATIVO · HORROR" : session.unavailable ? "ARQUIVO INDISPONÍVEL" : "SUA CAMPANHA"
    const title = document.createElement("h3")
    title.textContent = session.title
    const description = document.createElement("p")
    description.textContent = session.description || (session.unavailable ? "Não foi possível ler esta campanha. Restaure o arquivo a partir de um backup." : "O próximo capítulo aguarda seu grupo.")
    const meta = document.createElement("div")
    meta.className = "campaign-meta"
    const system = document.createElement("span")
    system.textContent = session.system || "Sistema livre"
    const count = document.createElement("span")
    count.textContent = `${session.characterCount || 0} personagens`
    meta.append(system, count)
    const button = document.createElement("button")
    button.className = "quiet full"
    button.type = "button"
    button.textContent = demonstration ? "Criar a partir deste exemplo →" : "Continuar campanha →"
    button.disabled = Boolean(session.unavailable)
    button.onclick = () => demonstration ? openCreate("nocturne") : perform(() => joinCampaign({ sessionId: session.id, role: "gm" }))
    content.append(badge, title, description, meta, button)
    card.append(art, content)
    return card
}
function renderLobby() {
    updateMasterEntrance()
    $("campaignHeading").textContent = masterKey ? "Suas campanhas" : "Histórias para explorar"
    $("campaignCount").textContent = masterKey ? `${sessions.length} campanha(s) · um universo de possibilidades` : "Uma mesa para cada universo"
    $("campaigns").replaceChildren()
    for (const session of sessions) $("campaigns").append(makeCampaignCard(session))
    $("campaigns").append(makeCampaignCard({ title: "Nocturne", system: "Horror investigativo · d100", description: "Uma noite de Halloween. Cinco desconhecidos. Uma casa que não deveria existir.", characterCount: 5 }, true))
}
async function refreshLobby() {
    if (masterKey) sessions = (await request("listSessions")).sessions
    renderLobby()
}
function openCreate(template = "blank") {
    if (!masterKey) {
        waitingTemplate = template
        setMode("gm")
        notice("Entre como mestre para criar sua campanha a partir do exemplo.")
        joinForm.elements.key.focus()
        return
    }
    const form = $("createForm")
    form.reset()
    form.elements.template.value = template
    fillTemplate(template)
    $("createError").textContent = ""
    $("createDialog").showModal()
}
function fillTemplate(template) {
    const form = $("createForm")
    form.elements.title.value = template === "nocturne" ? "Nocturne" : ""
    form.elements.id.value = template === "nocturne" && !sessions.some((s) => s.id === "nocturne") ? "nocturne" : ""
    form.elements.system.value = template === "nocturne" ? "Horror investigativo · d100" : "Sistema livre"
    form.elements.description.value = template === "nocturne" ? "Uma noite de Halloween. Cinco desconhecidos. Uma casa que não deveria existir." : ""
}
function resetTable() {
    state = null; selectedId = null; editingRevision = null; settingsRevision = null; dirty = false; settingsDirty = false; lastMessageId = null
    $("sheetForm").reset(); $("settingsForm").reset(); $("messageForm").reset(); $("messages").replaceChildren(); $("inviteOutput").textContent = ""
}
async function joinCampaign(details) {
    if (joining) return
    if (state && !discardAllowed()) return
    joining = true
    try {
        if (state) await request("leave")
        resetTable()
        credentials = details
        activeScreen = "table"
        await request("join", details)
        setPane("map")
        showScreen("table")
        joinForm.elements.key.value = ""
    } catch (error) {
        credentials = null
        showScreen("lobby")
        throw error
    } finally { joining = false }
}
function renderSheet() {
    const current = character()
    $("noCharacter").hidden = Boolean(current)
    $("characterDetail").hidden = !current
    if (!current) { dirty = false; editingRevision = null; return }
    editingRevision = current.revision
    dirty = false
    $("conflict").hidden = true
    $("characterName").textContent = current.name
    $("inviteOutput").textContent = ""
    for (const key of ["name", "occupation", "age", "life", "maxLife", "energy", "maxEnergy", "stress", "maxStress", "bio", "inventory"]) sheetForm.elements[key].value = current[key]
    for (const key of ["life", "energy", "stress"]) {
        $(`${key}Meter`).max = current[`max${key[0].toUpperCase()}${key.slice(1)}`]
        $(`${key}Meter`).value = current[key]
    }
    for (const category of ["attributes", "skills"]) {
        sheetForm.elements[category].value = Object.entries(current[category]).map(([label, value]) => `${label}: ${value}`).join("\n")
        $(category).replaceChildren()
        for (const [label, value] of Object.entries(current[category])) {
            const row = document.createElement("div")
            row.className = "score"
            const name = document.createElement("span")
            name.textContent = label
            const button = document.createElement("button")
            button.type = "button"
            button.textContent = value
            button.setAttribute("aria-label", `Rolar ${label}, valor ${value}`)
            button.onclick = () => perform(() => request("roll", { characterId: selectedId, category, label }))
            row.append(name, button)
            $(category).append(row)
        }
    }
    $("saveStatus").textContent = `Salvo · versão ${current.revision}`
}
function renderSettings() {
    if (!state || state.role !== "gm") return
    settingsRevision = state.revision
    settingsDirty = false
    for (const key of ["title", "system", "description", "defaultDie", "rollMode"]) settingsForm.elements[key].value = state[key]
    for (const key of ["life", "energy", "stress"]) settingsForm.elements[key].value = state.statusLabels[key]
    $("settingsStatus").textContent = `Salvo · versão ${state.revision}`
}
function renderMessages() {
    const latest = state.messages.at(-1)?.id || "empty"
    if (latest === lastMessageId) return
    const log = $("messages")
    const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 60
    const initial = lastMessageId === null
    lastMessageId = latest
    log.replaceChildren()
    if (!state.messages.length) {
        const hint = document.createElement("p"); hint.className = "message-empty"; hint.textContent = "Os primeiros ecos da sua história aparecerão aqui."; log.append(hint)
    }
    for (const message of state.messages) {
        const article = document.createElement("article")
        article.className = `message ${message.type === "dice" ? "dice" : "chat"}`
        const meta = document.createElement("small")
        const target = message.to === "all" ? "Mesa" : message.to === "gm" ? "Mestre · privado" : `${state.roster.find((c) => c.id === message.to)?.name || "Personagem removido"} · privado`
        meta.textContent = `${message.author} → ${target} · ${new Date(message.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
        const body = document.createElement("p"); body.textContent = message.text
        article.append(meta, body); log.append(article)
    }
    if (nearBottom || initial) log.scrollTop = log.scrollHeight
}
function renderState(next) {
    const initial = !state
    const oldDie = state?.defaultDie
    state = next
    const selectedExists = state.characters.some((c) => c.id === selectedId)
    if (!selectedExists) { selectedId = state.characters[0]?.id || null; editingRevision = null; dirty = false }
    $("sessionLabel").textContent = `${state.system || "Sistema livre"} · ${state.id}`.toUpperCase()
    $("campaignTitle").textContent = state.title
    $("campaignDescription").textContent = state.description
    $("roleBadge").textContent = state.role === "gm" ? "MESTRE" : "JOGADOR"
    $("invitation").hidden = state.role !== "gm"
    $("settingsTab").hidden = state.role !== "gm"
    $("addCharacter").hidden = state.role !== "gm"
    $("playerCount").textContent = state.roster.filter((c) => c.online).length
    $("rosterHelp").textContent = state.role === "gm" ? "Selecione um personagem para editar sua ficha ou controlar seu token." : "Você controla sua ficha e seu token. Os pontos acesos indicam quem está conectado."
    $("mapHelp").textContent = selectedId ? `Token selecionado: ${character().name}. Clique no mapa ou use as setas para mover.` : "Crie um personagem para colocar o primeiro token no mapa."
    $("characters").replaceChildren()
    for (const member of state.roster) {
        const button = document.createElement("button"); button.type = "button"
        button.setAttribute("aria-current", String(member.id === selectedId))
        const dot = document.createElement("span"); dot.className = `presence${member.online ? " online" : ""}`; dot.setAttribute("aria-hidden", "true")
        const label = document.createElement("span"); label.textContent = member.name
        const info = document.createElement("small")
        const sheet = state.characters.find((c) => c.id === member.id)
        info.textContent = sheet ? `${state.statusLabels.life} ${sheet.life}/${sheet.maxLife}${member.online ? " · online" : ""}` : member.online ? "Online" : "Ausente"
        button.append(dot, label, info)
        if (sheet) button.onclick = () => {
            if (dirty && !window.confirm("Descartar alterações não salvas desta ficha?")) return
            selectedId = member.id; renderSheet(); renderState(state); setPane("sheet")
        }
        else { button.disabled = true; button.title = "A ficha deste personagem é privada." }
        $("characters").append(button)
    }
    const recipient = messageForm.elements.to.value
    $("recipient").replaceChildren()
    const recipients = state.role === "gm" ? [["all", "Toda a mesa"], ...state.roster.map((c) => [c.id, `${c.name} (privado)`])] : [["gm", "Mestre (privado)"], ["all", "Toda a mesa"]]
    for (const [value, label] of recipients) $("recipient").add(new Option(label, value))
    if (recipients.some(([value]) => value === recipient)) messageForm.elements.to.value = recipient
    for (const key of ["life", "energy", "stress"]) {
        $(`${key}Label`).textContent = state.statusLabels[key].toUpperCase()
        sheetForm.elements[key].setAttribute("aria-label", `${state.statusLabels[key]} atual`)
        sheetForm.elements[`max${key[0].toUpperCase()}${key.slice(1)}`].setAttribute("aria-label", `${state.statusLabels[key]} máximo`)
    }
    $("roll").textContent = `Rolar d${state.defaultDie}`
    if (initial || oldDie !== state.defaultDie) $("diceForm").elements.expression.value = `1d${state.defaultDie}`
    renderMessages()
    if (!character() || editingRevision === null || (!dirty && character().revision !== editingRevision)) renderSheet()
    else if (character().revision !== editingRevision) $("conflict").hidden = false
    if (settingsRevision === null || (!settingsDirty && state.revision !== settingsRevision)) renderSettings()
    else if (state.revision !== settingsRevision) $("settingsStatus").textContent = "A campanha mudou. Recarregue as configurações antes de salvar. Seu rascunho foi preservado."
    map.update(state, selectedId)
    if (activeScreen === "table") showScreen("table")
    else $("returnTable").hidden = false
}

socket.on("state", renderState)
socket.on("connect", () => {
    $("connection").textContent = "Conectado"; $("connectionDot").classList.add("online")
    perform(async () => {
        if (masterKey) { sessions = (await request("login", { key: masterKey })).sessions; renderLobby() }
        if (credentials) await request("join", credentials)
    })
})
socket.on("disconnect", (reason) => {
    $("connection").textContent = "Desconectado"; $("connectionDot").classList.remove("online")
    if (reason === "io server disconnect") {
        credentials = null; masterKey = null; sessions = []; resetTable(); showScreen("lobby"); renderLobby()
        notice("Seu acesso foi revogado. Peça um novo convite ao mestre e entre novamente.")
    } else notice("Conexão interrompida. Reconectando; confira as ações não confirmadas antes de repeti-las.")
})
socket.on("connect_error", () => { $("connection").textContent = "Servidor indisponível" })
$("playerMode").onclick = () => setMode("player")
$("gmMode").onclick = () => setMode("gm")
joinForm.onsubmit = (event) => {
    event.preventDefault()
    perform(async () => {
        if (!socket.connected) { socket.connect(); throw new Error("Reconectando. Aguarde a conexão e tente novamente.") }
        const values = Object.fromEntries(new FormData(joinForm))
        if (accessMode === "gm") {
            sessions = (await request("login", { key: values.key })).sessions
            masterKey = values.key
            joinForm.elements.key.value = ""
            renderLobby()
            if (waitingTemplate) { const template = waitingTemplate; waitingTemplate = null; openCreate(template) }
        } else await joinCampaign({ ...values, role: "player" })
    })
}
$("newCampaign").onclick = () => openCreate()
$("createForm").elements.template.onchange = (event) => fillTemplate(event.target.value)
$("createForm").onsubmit = (event) => {
    event.preventDefault()
    perform(async () => {
        const result = await request("createSession", Object.fromEntries(new FormData(event.target)))
        sessions = result.sessions; $("createDialog").close(); renderLobby()
        await joinCampaign({ sessionId: result.id, role: "gm" })
    }, "createError")
}
$("addCharacter").onclick = () => { $("characterForm").reset(); $("characterError").textContent = ""; $("characterDialog").showModal() }
$("characterForm").onsubmit = (event) => {
    event.preventDefault()
    perform(async () => {
        if (!discardAllowed()) return
        const result = await request("createCharacter", { name: event.target.elements.name.value })
        selectedId = result.characterId; renderSheet(); renderState(state); setPane("sheet"); $("characterDialog").close()
    }, "characterError")
}
document.querySelectorAll("[data-close]").forEach((button) => { button.onclick = () => $(button.dataset.close).close() })
document.querySelectorAll("[data-pane]").forEach((button) => { button.onclick = () => setPane(button.dataset.pane) })
$("home").onclick = () => perform(async () => { showScreen("lobby"); await refreshLobby() })
$("returnTable").onclick = () => { if (state) showScreen("table") }
$("leave").onclick = () => perform(async () => {
    if (!discardAllowed()) return
    await request("leave"); credentials = null; resetTable(); showScreen("lobby"); await refreshLobby()
})
$("logout").onclick = () => {
    if (!discardAllowed()) return
    masterKey = null; credentials = null; sessions = []; resetTable(); socket.disconnect(); socket.connect(); renderLobby(); showScreen("lobby")
}
sheetForm.oninput = () => { dirty = true; $("saveStatus").textContent = "Alterações não salvas" }
function parseScores(value) {
    const entries = value.split("\n").filter((line) => line.trim()).map((line) => {
        const match = /^(.+):\s*(-?\d{1,4})\s*$/.exec(line)
        if (!match || Number(match[2]) < -999 || Number(match[2]) > 9999) throw new Error("Use Nome: valor, entre −999 e 9999, em cada linha de atributos e perícias.")
        return [match[1].trim(), Number(match[2])]
    })
    if (new Set(entries.map(([label]) => label)).size !== entries.length) throw new Error("Há nomes repetidos nos atributos ou perícias.")
    return Object.fromEntries(entries)
}
sheetForm.onsubmit = (event) => {
    event.preventDefault()
    perform(async () => {
        const patch = Object.fromEntries(new FormData(sheetForm))
        for (const key of ["age", "life", "maxLife", "energy", "maxEnergy", "stress", "maxStress"]) patch[key] = Number(patch[key])
        for (const key of ["attributes", "skills"]) patch[key] = parseScores(patch[key])
        if (pendingSave) return
        pendingSave = true
        const savedId = selectedId
        const snapshot = JSON.stringify(Object.fromEntries(new FormData(sheetForm)))
        try {
            await request("updateCharacter", { characterId: selectedId, revision: editingRevision, patch })
            if (selectedId === savedId && JSON.stringify(Object.fromEntries(new FormData(sheetForm))) === snapshot) renderSheet()
        } finally { pendingSave = false }
    })
}
settingsForm.oninput = () => { settingsDirty = true; $("settingsStatus").textContent = "Alterações não salvas" }
$("reloadSettings").onclick = () => { if (!settingsDirty || window.confirm("Descartar o rascunho das configurações?")) renderSettings() }
settingsForm.onsubmit = (event) => {
    event.preventDefault()
    perform(async () => {
        const values = Object.fromEntries(new FormData(settingsForm))
        const snapshot = JSON.stringify(values)
        await request("updateSession", { revision: settingsRevision, title: values.title, system: values.system, description: values.description,
            defaultDie: Number(values.defaultDie), rollMode: values.rollMode, statusLabels: { life: values.life, energy: values.energy, stress: values.stress } })
        if (snapshot === JSON.stringify(Object.fromEntries(new FormData(settingsForm)))) renderSettings()
    })
}
$("reloadSheet").onclick = () => { if (window.confirm("Descartar o rascunho e carregar a ficha do servidor?")) renderSheet() }
$("roll").onclick = () => perform(() => request("roll", { characterId: selectedId }))
$("diceForm").onsubmit = (event) => { event.preventDefault(); perform(() => request("roll", { characterId: selectedId, expression: event.target.elements.expression.value })) }
document.querySelectorAll("[data-dice]").forEach((button) => { button.onclick = () => { $("diceForm").elements.expression.value = button.dataset.dice } })
messageForm.onsubmit = (event) => {
    event.preventDefault()
    perform(async () => {
        const body = messageForm.elements.text.value
        await request("message", { to: messageForm.elements.to.value, text: body })
        if (messageForm.elements.text.value === body) messageForm.elements.text.value = ""
    })
}
$("invite").onclick = () => perform(async () => {
    if (!window.confirm("Gerar um novo código para este personagem? O código anterior será revogado.")) return
    const id = selectedId
    const result = await request("invite", { characterId: id })
    if (selectedId === id) $("inviteOutput").textContent = `Campanha: ${state.id}\nPersonagem: ${character().name}\nIdentificador: ${id}\nCódigo: ${result.key}\nEndereço: ${location.origin}/`
})
$("removeCharacter").onclick = () => perform(async () => {
    if (!discardAllowed() || !window.confirm("Remover este personagem, revogar seu acesso e apagar seu token? As mensagens serão preservadas.")) return
    await request("removeCharacter", { characterId: selectedId })
})
window.addEventListener("beforeunload", (event) => { if (hasDraft()) { event.preventDefault(); event.returnValue = "" } })
const linkedCampaign = new URLSearchParams(location.search).get("mesa")
if (linkedCampaign && /^[a-z0-9_-]{2,32}$/.test(linkedCampaign)) joinForm.elements.sessionId.value = linkedCampaign
renderLobby()
socket.connect()
