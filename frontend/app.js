const socket = io()

const canvas = document.getElementById("map")
const ctx = canvas.getContext("2d")
const playerList = document.getElementById("playerList")
const chat = document.getElementById("chat")
const overlay = document.getElementById("mapOverlay")
const joinForm = document.getElementById("joinForm")
const joinError = document.getElementById("joinError")
const players = new Map()
const tokens = new Map()
const playerId = getPlayerId()
let roomId = ""
let joined = false
let pointerStart = null
let draggingToken = false

function getPlayerId() {
    let id = localStorage.getItem("vtt-player-id")
    if (!id) {
        id = crypto.randomUUID()
        localStorage.setItem("vtt-player-id", id)
    }
    return id
}

function appendMessage(message) {
    const welcome = chat.querySelector(".chat-welcome")
    if (welcome) welcome.remove()

    const article = document.createElement("article")
    article.className = `chat-message${message.type === "system" ? " is-system" : ""}`

    const meta = document.createElement("div")
    meta.className = "message-meta"
    const author = document.createElement("span")
    author.className = "message-author"
    author.textContent = message.type === "system" ? "Mesa" : message.playerName
    const time = document.createElement("time")
    time.className = "message-time"
    time.dateTime = new Date(message.timestamp).toISOString()
    time.textContent = new Date(message.timestamp).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
    meta.append(author, time)
    article.append(meta)

    const content = document.createElement("p")
    content.className = message.type === "dice" ? "message-text message-roll" : "message-text"
    if (message.type === "dice") {
        const rolls = message.rolls.join(" + ")
        const modifier = message.modifier ? ` ${message.modifier > 0 ? "+" : "−"} ${Math.abs(message.modifier)}` : ""
        content.textContent = `${message.expression}: [${rolls}]${modifier} = ${message.total}`
    } else {
        content.textContent = message.text
    }
    article.append(content)
    chat.append(article)
    chat.scrollTop = chat.scrollHeight
}

function renderPlayers() {
    playerList.replaceChildren()
    document.getElementById("playerCount").textContent = String(players.size)

    if (players.size === 0) {
        const empty = document.createElement("li")
        empty.className = "empty-state"
        empty.textContent = "Ninguém na mesa por enquanto."
        playerList.append(empty)
        return
    }

    for (const player of players.values()) {
        const item = document.createElement("li")
        item.className = "player-item"
        const avatar = document.createElement("span")
        avatar.className = "player-avatar"
        avatar.style.backgroundColor = player.color
        avatar.textContent = player.name.trim().charAt(0).toUpperCase()
        const name = document.createElement("span")
        name.className = "player-name"
        name.textContent = player.name
        item.append(avatar, name)
        if (player.id === playerId) {
            const you = document.createElement("span")
            you.className = "you-tag"
            you.textContent = "você"
            name.append(you)
        }
        playerList.append(item)
    }
}

function resizeCanvas() {
    const rect = canvas.getBoundingClientRect()
    if (!rect.width || !rect.height) return
    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.round(rect.width * dpr)
    canvas.height = Math.round(rect.height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
}

function draw() {
    const rect = canvas.getBoundingClientRect()
    const width = rect.width
    const height = rect.height
    if (!width || !height) return

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = "#1b1d22"
    ctx.fillRect(0, 0, width, height)
    ctx.strokeStyle = "#ffffff0d"
    ctx.lineWidth = 1
    for (let x = 0; x <= width; x += 50) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, height)
        ctx.stroke()
    }
    for (let y = 0; y <= height; y += 50) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
    }

    for (const token of tokens.values()) {
        const x = token.x / 1200 * width
        const y = token.y / 760 * height
        ctx.beginPath()
        ctx.arc(x, y, 17, 0, Math.PI * 2)
        ctx.fillStyle = `${token.color}30`
        ctx.fill()
        ctx.lineWidth = 2
        ctx.strokeStyle = token.color
        ctx.stroke()
        ctx.beginPath()
        ctx.arc(x, y, 12, 0, Math.PI * 2)
        ctx.fillStyle = token.color
        ctx.fill()
        ctx.fillStyle = "#17191f"
        ctx.font = "600 10px 'DM Sans', sans-serif"
        ctx.textAlign = "center"
        ctx.textBaseline = "middle"
        ctx.fillText(token.name.trim().charAt(0).toUpperCase(), x, y + .5)
        ctx.fillStyle = "#e7e4df"
        ctx.font = "500 10px 'DM Sans', sans-serif"
        ctx.textBaseline = "top"
        ctx.fillText(token.name, x, y + 21)
    }
}

function mapPosition(event) {
    const rect = canvas.getBoundingClientRect()
    return {
        x: Math.max(0, Math.min(1200, (event.clientX - rect.left) / rect.width * 1200)),
        y: Math.max(0, Math.min(760, (event.clientY - rect.top) / rect.height * 760))
    }
}

function snapToGrid(position) {
    return {
        x: Math.max(25, Math.min(1175, Math.round(position.x / 50) * 50 + 25)),
        y: Math.max(25, Math.min(735, Math.round(position.y / 50) * 50 + 25))
    }
}

function moveOwnToken(position) {
    if (!joined) return
    socket.emit("moveToken", snapToGrid(position))
}

