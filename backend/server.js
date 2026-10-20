const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const path = require("path")

const app = express()
const server = http.createServer(app)
const io = new Server(server)
const tables = new Map()
const tokenColors = ["#e7ad5d", "#8fc5a0", "#8cb6e8", "#d993b4", "#c3a1e8", "#e58c78"]
const MAX_CHAT_MESSAGES = 50

app.use(express.static(path.join(__dirname, "../frontend")))

function getTable(roomId) {
    if (!tables.has(roomId)) {
        tables.set(roomId, { players: new Map(), tokens: new Map(), messages: [] })
    }
    return tables.get(roomId)
}

function broadcastTable(roomId, event, data) {
    io.to(roomId).emit(event, data)
}

function appendMessage(table, message) {
    table.messages.push(message)
    if (table.messages.length > MAX_CHAT_MESSAGES) table.messages.shift()
    return message
}

function isCurrentPlayer(socket) {
    const table = tables.get(socket.data.roomId)
    const player = table && table.players.get(socket.data.playerId)
    return player && player.socketId === socket.id ? player : null
}

function sendError(socket, message) {
    socket.emit("actionError", message)
}

io.on("connection", (socket) => {
    socket.on("joinTable", (details) => {
        if (socket.data.roomId) return

        const name = typeof details?.name === "string" ? details.name.trim().slice(0, 24) : ""
        const roomId = typeof details?.roomId === "string" ? details.roomId.trim().toLowerCase() : ""
        const playerId = typeof details?.playerId === "string" ? details.playerId : ""

        if (!name || !/^[a-z0-9_-]{2,32}$/.test(roomId) || !/^[a-f0-9-]{16,40}$/i.test(playerId)) {
            sendError(socket, "Confira seu nome e use um código de mesa com 2 a 32 letras, números, hífens ou _.")
            return
        }

        const table = getTable(roomId)
        const previousPlayer = table.players.get(playerId)
        const color = previousPlayer?.color || tokenColors[table.players.size % tokenColors.length]
        const player = { id: playerId, name, color, socketId: socket.id }

        socket.join(roomId)
        socket.data.roomId = roomId
        socket.data.playerId = playerId
        table.players.set(playerId, player)

        socket.emit("tableState", {
            roomId,
            playerId,
            players: Array.from(table.players.values(), ({ id, name: playerName, color: playerColor }) => ({ id, name: playerName, color: playerColor })),
            tokens: Array.from(table.tokens.values()),
            messages: table.messages
        })
        broadcastTable(roomId, "playerJoined", { id: player.id, name: player.name, color: player.color })

        if (!previousPlayer) {
            appendMessage(table, {
                id: `${Date.now()}-${socket.id}`,
                type: "system",
                text: `${name} entrou na mesa.`,
                timestamp: Date.now()
            })
            broadcastTable(roomId, "chatMessage", table.messages[table.messages.length - 1])
        }
    })

    socket.on("moveToken", (position) => {
        const player = isCurrentPlayer(socket)
        if (!player) return sendError(socket, "Entre em uma mesa antes de mover seu token.")

        const x = Number(position?.x)
        const y = Number(position?.y)
        if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1200 || y < 0 || y > 760) {
            return sendError(socket, "Essa posição do mapa não é válida.")
        }

        const table = tables.get(socket.data.roomId)
        const token = { id: player.id, name: player.name, color: player.color, x, y }
        table.tokens.set(player.id, token)
        broadcastTable(socket.data.roomId, "tokenMoved", token)
    })

    socket.on("chat", (text) => {
        const player = isCurrentPlayer(socket)
        if (!player) return sendError(socket, "Entre em uma mesa antes de enviar mensagens.")
        if (typeof text !== "string" || !text.trim() || text.length > 500) {
            return sendError(socket, "A mensagem deve ter entre 1 e 500 caracteres.")
        }

        const table = tables.get(socket.data.roomId)
        const message = appendMessage(table, {
            id: `${Date.now()}-${socket.id}`,
            type: "chat",
            playerId: player.id,
            playerName: player.name,
            text: text.trim(),
            timestamp: Date.now()
        })
        broadcastTable(socket.data.roomId, "chatMessage", message)
    })

    socket.on("dice", (expression) => {
        const player = isCurrentPlayer(socket)
        if (!player) return sendError(socket, "Entre em uma mesa antes de rolar os dados.")
        if (typeof expression !== "string") return sendError(socket, "Use uma expressão como 1d20 ou 2d6+3.")

        const match = /^(\d{1,2})d(\d{1,4})([+-]\d{1,4})?$/i.exec(expression.trim())
        const count = match ? Number(match[1]) : 0
        const sides = match ? Number(match[2]) : 0
        const modifier = match && match[3] ? Number(match[3]) : 0
        if (!match || count < 1 || count > 20 || sides < 2 || sides > 1000 || Math.abs(modifier) > 1000) {
            return sendError(socket, "Expressão inválida. Use até 20 dados, como 1d20 ou 2d6+3.")
        }

        const rolls = Array.from({ length: count }, () => Math.floor(Math.random() * sides) + 1)
        const total = rolls.reduce((sum, roll) => sum + roll, modifier)
        const table = tables.get(socket.data.roomId)
        const message = appendMessage(table, {
            id: `${Date.now()}-${socket.id}`,
            type: "dice",
            playerId: player.id,
            playerName: player.name,
            expression: expression.trim(),
            rolls,
            modifier,
            total,
            timestamp: Date.now()
        })
        broadcastTable(socket.data.roomId, "chatMessage", message)
    })

    socket.on("disconnect", () => {
        const roomId = socket.data.roomId
        const playerId = socket.data.playerId
        const table = roomId && tables.get(roomId)
        const player = table && table.players.get(playerId)
        if (!player || player.socketId !== socket.id) return

        table.players.delete(playerId)
        broadcastTable(roomId, "playerLeft", { id: playerId })
        appendMessage(table, {
            id: `${Date.now()}-${socket.id}`,
            type: "system",
            text: `${player.name} saiu da mesa.`,
            timestamp: Date.now()
        })
        broadcastTable(roomId, "chatMessage", table.messages[table.messages.length - 1])
    })
})

const port = Number(process.env.PORT) || 3000
server.listen(port, () => {
    console.log(`Servidor rodando em http://localhost:${port}`)
})
