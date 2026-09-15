# Twitch Alternate Player — working notes

Read this before changing anything. `REPARTITION.md` (in French) holds the history and the measurements
behind the current layout; this file holds what is true now and how to work.

---

## Rules that are not up for discussion

- **Never modify `C:\Users\ingam\OneDrive\Documents\twitch_alternate_player-v2`.** It is the folder
  Chrome has loaded and that Luca uses day to day. It stays on `master @ 6c6fc18`. All work happens
  in the worktree `twitch-alt-v2-nettoyage`, branch `nettoyage`.
- **Never merge `nettoyage` into `master`, and never push it, without Luca's explicit go-ahead.**
  The branch has never been published; the `public` branch is a separate worktree.
- **No tool attribution of any kind.** No `Co-Authored-By` trailer, and no mention of any assistant
  or automated tool in commit messages, pull request descriptions or versioned files. Commits carry
  Luca's git identity only.
- **Never `taskkill /IM chrome.exe`** — it kills Luca's own browsers. Kill test browsers by PID with `/T`.
- **Never use bare `git stash` / `git stash pop`** — the stash stack is shared by every worktree.
- Commit messages are in French, in the style of the existing history.

---

## What the project is

**Alternate Player for Twitch.tv** — a Chrome extension (Manifest V3, `minimum_chrome_version` 92)
that replaces Twitch's player with its own: HLS fetching, server-side ad bypass through a second
playlist requested without ads, MPEG-TS → fMP4 remuxing in a Web Worker, a diagnostics panel (`S`),
replay of the buffered stream, chat panel, follow/notify buttons.

Forked from Alexander Choporov's original (BSD licence — keep his copyright line in `LICENSE`).
Phase 1 translated every identifier from Russian to English. Phase 2 extracted every module into
its own file and rewrote it; it is complete as of 2026-09-14.

---

## Layout

There is no build step. Files load exactly as `manifest.json` and `player.html` list them.

| Path | Role |
|---|---|
| `manifest.json` | Permissions, content scripts, web-accessible resources |
| `background.js` | Service worker: detects third-party extensions, prevents duplicate player tabs |
| `content.js`, `gqltoken.js`, `autoclaim.js` | Content scripts on twitch.tv: redirect button, GraphQL integrity token, channel points |
| `content_injection.js`, `gql_injection.js` | Run in the Twitch page context (token capture) |
| `player.html` | The player page; its `<script defer>` list is the load order |
| `common.js` | Shared helpers and constants, `m_Log`, `m_Settings`, the settings key migration (the only intentional Cyrillic) |
| `player.js` | Shared constants, `Segment`, the segment queue `g_maQueue`, `NumberInput`, `Terminate` — no module lives here any more |
| `modules/*.js` | One IIFE module per file (`const m_Name = (() => { … })()`) |
| `worker.js` | MPEG-TS demux → fMP4 mux, off the main thread |
| `wasm.wasm`, `asmjs.js` | Start-code search for the worker (WebAssembly, asm.js fallback). **`wasm.wasm` is binary — never edit it** |
| `sidebar.js`, `channelbar.js` | Followed/live channels and the channel bar; `sidebar.js` reads the auth cookie itself and never calls into `m_Twitch`, so a failure there cannot take the player down |
| `modules/videos.js`, `videos.css` | The channel's Videos view: past broadcasts, highlights, uploads and clips, played in a second `<video>` (Chrome plays Twitch's VOD playlists natively, clips are MP4) while the live `#eye` is only restyled into a draggable corner miniature — never moved in the DOM, which would pause it |
| `player.css`, `glass.css`, `sidebar.css` | `glass.css` changes colour, radius, blur and type only — never geometry the scripts measure |
| `_locales/{en,ru}/messages.json` | UI strings |
| `tests/` | Headless unit tests (`*.test.js`) and mutation self-tests (`*-selftest.js`) |
| `tools/` | Verification tooling — see below |
| `player-english-translating-test.js`, `Documentation/Translation/` | **Not loaded.** Old reference copies |

### The media path

```
m_Playlist ── variant list, segment list (two loops during an ad break) ──► g_maQueue
m_Downloader ── downloads queued segments, N at a time ──────────────────► g_maQueue
m_Transcoder ── MPEG-TS → worker.js ; fMP4 passes through with m_InitSegment
m_Player ── appends to MediaSource, decides when to play, seek, replay
m_Controls ── keyboard, clicks, broadcast state (data-state on <body>)
```

Modules talk through direct calls and through `m_Events` (`SendEvent` / `AddHandler`). Event names
are plain strings: `tools/rename/eventcheck.js` pairs every sender with a listener.

---

## Verifying a change

**`py -3.14 tools/harness/verify.py`** runs everything and stops at the first failure:

