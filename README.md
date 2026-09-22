# Twitch-Alt-Player

A Chrome extension that replaces the Twitch player with its own: no ads, and a timeline that runs
from the start of the broadcast instead of the last few minutes.

## What it does

### Move around inside a live stream

Twitch gives you the live edge and nothing else. Here the seek bar covers the whole broadcast, from
the moment it started to right now.

- **Pause a live stream** and it stays paused, however long you stay away.
- **Seek anywhere in the broadcast**, including well before you arrived — back to its very first
  minute. The last few minutes come from what the browser is holding; beyond that, playback
  continues from the recording Twitch makes while the broadcast is running. Both sit on the same
  bar, so it is one move, not two players.
- **Hover the bar for a thumbnail** of that moment, with the time under it. Frames are fetched as
  you go and kept, so a second pass over the same stretch is instant.
- **One click back to the live edge.** The live stream keeps running, muted, behind the rewind, so
  coming back is immediate — no reload, no re-buffering.
- Pause, skip, speed and quality all address **what you are actually watching**, not the live
  stream you left behind.

This needs the channel to keep its broadcasts (most do). When a channel does not, the bar falls
back to what the browser holds — a few minutes.

### The rest

- **Skips ads** — plays the stream through a second playlist Twitch serves without the stitched-in
  ads.
- **Videos tab** — browse a channel's past broadcasts, highlights, uploads and clips while the live
  stream keeps playing in a corner. Pick the quality; subscriber-only videos play too.
- **Claims channel points** — the bonus chest is collected on its own while you watch.
- **Diagnostics overlay** — press `S` for live stream stats.
- Chat panel, followed/live sidebar, follow and clip buttons.

## Install

Open `chrome://extensions`, turn on Developer mode, and use **Load unpacked** on this folder.

## How it works

Manifest V3, plain JavaScript, no build step. HLS through Media Source Extensions; MPEG-TS segments
are remuxed to fMP4 in a Web Worker (WebAssembly, asm.js fallback), fMP4 segments play as they are.

Seeking past the live buffer uses a second video element on the same stage, fed by the in-progress
recording of the broadcast. Measured on three channels, that recording trails the live edge by zero
to five seconds and holds every segment from the first, which is what makes a single continuous bar
possible. Nothing on the live path is touched by it — not the buffer, not the remuxer, not the ad
bypass.

`tools/` holds the scripts that verify a change — static checks, unit tests, and a harness that
drives Chrome to test the running extension.

Sub-only video access reuses the method from [TwitchNoSub](https://github.com/besuper/TwitchNoSub).

## License

Fork of Alexander Choporov's (CoolCmd) player. BSD 3-Clause, see [LICENSE](LICENSE).
