const socket = io()

const canvas = document.getElementById("map")
const ctx = canvas.getContext("2d")

let tokens = {}

const playerId = "player_" + Math.random()

socket.on("loadTokens",(data)=>{
    tokens = data
    draw()
})

socket.on("tokenMoved",(token)=>{
    tokens[token.id] = token
    draw()
})

function draw(){

    ctx.clearRect(0,0,canvas.width,canvas.height)

    for(let id in tokens){

        const t = tokens[id]

        ctx.beginPath()
        ctx.arc(t.x,t.y,12,0,Math.PI*2)

        ctx.fillStyle = id === playerId ? "lime" : "red"

        ctx.fill()

    }

}

canvas.addEventListener("click",(e)=>{

    const rect = canvas.getBoundingClientRect()

    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    const token = {

        id:playerId,
        x:x,
        y:y

    }

    socket.emit("moveToken",token)

})

function sendChat(){

    const input = document.getElementById("msg")

    socket.emit("chat",input.value)

    input.value=""

}

socket.on("chat",(msg)=>{

    const chat = document.getElementById("chat")

    chat.innerHTML += "<p>"+msg+"</p>"

})

function rollDice(){

    socket.emit("dice")

}

socket.on("dice",(roll)=>{

    const chat = document.getElementById("chat")

    chat.innerHTML += "<p>🎲 D20: "+roll+"</p>"

})
