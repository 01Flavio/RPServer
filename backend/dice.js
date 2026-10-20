const { randomInt } = require("node:crypto")

// The existing RPServer notation, now shared by every campaign and persisted in its log.
function rollDice(expression) {
    const match = typeof expression === "string" && /^(\d{1,2})d(\d{1,4})([+-]\d{1,4})?$/i.exec(expression.trim())
    const count = match ? Number(match[1]) : 0
    const sides = match ? Number(match[2]) : 0
    const modifier = match && match[3] ? Number(match[3]) : 0
    if (!match || count < 1 || count > 20 || sides < 2 || sides > 1000 || Math.abs(modifier) > 1000) {
        throw new Error("Use até 20 dados, de 2 a 1000 faces, como 1d20 ou 2d6+3.")
    }
    const rolls = Array.from({ length: count }, () => randomInt(1, sides + 1))
    return { expression: expression.trim(), rolls, modifier, total: rolls.reduce((sum, roll) => sum + roll, modifier) }
}

module.exports = { rollDice }
