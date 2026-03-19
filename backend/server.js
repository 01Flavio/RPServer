const express = require("express")
const http = require("http")
const { Server } = require("socket.io")
const path = require("path")

const app = express()
const server = http.createServer(app)
const io = new Server(server)

app.use(express.static(path.join(__dirname, "../frontend")))

let tokens = {}

io.on("connection", (socket) => {

    console.log("Jogador conectado")

    socket.emit("loadTokens", tokens)

    socket.on("moveToken", (token) => {
        tokens[token.id] = token
        io.emit("tokenMoved", token)
    })

    socket.on("chat", (msg) => {
        io.emit("chat", msg)
    })

    socket.on("dice", () => {

        const roll = Math.floor(Math.random()*20)+1

        io.emit("dice", roll)
    })

})

server.listen(3000, () => {
    console.log("Servidor rodando em http://localhost:3000")
})
