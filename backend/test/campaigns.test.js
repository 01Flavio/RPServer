const { test } = require("node:test")
const assert = require("node:assert/strict")
const http = require("node:http")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { Server } = require("socket.io")
const { io: connect } = require("socket.io-client")
const { attachCampaigns, createStore, seed } = require("../campaigns")

const gmKey = "test-only-master-secret-24-characters"
const request = (socket, event, payload) => new Promise((resolve, reject) => {
    socket.timeout(3000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response))
})
const once = (socket, event) => new Promise((resolve) => socket.once(event, resolve))

async function setup(t) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "nocturne-test-"))
    const server = http.createServer()
    const io = new Server(server)
    const attached = attachCampaigns(io, { gmKey, dataDir: directory })
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
    const clients = []
    t.after(async () => {
        clients.forEach((client) => client.disconnect())
        await new Promise((resolve) => io.close(resolve))
        fs.rmSync(directory, { recursive: true, force: true })
    })
    async function client() {
        const socket = connect(`http://127.0.0.1:${server.address().port}`, { forceNew: true })
        clients.push(socket)
        await once(socket, "connect")
        socket.on("state", (state) => { socket.state = state })
        return socket
    }
    async function gm(sessionId = "halloween") {
        const socket = await client()
        assert.equal((await request(socket, "login", { key: gmKey })).ok, true)
        if (!attached.store.get(sessionId)) assert.equal((await request(socket, "createSession", { id: sessionId, title: sessionId, system: "Horror d100", template: "nocturne" })).ok, true)
        assert.equal((await request(socket, "join", { sessionId, role: "gm", key: gmKey })).ok, true)
        return socket
    }
    async function player(master, characterId) {
        const invite = await request(master, "invite", { characterId })
        assert.equal(invite.ok, true)
        const socket = await client()
        assert.equal((await request(socket, "join", { sessionId: master.state.id, characterId, role: "player", key: invite.key })).ok, true)
        return { socket, key: invite.key }
    }
    return { directory, ...attached, client, gm, player }
}

test("five editable examples are persisted, isolated and restored without reseeding", async (t) => {
    const env = await setup(t)
    const gm = await env.gm()
    assert.deepEqual(gm.state.characters.map((c) => c.name), ["Alex", "Bia", "Caio", "Dani", "Rafa"])
    assert.equal((await request(gm, "updateCharacter", { characterId: "alex", revision: 0, patch: { name: "Investigadora", life: 5, inventory: "Chave antiga", skills: { Ocultismo: 75 } } })).ok, true)
    const restored = createStore(env.directory).get("halloween")
    assert.equal(restored.characters[0].life, 5)
    assert.equal(restored.characters[0].name, "Investigadora")
    assert.deepEqual(restored.characters[0].skills, { Ocultismo: 75 })
    const other = await env.gm("outra-mesa")
    assert.equal(other.state.characters[0].life, 12)
    assert.equal(JSON.stringify(gm.state).includes("invites"), false)
})

test("authentication, individual view, ownership, validation and revision conflict", async (t) => {
    const env = await setup(t)
    const stranger = await env.client()
    assert.equal((await request(stranger, "join", { sessionId: "halloween", role: "gm", key: "wrong" })).ok, false)
    assert.equal((await request(stranger, "join", { sessionId: "../outside", role: "gm", key: gmKey })).ok, false)
    assert.equal((await request(stranger, "message", { text: "hello", to: "all" })).ok, false)
    const gm = await env.gm()
    const { socket: alex, key } = await env.player(gm, "alex")
    assert.equal(alex.state.characters.length, 1)
    assert.equal(alex.state.characters[0].id, "alex")
    const impostor = await env.client()
    assert.equal((await request(impostor, "join", { sessionId: "halloween", characterId: "bia", key })).ok, false)
    assert.equal((await request(impostor, "join", { sessionId: "outra-mesa", characterId: "alex", key })).ok, false)
    assert.equal((await request(alex, "updateCharacter", { characterId: "bia", revision: 0, patch: { life: 0 } })).ok, false)
    assert.equal((await request(alex, "invite", { characterId: "alex" })).ok, false)
    for (const patch of [{ life: 13 }, { energy: -1 }, { maxLife: 0 }, { name: "" }, { id: "bia" }, { skills: { Test: 10000 } }, { age: 3.5 }]) {
        assert.equal((await request(alex, "updateCharacter", { characterId: "alex", revision: 0, patch })).ok, false)
    }
    const gmUpdate = once(gm, "state")
    assert.equal((await request(alex, "updateCharacter", { characterId: "alex", revision: 0, patch: { stress: 30 } })).ok, true)
    assert.equal((await gmUpdate).characters[0].stress, 30)
    assert.equal((await request(gm, "updateCharacter", { characterId: "alex", revision: 0, patch: { stress: 10 } })).ok, false)
    assert.equal(env.store.get("halloween").characters[0].stress, 30)
})

