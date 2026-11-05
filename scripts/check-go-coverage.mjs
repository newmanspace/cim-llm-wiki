// Read Go's standard coverprofile without rounding away a threshold failure.
import { readFileSync } from 'node:fs'
const profile = readFileSync(process.argv[2], 'utf8').trim().split('\n')
if (!/^mode: (set|count|atomic)$/.test(profile.shift())) throw new Error('Invalid coverprofile')
const blocks = new Map()
let total = 0, covered = 0
for (const row of profile) {
  const match = row.match(/^(\S+:\d+\.\d+,\d+\.\d+) (\d+) (\d+)$/)
  if (!match) throw new Error('Malformed coverage record')
  const [, location, size, count] = match
  const previous = blocks.get(location)
  if (previous && previous.size !== Number(size)) throw new Error('Inconsistent coverage block')
  // With -coverpkg Go emits the same block for several test binaries.
  blocks.set(location, { size: Number(size), hit: Number(count) > 0 || previous?.hit })
}
for (const block of blocks.values()) {
  total += block.size
  if (block.hit) covered += block.size
}
if (!total) throw new Error('No statements measured')
const percentage = covered / total * 100
console.log(`Go statement coverage: ${percentage.toFixed(2)}%; required: 80%`)
if (percentage < 80) process.exitCode = 1
