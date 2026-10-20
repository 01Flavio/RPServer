// Canvas coordinates and pointer behavior retained from the original RPServer map.
window.createTableMap = function (canvas, onMove) {
    const ctx = canvas.getContext("2d")
    let state = null
    let selectedId = null
    let pointerStart = null
    let dragging = false
    let preview = null
    const rect = () => canvas.getBoundingClientRect()
    function draw() {
        const { width, height } = rect()
        if (!width || !height) return
        ctx.clearRect(0, 0, width, height)
        ctx.fillStyle = "#11160f"
        ctx.fillRect(0, 0, width, height)
        ctx.strokeStyle = "#acb38814"
        ctx.lineWidth = 1
        for (let x = 0; x <= 1200; x += 50) {
            ctx.beginPath(); ctx.moveTo(x / 1200 * width, 0); ctx.lineTo(x / 1200 * width, height); ctx.stroke()
        }
        for (let y = 0; y <= 760; y += 50) {
            ctx.beginPath(); ctx.moveTo(0, y / 760 * height); ctx.lineTo(width, y / 760 * height); ctx.stroke()
        }
        if (!state) return
        const tokens = preview ? [...state.tokens.filter((t) => t.id !== preview.id), preview] : state.tokens
        for (const token of tokens) {
            const player = state.roster.find((p) => p.id === token.id)
            if (!player) continue
            const x = token.x / 1200 * width
            const y = token.y / 760 * height
            ctx.beginPath(); ctx.arc(x, y, 16, 0, Math.PI * 2)
            ctx.fillStyle = `${player.color}35`; ctx.fill()
            ctx.lineWidth = token.id === selectedId ? 2 : 1; ctx.strokeStyle = player.color; ctx.stroke()
            ctx.fillStyle = player.color; ctx.font = "bold 13px Georgia, serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"
            ctx.fillText(player.name[0].toUpperCase(), x, y)
            ctx.font = "10px system-ui, sans-serif"; ctx.textBaseline = "top"; ctx.fillStyle = "#e6e4d9"
            ctx.fillText(player.name, Math.max(25, Math.min(width - 25, x)), y > height - 40 ? y - 32 : y + 21)
        }
    }
    function resize() {
        const { width, height } = rect()
        if (!width || !height) return
        const dpr = window.devicePixelRatio || 1
        canvas.width = Math.round(width * dpr); canvas.height = Math.round(height * dpr)
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0); draw()
    }
    function position(event) {
        const bounds = rect()
        return { x: Math.max(25, Math.min(1175, Math.round(((event.clientX - bounds.left) / bounds.width * 1200 - 25) / 50) * 50 + 25)),
            y: Math.max(25, Math.min(735, Math.round(((event.clientY - bounds.top) / bounds.height * 760 - 25) / 50) * 50 + 25)) }
    }
    canvas.addEventListener("pointerdown", (event) => {
        if (!selectedId || event.button !== 0) return
        pointerStart = { x: event.clientX, y: event.clientY }
        const target = position(event)
        const token = state?.tokens.find((t) => t.id === selectedId)
        dragging = Boolean(token && Math.hypot(token.x - target.x, token.y - target.y) < 55)
        canvas.setPointerCapture(event.pointerId)
    })
    canvas.addEventListener("pointermove", (event) => {
        if (!pointerStart || !dragging) return
        preview = { id: selectedId, ...position(event) }; draw()
    })
    canvas.addEventListener("pointerup", (event) => {
        if (!pointerStart) return
        if (dragging || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) < 8) onMove({ characterId: selectedId, ...position(event) })
        pointerStart = null; dragging = false; preview = null; draw()
    })
    canvas.addEventListener("pointercancel", () => { pointerStart = null; preview = null; dragging = false; draw() })
    canvas.addEventListener("keydown", (event) => {
        const delta = { ArrowUp: [0, -50], ArrowDown: [0, 50], ArrowLeft: [-50, 0], ArrowRight: [50, 0] }[event.key]
        if (!delta || !selectedId) return
        event.preventDefault()
        const token = state.tokens.find((t) => t.id === selectedId) || { x: 575, y: 375 }
        onMove({ characterId: selectedId, x: Math.max(25, Math.min(1175, token.x + delta[0])), y: Math.max(25, Math.min(735, token.y + delta[1])) })
    })
    new ResizeObserver(resize).observe(canvas)
    return { update(next, id) { state = next; selectedId = id; preview = null; draw() }, resize }
}