test("private messages, public d100, replay, session boundaries and revoked invitations", async (t) => {
    const env = await setup(t)
    const gm = await env.gm()
    const { socket: alex, key } = await env.player(gm, "alex")
    const { socket: bia } = await env.player(gm, "bia")
    const other = await env.gm("isolated")
    assert.equal((await request(gm, "message", { to: "alex", text: "Segredo de Alex" })).ok, true)
    await request(bia, "message", { to: "gm", text: "Segredo de Bia" })
    assert.deepEqual(alex.state.messages.map((m) => m.text), ["Segredo de Alex"])
    assert.deepEqual(bia.state.messages.map((m) => m.text), ["Segredo de Bia"])
    assert.equal(gm.state.messages.length, 2)
    assert.equal(other.state.messages.length, 0)
    assert.equal((await request(alex, "message", { to: "bia", text: "forbidden" })).ok, false)
    assert.equal((await request(alex, "roll", { characterId: "bia" })).ok, false)
    const rolled = await request(alex, "roll", { characterId: "alex", category: "skills", label: "Observar" })
    assert.equal(rolled.ok, true)
    assert.ok(rolled.roll >= 1 && rolled.roll <= 100)
    assert.equal(rolled.target, 50)
    assert.equal(createStore(env.directory).get("halloween").messages.length, 3)
    const reconnect = await env.client()
    assert.equal((await request(reconnect, "join", { sessionId: "halloween", characterId: "alex", key })).ok, true)
    assert.equal(reconnect.state.messages.length, 2)
    const disconnected = once(alex, "disconnect")
    await request(gm, "invite", { characterId: "alex" })
    await disconnected
    const revoked = await env.client()
    assert.equal((await request(revoked, "join", { sessionId: "halloween", characterId: "alex", key })).ok, false)
    assert.equal(JSON.stringify(fs.readFileSync(path.join(env.directory, "halloween.json"), "utf8")).includes(key), false)
})

test("failed writes publish no changes; corrupt files are never reset", async (t) => {
    const env = await setup(t)
    const gm = await env.gm()
    const originalSave = env.store.save
    env.store.save = () => { throw Object.assign(new Error("disk failure"), { code: "ENOSPC" }) }
    const response = await request(gm, "updateCharacter", { characterId: "alex", revision: 0, patch: { life: 0 } })
    assert.equal(response.ok, false)
    assert.equal(env.store.get("halloween").characters[0].life, 12)
    assert.equal(gm.state.characters[0].life, 12)
    env.store.save = originalSave
    fs.writeFileSync(path.join(env.directory, "broken.json"), "invalid json")
    assert.throws(() => createStore(env.directory).get("broken"))
    assert.equal(fs.readFileSync(path.join(env.directory, "broken.json"), "utf8"), "invalid json")
})

test("one master and all five players can edit their own sheets concurrently", async (t) => {
    const env = await setup(t)
    const gm = await env.gm()
    const ids = ["alex", "bia", "caio", "dani", "rafa"]
    const players = []
    for (const id of ids) players.push((await env.player(gm, id)).socket)
    const complete = new Promise((resolve) => {
        gm.on("state", (state) => {
            if (state.characters.every((c) => c.revision === 1)) resolve(state)
        })
    })
    const responses = await Promise.all(players.map((socket, index) => request(socket, "updateCharacter", {
        characterId: ids[index], revision: 0, patch: { energy: index + 1 }
    })))
    assert.equal(responses.every((response) => response.ok), true)
    const state = await complete
    assert.deepEqual(state.characters.map((c) => c.energy), [1, 2, 3, 4, 5])
    assert.deepEqual(createStore(env.directory).get("halloween").characters, state.characters)
})

