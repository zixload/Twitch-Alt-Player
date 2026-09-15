# Twitch-No-Ads

A Chrome extension that replaces the Twitch player with its own.

## What it does

- **Skips ads** — plays the stream through a second playlist Twitch serves without the stitched-in ads.
- **Videos tab** — browse a channel's past broadcasts, highlights, uploads and clips while the live
  stream keeps playing in a corner. Pick the quality; subscriber-only videos play too.
- **Claims channel points** — the bonus chest is collected on its own while you watch.
- **Diagnostics overlay** — press `S` for live stream stats.
- Chat panel, followed/live sidebar, follow and clip buttons, replay of the buffered stream.

## Install

Open `chrome://extensions`, turn on Developer mode, and use **Load unpacked** on this folder.

## How it works

Manifest V3, plain JavaScript, no build step. HLS through Media Source Extensions; MPEG-TS segments
are remuxed to fMP4 in a Web Worker (WebAssembly, asm.js fallback), fMP4 segments play as they are.
`tools/` holds the scripts that verify a change — static checks, unit tests, and a harness that
drives Chrome to test the running extension.

Sub-only video access reuses the method from [TwitchNoSub](https://github.com/besuper/TwitchNoSub).

## License

Fork of Alexander Choporov's (CoolCmd) player. BSD 3-Clause, see [LICENSE](LICENSE).
