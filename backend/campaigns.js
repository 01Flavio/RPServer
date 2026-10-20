const fs = require("node:fs")
const path = require("node:path")
const { randomBytes, randomUUID, createHash, timingSafeEqual } = require("node:crypto")

const CHARACTER_IDS = ["alex", "bia", "caio", "dani", "rafa"]
const digest = (value) => createHash("sha256").update(value).digest()
const validId = (value) => typeof value === "string" && /^[a-z0-9_-]{2,32}$/.test(value)
const fail = (message) => { throw new Error(message) }
const text = (value, max) => typeof value === "string" && value.trim().length <= max ? value.trim() : fail("Texto inválido.")
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max ? value : fail("Número fora dos limites.")

function seed(id, template = "nocturne") {
    const occupations = ["Jornalista", "Médica", "Investigador", "Bibliotecária", "Estudante"]
    return {
        version: 2, id, revision: 0, title: template === "nocturne" ? "Nocturne" : "Nova campanha",
        system: template === "nocturne" ? "Horror investigativo · d100" : "Sistema livre",
        description: template === "nocturne" ? "Uma noite de Halloween. Cinco desconhecidos. Uma casa que não deveria existir." : "Uma nova história espera pelo seu grupo.",
        defaultDie: template === "nocturne" ? 100 : 20, rollMode: template === "nocturne" ? "under" : "modifier",
        statusLabels: { life: "Vida", energy: "Energia", stress: "Estresse" },
        messages: [], invites: {}, tokens: [],
        characters: (template === "nocturne" ? CHARACTER_IDS : []).map((id, index) => ({
            id, revision: 0, name: ["Alex", "Bia", "Caio", "Dani", "Rafa"][index],
            occupation: occupations[index], age: 25 + index, bio: "Uma noite de Halloween. Algo não está certo.",
            life: 12, maxLife: 12, energy: 10, maxEnergy: 10, stress: 0, maxStress: 100,
            attributes: { Força: 50, Constituição: 60, Destreza: 50, Inteligência: 65, Poder: 55, Educação: 60 },
            skills: { Observar: 50, Escutar: 45, Investigar: 40, Furtividade: 30, Ocultismo: 20, "Primeiros socorros": 30 },
            inventory: "Lanterna\nCaderno\nUm objeto pessoal"
        }))
    }
}

// One process owns the directory. Only replace in-memory state after a successful atomic save.
function createStore(directory) {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
    const cache = new Map()
    return {
        get(id) {
            if (!validId(id)) fail("Código de sessão inválido.")
            if (!cache.has(id)) {
                const file = path.join(directory, `${id}.json`)
                try {
                    const data = JSON.parse(fs.readFileSync(file, "utf8"))
                    if (![1, 2].includes(data.version) || data.id !== id || !Array.isArray(data.characters) || !Array.isArray(data.messages) || !data.invites) fail("Formato de sessão inválido.")
                    // In-memory migration preserves all sheets, messages and invitation hashes.
                    cache.set(id, data.version === 1 ? { ...seed(id), ...data, version: 2, tokens: [] } : data)
                } catch (error) {
                    if (error.code !== "ENOENT") throw error
                    return null
                }
            }
            return cache.get(id)
        },
        list() {
            return fs.readdirSync(directory).filter((file) => file.endsWith(".json") && validId(file.slice(0, -5))).map((file) => {
                const id = file.slice(0, -5)
                try {
                    const session = this.get(id)
                    return { id, title: session.title, system: session.system, description: session.description, characterCount: session.characters.length }
                } catch {
                    return { id, title: id, unavailable: true }
                }
            }).sort((a, b) => a.title.localeCompare(b.title))
        },
        save(session) {
            if (!validId(session.id)) fail("Código de sessão inválido.")
            const destination = path.join(directory, `${session.id}.json`)
            const temporary = `${destination}.${randomUUID()}.tmp`
            try {
                fs.writeFileSync(temporary, JSON.stringify(session, null, 2), { mode: 0o600, flag: "wx" })
                fs.renameSync(temporary, destination)
                cache.set(session.id, session)
            } finally {
                if (fs.existsSync(temporary)) fs.unlinkSync(temporary)
            }
        }
    }
}

function visibleMessage(message, user) {
    return user.role === "gm" || message.to === "all" || message.to === user.characterId || message.from === user.characterId
}