| # | Step | What it proves |
|---|---|---|
| 1 | syntax | every loaded script parses; JSON files parse |
| 2–3 | cross-check + self-test | every DOM id, class and message key referenced exists (compared to an accepted reference) |
| 4–5 | events + self-test | every `SendEvent` has an `AddHandler` and vice versa, no blind spots |
| 6 | construction order | nothing is used during load before it is defined; no module calls another one while being built, except `m_Log` / `m_Events` |
| 7 | extraction self-test | the extraction tool still refuses what it must |
| 8 | unit tests | `tests/*.test.js`, `tests/*-selftest.js` (a silent file counts as a failure) |
| 9 | worker bytes | `worker.js` in the tree against the last commit, on captured real segments, byte for byte, WebAssembly and asm.js |
| 10 | live channel | a channel that is really live (pass candidates with `--chaines a,b,c`) |
| 11–13 | console, playback, fullscreen | zero errors, frames decoded, layout |
| 14 | settings | every settings control responds (compared to an accepted reference) |

`--statique` runs steps 1–9 without a browser. Known defect kept in the settings reference:
the audio-device access button needs a human click on a browser permission prompt.

**Changing a module** — `py -3.14 tools/harness/modulecheck.py <module> --chaine <channel> --cache`
runs `tools/harness/probes/<module>.js` in the real player and prints verdicts. Every module has a
probe, or a headless unit test in `tests/` (`m_Log`, `m_Settings`, `m_Events`, `m_GarbageCollector`,
`m_Twitch`) — except `modules/startup.js`, the launcher, which every playback step exercises. The
discipline used throughout phase 2:
1. write or extend the probe from what the module must do, before touching it;
2. run it on the current module — that is the reference;
3. break the module on purpose and check the probe notices;
4. change the module and require identical verdicts, line for line.
Probe details must not vary between runs (no timestamps, no measured sizes).

**Changing `worker.js`** — capture segments once with
`py -3.14 tools/worker/tscapture.py --chaine <live channel>` (they stay out of git), then
`node tools/worker/workercheck.js --fixtures tools/worker/fixtures/<channel>` compares every byte the
worker sends back. A one-byte mistake in an MP4 box corrupts the picture and raises nothing.

**Moving code between files** — `node tools/extract/extract.js <m_Module>` extracts one module into
`modules/`, updates `player.html`, refuses a dirty tree, and verifies the move is pure;
`node tools/extract/extractcheck.js --base HEAD~1 --head HEAD` re-checks a committed move.

**Long playback** — `py -3.14 tools/harness/admeasure.py <channel> <minutes>` measures frames,
drops, freezes, buffer and CPU over time. It flags a busy machine; compare only runs on the same
variant (Twitch's own frame rate differs between qualities).

---

## Gotchas

1. **No bundler, no ES modules, no `eval`/`new Function`** (MV3 CSP). Plain classic scripts sharing
   one global scope per page, loaded with `defer`.
2. **Microtasks scheduled during load run before the next deferred script.** Anything a
   `then`/`queueMicrotask` callback touches at load time must already be defined.
3. **Finished media buffers are detached, not dropped** — `m_GarbageCollector` posts them to a closed
   `MessagePort`. Letting them fall to the garbage collector makes memory saw-tooth on long sessions.
4. **Two container paths.** MPEG-TS goes through `worker.js`; fMP4 (CMAF) skips it and uses the
   `#EXT-X-MAP` initialisation segment (`m_InitSegment`) and the playlist's `CODECS`. `#EXT-X-MAP`
   is not encryption — only `#EXT-X-KEY` with a method other than `NONE` is (`J0219`).
5. **Twitch serves its variant list in a rotating order.** `m_Twitch.sortVariantList` sorts it by
   bitrate; quality selection and the quality menu both depend on that order.
6. **Inside the playlist parser, a failing `Check` is swallowed** — only `reject()` makes a list
   unusable. An unsupported tag is silently ignored.
7. **A changed initialisation segment must force a discontinuity**, even when nothing else changes —
   the two ad-bypass streams each have their own, and mixing them leaves a black picture.
8. **Hidden characters are part of the output.** Some separators are U+2002 (en space), not a
   space; write them as `\u2002` so a copy cannot silently replace them.
9. **`worker.js` has no DOM and no `chrome.*`.** It talks to the page only through the message kinds
   `m_Transcoder` reads (segment, log records, crash report, stop message, buffer to discard).
10. **While the Videos view is open, the live shortcuts step aside.** `m_Controls` lets every key
    but Escape through and ignores the wheel and middle click, so they act on the video being watched.
11. **Channel points are claimed through GraphQL** once a minute alongside minute-watched
    (`m_Twitch.claimBonusChest`); `autoclaim.js` only covers twitch.tv pages. Pages after the first of
    a video list, and the claim itself, need the integrity token.
12. **UI text goes through `_locales/*/messages.json`** and `data-i18n` attributes, never hard-coded.

---

## Open points waiting for Luca

- **Comment language.** Identifiers are English everywhere. Comments are not consistent: `m_Twitch`
  and the first rewritten peripheral modules are commented in English, most media modules and
  `worker.js` in French. Pick one and harmonise.
- **The ad-free fallback stream** (`ListUpdatesWithoutAds` in `modules/playlist.js`) still has the
  shape of an investigation: it clears the ad flag on every segment it receives, and writes a
  `console.error` when it fails.
- **`LoadSegment` in `modules/downloader.js`** tests `pReason.sReason` for 404/410 on a plain string,
  so that branch never runs. Kept as it behaves; fixing it changes what happens to a vanished segment.
- **`QuartileNumber`** in the ad log line has never been filled and prints `undefined`.
