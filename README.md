# Next.js PPR resume segment id collision (16.2.x)

Minimal reproduction: on Next.js **16.2.9** (current `latest`) with `cacheComponents: true`, a Partial Prerender route serves a document containing **duplicate Fizz segment ids** (`<div hidden id="S:x">` twice in one response). React's inline completion scripts resolve segments via `getElementById`, so the wrong fragment can be moved into the wrong Suspense hole, visibly corrupting the page.

The corruption path: the duplicated ids are consumed twice — first by the prelude's `$RC("B:x","S:x")`, then by the resume stream's `$RS("S:x","P:x")` for a *different* fragment (in this repro, footer rows re-using the widget ids). `$RC` does **not** remove the segment node synchronously; it queues the reveal for a later `requestAnimationFrame`/`setTimeout` batch. So when `$RS("S:x","P:x")` executes during parsing, both `S:x` nodes can still be in the DOM, `getElementById` returns the first in document order — the stale baked widget segment — and `$RS` splices widget content into the footer placeholder. Whether this fires depends on whether a frame elapses between the prelude and the resume chunk, which is why the corruption is timing-dependent.

## Reproduce

```bash
pnpm install
pnpm build
pnpm start             # terminal 1 — leave running
pnpm check             # terminal 2 — exits 1, prints the duplicated ids
```

Run `pnpm check` only once `pnpm start` reports the server is ready on port 3000 — chaining them in one command (`pnpm start & pnpm check`) races the server startup, and if something else is already listening on port 3000 the check will silently hit that instead.

Expected: `duplicate ids: 0`.
Actual on 16.2.9: `duplicate ids: 3 [S:1, S:2, S:3]` — one collision per cached widget: the stored document bakes `S:1`–`S:3` for the outlined `'use cache'` widgets, and the runtime resume re-renders those stale boundaries with ids allocated from the stale counter, re-issuing the same `S:1`–`S:3`.

## Mechanism

1. At build time the stored HTML for the route is composed of **two Fizz passes**: the prerender prelude plus a resume-and-abort pass that materializes the resolved-but-outlined boundaries (the large `'use cache'` widgets) as hidden segments — ids allocated **past** the prelude's counter.
2. The postponed state persisted in `.next/server/app/index.meta` still carries the **pre-resume** `nextSegmentId` (inspect it: the stored document already contains baked `S:x` segments at and above the counter value persisted in the meta (`"nextSegmentId":1`, while the stored HTML bakes `S:1`–`S:3`)).
3. At request time, the resume render (the by-then-stale widget boundaries plus the dynamic `await connection()` footer) allocates segment ids from that stale counter, re-issuing the already-baked `S:1`–`S:3` → duplicate ids in one document.

## Ingredients

- `cacheComponents: true`
- Suspense-wrapped `'use cache'` components whose rendered output is larger than `progressiveChunkSize` (so they are **outlined** into hidden segments in the stored document) with `expire` ≥ 5 minutes (so they are included in the static shell)
- one dynamic boundary (`await connection()`) large enough that the runtime resume allocates new segment ids

## Version matrix

| Version | web streams path | node streams path |
|---|---|---|
| 16.2.9 (`latest`) | **broken** | flag not available |
| 16.3.0-canary.0 – .37 | **broken** (default) | ok (opt-in) |
| 16.3.0-canary.38+ | **broken** (`experimental.useNodeStreams: false`) | ok (**default** since vercel/next.js#94311) |

Canary ≥ .38 passes by default only because vercel/next.js#94311 switched the default serving path to Node streams — the web-streams resume path still has the stale-counter issue, and the whole stable 16.2.x line is affected with no opt-out.

To verify on canary: `pnpm add next@canary`, set `experimental: { useNodeStreams: false }` in `next.config.js`, rebuild — the duplicates come back.