function view(session, user, online = []) {
    return {
        id: session.id, role: user.role, characterId: user.characterId,
        title: session.title, system: session.system, description: session.description, revision: session.revision,
        defaultDie: session.defaultDie, rollMode: session.rollMode, statusLabels: session.statusLabels,
        tokens: session.tokens,
        roster: session.characters.map((c, index) => ({ id: c.id, name: c.name, color: COLORS[index % COLORS.length], online: online.includes(c.id) })),
        characters: session.characters.filter((character) => user.role === "gm" || character.id === user.characterId),
        messages: session.messages.filter((message) => visibleMessage(message, user))
    }
}

function patchCharacter(character, patch) {
    if (!patch || typeof patch !== "object" || Array.isArray(patch)) fail("Ficha inválida.")
    const next = { ...character }
    for (const [key, value] of Object.entries(patch)) {
        if (["name", "occupation", "bio", "inventory"].includes(key)) {
            next[key] = text(value, key === "inventory" || key === "bio" ? 4000 : 80)
            if (key === "name" && !next[key]) fail("Informe o nome.")
        } else if (key === "age") next.age = integer(value, 1, 150)
        else if (["life", "energy", "stress", "maxLife", "maxEnergy", "maxStress"].includes(key)) next[key] = integer(value, key.startsWith("max") ? 1 : 0, 999)
        else if (["attributes", "skills"].includes(key)) {
            if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).length > 30) fail("Lista de valores inválida.")
            next[key] = Object.fromEntries(Object.entries(value).map(([label, score]) => {
                const name = text(label, 40)
                if (!name || ["__proto__", "constructor", "prototype"].includes(name)) fail("Nome de atributo inválido.")
                return [name, integer(score, -999, 9999)]
            }))
        } else fail("Campo de ficha não permitido.")
    }
    for (const [current, maximum] of [["life", "maxLife"], ["energy", "maxEnergy"], ["stress", "maxStress"]]) {
        if (next[current] > next[maximum]) fail("O status não pode ultrapassar o máximo.")
    }
    next.revision++
    return next
}

const COLORS = ["#c6a96b", "#8fc5a0", "#8cb6e8", "#d993b4", "#c3a1e8", "#e58c78"]
const { rollDice } = require("./dice")

