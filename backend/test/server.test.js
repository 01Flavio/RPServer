const { test } = require("node:test")
const assert = require("node:assert/strict")
const { spawn } = require("node:child_process")
const { once } = require("node:events")
const net = require("node:net")
const fs = require("node:fs")
const os = require("node:os")
const path = require("node:path")
const { io } = require("socket.io-client")
const request = (socket, event, payload) => new Promise((resolve, reject) => {
    socket.timeout(3000).emit(event, payload, (error, response) => error ? reject(error) : resolve(response))
})

test("one server serves the unified app and restores sheets, map, chat, dice and invites across restarts", { timeout: 20000 }, async (t) => {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "platform-server-"))
    const probe = net.createServer()
    probe.listen(0, "127.0.0.1")
    await once(probe, "listening")
    const port = probe.address().port
    await new Promise((resolve) => probe.close(resolve))
    const base = `http://127.0.0.1:${port}`
    const key = "ephemeral-server-test-secret-24-chars"
    let processHandle
    const clients = []
    async function start(legacyVariables = false) {
        const env = { ...process.env, PORT: String(port) }
        for (const name of ["NOCTURNE_GM_KEY", "NOCTURNE_DATA_DIR", "RPSERVER_GM_KEY", "RPSERVER_DATA_DIR"]) delete env[name]
        const prefix = legacyVariables ? "NOCTURNE" : "RPSERVER"
        env[`${prefix}_GM_KEY`] = key
        env[`${prefix}_DATA_DIR`] = temporary
        processHandle = spawn(process.execPath, [path.join(__dirname, "../server.js")], { env, stdio: ["ignore", "pipe", "pipe"] })
        await Promise.race([
            once(processHandle.stdout, "data"),
            once(processHandle, "exit").then(([code]) => { throw new Error(`Server exited: ${code}`) })
        ])
    }
    async function stop() {
        const exited = once(processHandle, "exit"); processHandle.kill(); await exited
    }
    async function connect() {
        const socket = io(base, { forceNew: true }); clients.push(socket); await once(socket, "connect"); return socket
    }
    t.after(async () => {
        clients.forEach((socket) => socket.disconnect())
        if (processHandle?.exitCode === null && processHandle.signalCode === null) await stop()
        fs.rmSync(temporary, { recursive: true, force: true })
    })
    await start()
    for (const url of ["/", "/app.js", "/style.css", "/map.js", "/socket.io/socket.io.js"]) assert.equal((await fetch(base + url)).status, 200, url)
    const root = await (await fetch(base)).text()
    assert.ok(root.includes("VÉSPERA"))
    assert.ok(root.includes('id="map"') && root.includes('id="sheetForm"'))
    const redirect = await fetch(`${base}/nocturne/`, { redirect: "manual" })
    assert.equal(redirect.status, 302)
    assert.equal(redirect.headers.get("location"), "/")
    assert.equal((await fetch(`${base}/nocturne/app.js`)).status, 404)
    const gm = await connect()
    assert.equal((await request(gm, "login", { key })).ok, true)
    assert.equal((await request(gm, "createSession", { id: "persist", title: "Minha campanha", system: "Horror", template: "nocturne" })).ok, true)
    assert.equal((await request(gm, "join", { sessionId: "persist", role: "gm" })).ok, true)
    assert.equal((await request(gm, "updateCharacter", { characterId: "alex", revision: 0, patch: { life: 4 } })).ok, true)
    assert.equal((await request(gm, "moveToken", { characterId: "alex", x: 125, y: 225 })).ok, true)
    assert.equal((await request(gm, "message", { text: "Mensagem salva", to: "alex" })).ok, true)
    assert.equal((await request(gm, "roll", { characterId: "alex", expression: "2d6+3" })).ok, true)
    const invitation = await request(gm, "invite", { characterId: "alex" })
    clients.forEach((socket) => socket.disconnect())
    await stop()
    await start(true)
    const player = await connect()
    const state = once(player, "state")
    assert.equal((await request(player, "join", { sessionId: "persist", characterId: "alex", key: invitation.key })).ok, true)
    const restored = (await state)[0]
    assert.equal(restored.characters.length, 1)
    assert.equal(restored.characters[0].life, 4)
    assert.equal(restored.messages[0].text, "Mensagem salva")
    assert.equal(restored.messages[1].expression, "2d6+3")
    assert.deepEqual(restored.tokens, [{ id: "alex", x: 125, y: 225 }])
    assert.equal(restored.title, "Minha campanha")
    assert.equal((await fetch(`${base}/data/nocturne/persist.json`)).status, 404)
})
