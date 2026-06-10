// Fetches the page and reports duplicate Fizz segment ids
// (<div hidden id="S:x"> appearing more than once in one document).
const target = process.argv[2] ?? 'http://localhost:3000'

const res = await fetch(target)
const html = await res.text()

const segments = Array.from(
  html.matchAll(/<div hidden id="(S:[0-9a-f]+)">/g),
  (m) => m[1]
)
const duplicates = [
  ...new Set(segments.filter((id, i) => segments.indexOf(id) !== i)),
]

console.log(`segments: ${segments.length}`)
console.log(`duplicate ids: ${duplicates.length} [${duplicates.join(', ')}]`)

if (duplicates.length > 0) {
  console.log('\nBUG REPRODUCED: duplicate segment ids in a single document.')
  console.log('React resolves $RC("B:x","S:x") via getElementById, so the')
  console.log('wrong fragment can be moved into the wrong Suspense hole.')
  process.exitCode = 1
}
