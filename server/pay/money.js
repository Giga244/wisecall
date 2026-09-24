// Money is stored as whole tetri (1/100 lari). Banks talk in decimal lari.
const toDecimal = (tetri) => Number((tetri / 100).toFixed(2));            // 2535 -> 25.35
const fromDecimal = (value) => Math.round(Number(value) * 100);           // "25.35" -> 2535

module.exports = { toDecimal, fromDecimal };