socket.on("connect", () => {
    document.getElementById("connectionStatus").textContent = joined ? "Reconectando..." : "Conectado"
    document.getElementById("connectionDot").classList.add("is-connected")
    if (joined) socket.emit("joinTable", { name: localStorage.getItem("vtt-player-name") || "Aventureiro", roomId, playerId })
})

socket.on("disconnect", () => {
    document.getElementById("connectionStatus").textContent = "Reconectando..."
    document.getElementById("connectionDot").classList.remove("is-connected")
})

socket.on("tableState", (state) => {
    roomId = state.roomId
    joined = true
    players.clear()
    tokens.clear()
    state.players.forEach((player) => players.set(player.id, player))
    state.tokens.forEach((token) => tokens.set(token.id, token))
    chat.replaceChildren()
    state.messages.forEach(appendMessage)
    document.getElementById("roomLabel").textContent = roomId
    document.getElementById("connectionStatus").textContent = "Conectado"
    overlay.classList.add("is-hidden")
    document.getElementById("tokenHint").textContent = tokens.has(playerId) ? "Seu token está no mapa" : "Clique no mapa para colocar seu token"
    renderPlayers()
    draw()
})

socket.on("playerJoined", (player) => {
    players.set(player.id, player)
    renderPlayers()
})

socket.on("playerLeft", ({ id }) => {
    players.delete(id)
    renderPlayers()
})

socket.on("tokenMoved", (token) => {
    tokens.set(token.id, token)
    document.getElementById("tokenHint").textContent = token.id === playerId ? "Seu token está no mapa" : "Clique para posicionar · arraste para mover"
    draw()
})

socket.on("chatMessage", appendMessage)

socket.on("actionError", (message) => {
    joinError.textContent = message
    if (joined) appendMessage({ type: "system", text: message, timestamp: Date.now() })
})

joinForm.addEventListener("submit", (event) => {
    event.preventDefault()
    const name = document.getElementById("playerName").value.trim()
    const requestedRoom = document.getElementById("roomId").value.trim().toLowerCase()
    if (!name) {
        joinError.textContent = "Digite seu nome para entrar."
        return
    }
    if (!/^[a-z0-9_-]{2,32}$/.test(requestedRoom)) {
        joinError.textContent = "Use 2 a 32 letras, números, hífens ou _ no código da mesa."
        return
    }
    localStorage.setItem("vtt-player-name", name)
    localStorage.setItem("vtt-room-id", requestedRoom)
    roomId = requestedRoom
    joinError.textContent = ""
    if (socket.connected) socket.emit("joinTable", { name, roomId, playerId })
    else joinError.textContent = "Conectando ao servidor. Tente novamente em alguns segundos."
})

document.getElementById("changeTableButton").addEventListener("click", () => {
    if (joined) window.location.reload()
    else document.getElementById("playerName").focus()
})

document.getElementById("chatForm").addEventListener("submit", (event) => {
    event.preventDefault()
    const input = document.getElementById("messageInput")
    if (!joined || !input.value.trim()) return
    socket.emit("chat", input.value)
    input.value = ""
    input.focus()
})

document.getElementById("diceForm").addEventListener("submit", (event) => {
    event.preventDefault()
    if (joined) socket.emit("dice", document.getElementById("diceExpression").value)
})

document.querySelectorAll(".dice-preset").forEach((button) => {
    button.addEventListener("click", () => {
        document.getElementById("diceExpression").value = button.dataset.expression
    })
})

canvas.addEventListener("pointerdown", (event) => {
    if (!joined) return
    pointerStart = mapPosition(event)
    const ownToken = tokens.get(playerId)
    draggingToken = Boolean(ownToken && Math.hypot(pointerStart.x - ownToken.x, pointerStart.y - ownToken.y) < 30)
    if (draggingToken) canvas.setPointerCapture(event.pointerId)
})

canvas.addEventListener("pointerup", (event) => {
    if (!pointerStart || !joined) return
    const position = mapPosition(event)
    if (draggingToken || Math.hypot(position.x - pointerStart.x, position.y - pointerStart.y) < 8) moveOwnToken(position)
    pointerStart = null
    draggingToken = false
})

canvas.addEventListener("pointermove", (event) => {
    if (!pointerStart || !draggingToken) return
    const position = snapToGrid(mapPosition(event))
    tokens.set(playerId, { id: playerId, name: localStorage.getItem("vtt-player-name") || "Aventureiro", color: players.get(playerId)?.color || "#e7ad5d", ...position })
    draw()
})

canvas.addEventListener("pointercancel", () => {
    pointerStart = null
    draggingToken = false
})

document.getElementById("playerName").value = localStorage.getItem("vtt-player-name") || ""
const queryRoom = new URLSearchParams(window.location.search).get("mesa")
document.getElementById("roomId").value = queryRoom || localStorage.getItem("vtt-room-id") || "mesa-da-aventura"
document.getElementById("roomId").addEventListener("change", (event) => {
    localStorage.setItem("vtt-room-id", event.target.value.trim().toLowerCase())
})
new ResizeObserver(resizeCanvas).observe(canvas)
resizeCanvas()