test("lobby, blank campaigns, configurable rules and dynamic characters share one model", async (t) => {
    const env = await setup(t)
    const stranger = await env.client()
    assert.equal((await request(stranger, "listSessions")).ok, false)
    assert.equal((await request(stranger, "createSession", { id: "bad", template: "blank" })).ok, false)
    assert.equal((await request(stranger, "join", { role: "gm", sessionId: "missing", key: gmKey })).ok, false)
    assert.equal(env.store.get("missing"), null, "joining does not create a campaign")
    const gm = await env.client()
    assert.deepEqual((await request(gm, "login", { key: gmKey })).sessions, [])
    assert.equal((await request(gm, "createSession", { id: "fantasia", template: "blank", title: "Crônicas do norte", system: "Fantasia d20" })).ok, true)
    assert.equal((await request(gm, "createSession", { id: "fantasia", template: "blank", title: "Overwrite", system: "" })).ok, false)
    assert.equal((await request(gm, "join", { sessionId: "fantasia", role: "gm" })).ok, true)
    assert.equal(gm.state.characters.length, 0)
    assert.equal(gm.state.defaultDie, 20)
    assert.equal((await request(gm, "roll", { expression: "2d6+3" })).ok, true, "GM may roll with no characters")
    const result = await request(gm, "createCharacter", { name: "Luna" })
    assert.equal(result.ok, true)
    assert.ok(!["alex", "bia", "caio", "dani", "rafa"].includes(result.characterId))
    const { socket: player } = await env.player(gm, result.characterId)
    assert.equal((await request(player, "createCharacter", { name: "Forbidden" })).ok, false)
    assert.equal((await request(player, "removeCharacter", { characterId: result.characterId })).ok, false)
    const settings = { revision: 0, title: "Crônicas", system: "Meu sistema", description: "Uma longa jornada", defaultDie: 6, rollMode: "modifier", statusLabels: { life: "Vitalidade", energy: "Mana", stress: "Corrupção" } }
    assert.equal((await request(player, "updateSession", settings)).ok, false)
    assert.equal((await request(gm, "updateSession", settings)).ok, true)
    assert.equal((await request(gm, "updateSession", settings)).ok, false, "session conflicts are rejected")
    assert.equal(gm.state.statusLabels.energy, "Mana")
    assert.equal((await request(player, "updateCharacter", { characterId: result.characterId, revision: 0, patch: { skills: { Magia: 3, Maldição: -1 } } })).ok, true)
    const roll = await request(player, "roll", { characterId: result.characterId, category: "skills", label: "Magia" })
    assert.equal(roll.ok, true)
    assert.equal(roll.total, roll.roll + 3)
    assert.ok(roll.roll >= 1 && roll.roll <= 6)
    const listed = await request(gm, "listSessions")
    assert.equal(listed.sessions[0].title, "Crônicas")
    assert.equal(JSON.stringify(listed.sessions).includes("invites"), false)
    const disconnected = once(player, "disconnect")
    assert.equal((await request(gm, "removeCharacter", { characterId: result.characterId })).ok, true)
    await disconnected
    assert.equal(gm.state.characters.length, 0)
    assert.equal(env.store.get("fantasia").invites[result.characterId], undefined)
})

test("map ownership, public token state and persistence reuse the same campaign", async (t) => {
    const env = await setup(t)
    const gm = await env.gm()
    const { socket: alex } = await env.player(gm, "alex")
    const { socket: bia } = await env.player(gm, "bia")
    assert.equal((await request(alex, "moveToken", { characterId: "bia", x: 125, y: 225 })).ok, false)
    assert.equal((await request(alex, "moveToken", { x: -1, y: 225 })).ok, false)
    assert.equal((await request(alex, "moveToken", { x: 125, y: 225 })).ok, true)
    assert.deepEqual(gm.state.tokens, [{ id: "alex", x: 125, y: 225 }])
    // Bia's next acknowledged action is a barrier for previously published state.
    await request(bia, "message", { to: "gm", text: "Vejo seu token" })
    assert.equal(bia.state.tokens[0].id, "alex")
    assert.equal(bia.state.characters.length, 1)
    assert.equal((await request(gm, "moveToken", { characterId: "bia", x: 325, y: 475 })).ok, true)
    assert.equal(createStore(env.directory).get("halloween").tokens.length, 2)
    await request(gm, "removeCharacter", { characterId: "bia" })
    assert.equal(env.store.get("halloween").tokens.length, 1)
    assert.equal(env.store.get("halloween").tokens[0].id, "alex")
})

test("version one sessions migrate without losing sheets, messages or invitation hashes", async (t) => {
    const env = await setup(t)
    const old = seed("antiga")
    old.version = 1
    for (const key of ["title", "system", "description", "defaultDie", "rollMode", "statusLabels", "revision", "tokens"]) delete old[key]
    old.characters[0].life = 3
    old.invites.alex = "saved-hash"
    old.messages.push({ id: "old-message", from: "gm", to: "alex", text: "Privada" })
    const file = path.join(env.directory, "antiga.json")
    fs.writeFileSync(file, JSON.stringify(old))
    const migrated = env.store.get("antiga")
    assert.equal(migrated.version, 2)
    assert.equal(migrated.title, "Nocturne")
    assert.equal(migrated.characters[0].life, 3)
    assert.equal(migrated.invites.alex, "saved-hash")
    assert.equal(migrated.messages[0].text, "Privada")
    assert.equal(JSON.parse(fs.readFileSync(file)).version, 1, "read migration does not overwrite files")
    env.store.save(migrated)
    assert.equal(createStore(env.directory).get("antiga").version, 2)
    fs.writeFileSync(path.join(env.directory, "broken.json"), "invalid json")
    assert.equal(env.store.list().find((s) => s.id === "broken").unavailable, true)
})
