const express = require("express")
const http = require("node:http")
const { Server } = require("socket.io")
const path = require("node:path")
const { attachCampaigns } = require("./campaigns")

const app = express()
const server = http.createServer(app)
const io = new Server(server, { maxHttpBufferSize: 64 * 1024 })
attachCampaigns(io)

// Previous bookmarks lead into the same product, with no second application to maintain.
app.get(["/nocturne", "/nocturne/", "/nocturne/index.html"], (req, res) => res.redirect(302, "/"))
app.use(express.static(path.join(__dirname, "../frontend")))
const port = Number(process.env.PORT) || 3000
server.listen(port, () => console.log(`Véspera disponível em http://localhost:${port}`))
