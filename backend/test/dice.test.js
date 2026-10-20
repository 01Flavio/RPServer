const { test } = require("node:test")
const assert = require("node:assert/strict")
const { rollDice } = require("../dice")

test("RPServer dice expressions preserve counts, modifiers and bounded totals", () => {
    for (const [expression, count, minimum, maximum] of [["1d100", 1, 1, 100], ["2d6+3", 2, 5, 15], ["3d20-2", 3, 1, 58], ["20d1000+1000", 20, 1020, 21000]]) {
        const result = rollDice(expression)
        assert.equal(result.rolls.length, count)
        assert.ok(result.total >= minimum && result.total <= maximum)
        assert.equal(result.total, result.rolls.reduce((sum, r) => sum + r, result.modifier))
    }
    for (const input of [null, {}, "", "1d1", "0d20", "21d6", "2d1001", "1d20+1001", "alert(1)", "100000d20"]) assert.throws(() => rollDice(input))
})