function attachCampaigns(io, options = {}) {
    const secret = options.gmKey ?? process.env.RPSERVER_GM_KEY ?? process.env.NOCTURNE_GM_KEY
    // Keep the previous default directory so existing sessions remain discoverable.
    const store = options.store || createStore(options.dataDir || process.env.RPSERVER_DATA_DIR || process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data/nocturne"))
    const namespace = io.of("/")
    function online(id) {
        return Array.from(namespace.sockets.values()).filter((s) => s.data.user?.sessionId === id).map((s) => s.data.user.characterId)
    }
    function publish(id) {
        const session = store.get(id)
        for (const socket of namespace.sockets.values()) {
            if (socket.data.user?.sessionId === id) socket.emit("state", view(session, socket.data.user, online(id)))
        }
    }
    namespace.on("connection", (socket) => {
        let budget = 0
        let windowStart = Date.now()
        let authAttempts = 0
        function handler(event, action) {
            socket.on(event, (payload, ack) => {
                if (typeof ack !== "function") return
                if (Date.now() - windowStart > 10000) { budget = 0; windowStart = Date.now() }
                if (++budget > 40) return ack({ ok: false, error: "Muitas ações. Aguarde alguns segundos." })
                try { ack({ ok: true, ...action(payload) }) }
                catch (error) {
                    // Filesystem details stay on the server; never disclose credentials or file contents.
                    const message = error.code || error instanceof SyntaxError ? "Falha ao carregar ou salvar a sessão. Consulte o servidor." : error.message
                    if (error.code || error instanceof SyntaxError) console.error("Campaign storage error:", error.code || error.name)
                    ack({ ok: false, error: message })
                }
            })
        }
        function authenticate(key) {
            if (++authAttempts > 10) fail("Limite de tentativas. Reconecte para tentar novamente.")
            if (typeof key !== "string" || key.length > 256 || !secret || secret.length < 24 || !timingSafeEqual(digest(key), digest(secret))) fail("Credenciais inválidas ou mestre não configurado.")
            socket.data.manager = true
        }
        function master() {
            if (!socket.data.manager) fail("Acesso exclusivo do mestre.")
        }
        handler("login", (details) => {
            authenticate(details?.key)
            return { sessions: store.list() }
        })
        handler("listSessions", () => { master(); return { sessions: store.list() } })
        handler("createSession", (details) => {
            master()
            if (!validId(details?.id)) fail("Use 2 a 32 letras minúsculas, números, _ ou - no código.")
            if (store.get(details.id)) fail("Já existe uma campanha com esse código.")
            if (!["blank", "nocturne"].includes(details.template)) fail("Modelo inválido.")
            const session = seed(details.id, details.template)
            session.title = text(details.title, 80)
            if (!session.title) fail("Informe o título da campanha.")
            session.system = text(details.system, 80)
            session.description = text(details.description || "", 2000)
            store.save(session)
            return { sessions: store.list(), id: session.id }
        })
        handler("leave", () => {
            const id = socket.data.user?.sessionId
            delete socket.data.user
            if (id) publish(id)
            return {}
        })
        handler("join", (details) => {
            if (socket.data.user) fail("Você já entrou nesta sessão.")
            if (!validId(details?.sessionId)) fail("Credenciais inválidas.")
            const gm = details.role === "gm"
            if (gm && !socket.data.manager) authenticate(details.key)
            const session = store.get(details.sessionId)
            if (!session) fail("Credenciais inválidas.")
            if (!gm) {
                if (++authAttempts > 10) fail("Limite de tentativas. Reconecte para tentar novamente.")
                if (typeof details.key !== "string" || details.key.length > 256 || !session.characters.some((c) => c.id === details.characterId) || session.invites[details.characterId] !== digest(details.key).toString("hex")) fail("Credenciais inválidas.")
            }
            socket.data.user = { sessionId: session.id, role: gm ? "gm" : "player", characterId: gm ? null : details.characterId }
            publish(session.id)
            return {}
        })
        function authorized() {
            if (!socket.data.user) fail("Entre na sessão primeiro.")
            return { user: socket.data.user, session: store.get(socket.data.user.sessionId) }
        }
        handler("invite", (payload) => {
            const { user, session } = authorized()
            if (user.role !== "gm" || !session.characters.some((c) => c.id === payload?.characterId)) fail("Apenas o mestre pode criar convites.")
            const key = randomBytes(24).toString("base64url")
            store.save({ ...session, invites: { ...session.invites, [payload.characterId]: digest(key).toString("hex") } })
            // Rotation revokes existing connections for this character as well.
            for (const client of namespace.sockets.values()) {
                if (client.data.user?.sessionId === session.id && client.data.user.characterId === payload.characterId) client.disconnect(true)
            }
            return { key }
        })
        handler("createCharacter", (payload) => {
            const { user, session } = authorized()
            if (user.role !== "gm") fail("Apenas o mestre pode criar personagens.")
            if (session.characters.length >= 30) fail("Limite de 30 personagens por campanha.")
            const character = { ...seed("example").characters[0], id: `pc-${randomBytes(6).toString("hex")}`, name: text(payload?.name, 80),
                occupation: "", bio: "", inventory: "", attributes: {}, skills: {}, age: 25, revision: 0 }
            if (!character.name) fail("Informe o nome do personagem.")
            store.save({ ...session, characters: [...session.characters, character] })
            publish(session.id)
            return { characterId: character.id }
        })
        handler("removeCharacter", (payload) => {
            const { user, session } = authorized()
            if (user.role !== "gm" || !session.characters.some((c) => c.id === payload?.characterId)) fail("Apenas o mestre pode remover personagens.")
            const invites = { ...session.invites }
            delete invites[payload.characterId]
            store.save({ ...session, invites, characters: session.characters.filter((c) => c.id !== payload.characterId), tokens: session.tokens.filter((token) => token.id !== payload.characterId) })
            for (const client of namespace.sockets.values()) {
                if (client.data.user?.sessionId === session.id && client.data.user.characterId === payload.characterId) client.disconnect(true)
            }
            publish(session.id)
            return {}
        })
        handler("updateSession", (payload) => {
            const { user, session } = authorized()
            if (user.role !== "gm") fail("Apenas o mestre pode configurar a campanha.")
            if (payload?.revision !== session.revision) fail("A campanha mudou. Recarregue as configurações.")
            const title = text(payload.title, 80)
            if (!title) fail("Informe o título da campanha.")
            const labels = Object.fromEntries(["life", "energy", "stress"].map((key) => {
                const label = text(payload.statusLabels?.[key], 24)
                if (!label) fail("Informe os nomes dos status.")
                return [key, label]
            }))
            if (!["under", "modifier"].includes(payload.rollMode)) fail("Regra de teste inválida.")
            store.save({ ...session, title, system: text(payload.system, 80), description: text(payload.description, 2000), statusLabels: labels,
                defaultDie: integer(payload.defaultDie, 2, 1000), rollMode: payload.rollMode, revision: session.revision + 1 })
            publish(session.id)
            return {}
        })
        handler("moveToken", (payload) => {
            const { user, session } = authorized()
            const id = user.role === "gm" ? payload?.characterId : user.characterId
            if (!session.characters.some((c) => c.id === id) || (user.role !== "gm" && payload?.characterId && payload.characterId !== user.characterId)) fail("Sem permissão para mover esse token.")
            const x = integer(payload?.x, 0, 1200)
            const y = integer(payload?.y, 0, 760)
            const token = { id, x, y }
            store.save({ ...session, tokens: [...session.tokens.filter((item) => item.id !== id), token] })
            publish(session.id)
            return {}
        })
        handler("updateCharacter", (payload) => {
            const { user, session } = authorized()
            const character = session.characters.find((item) => item.id === payload?.characterId)
            if (!character || (user.role !== "gm" && character.id !== user.characterId)) fail("Sem permissão para esta ficha.")
            if (payload.revision !== character.revision) fail("A ficha mudou. Recarregue a versão atual antes de salvar.")
            const updated = patchCharacter(character, payload.patch)
            store.save({ ...session, characters: session.characters.map((item) => item.id === updated.id ? updated : item) })
            publish(session.id)
            return {}
        })
        function append(session, message) {
            store.save({ ...session, messages: [...session.messages, { ...message, id: randomUUID(), timestamp: Date.now() }].slice(-300) })
            publish(session.id)
        }
        handler("message", (payload) => {
            const { user, session } = authorized()
            const body = text(payload?.text, 2000)
            if (!body) fail("Escreva uma mensagem.")
            const to = payload.to
            if (user.role === "gm" ? !(to === "all" || session.characters.some((c) => c.id === to)) : !["all", "gm"].includes(to)) fail("Destinatário inválido.")
            const author = user.role === "gm" ? "Mestre" : session.characters.find((c) => c.id === user.characterId).name
            append(session, { type: "chat", from: user.characterId || "gm", author, to, text: body })
            return {}
        })
        handler("roll", (payload) => {
            const { user, session } = authorized()
            const character = session.characters.find((item) => item.id === payload?.characterId)
            if ((payload?.characterId && !character) || (user.role !== "gm" && character?.id !== user.characterId)) fail("Sem permissão para rolar por este personagem.")
            const category = payload?.category
            if (category !== undefined && !["attributes", "skills"].includes(category)) fail("Categoria inválida.")
            const target = category && character ? character[category][payload.label] : null
            if (category && !Number.isInteger(target)) fail("Perícia ou atributo inválido.")
            const result = rollDice(category ? `1d${session.defaultDie}` : payload?.expression ?? `1d${session.defaultDie}`)
            const roll = result.total
            const total = roll + (target !== null && session.rollMode === "modifier" ? target : 0)
            const outcome = target === null ? "" : session.rollMode === "under" ? ` / ${target}${roll <= target ? " — sucesso" : " — falha"}` : ` ${target >= 0 ? "+" : "−"} ${Math.abs(target)} = ${total}`
            append(session, { type: "dice", from: user.characterId || "gm", author: user.role === "gm" ? (character ? `Mestre (${character.name})` : "Mestre") : character.name, to: "all", ...result, roll, target, total,
                text: `${category ? payload.label : result.expression}: [${result.rolls.join(" + ")}]${result.modifier ? ` ${result.modifier > 0 ? "+" : "−"} ${Math.abs(result.modifier)}` : ""} = ${roll}${outcome}` })
            return { ...result, roll, target, total }
        })
        socket.on("disconnect", () => {
            const id = socket.data.user?.sessionId
            delete socket.data.user
            if (id) publish(id)
        })
    })
    return { store, namespace }
}

module.exports = { attachCampaigns, createStore, seed, patchCharacter, view }
