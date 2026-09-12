# Twitch Alternate Player

**Work in progress.**

A Chrome extension that replaces the Twitch video player with its own.

The codebase started out with every name in Russian — variables, functions, element ids,
comments. It is being translated to English and reworked, fixing what breaks along the way.

## Technology

- Chrome extension, Manifest V3, plain JavaScript: no build step, no runtime dependencies.
- HLS playback through Media Source Extensions. MPEG-TS segments are remuxed to fMP4 in a Web
  Worker backed by WebAssembly; fMP4 segments are appended as they are.
- `tools/`: Node scripts that rename identifiers through a JavaScript parser and check that
  scripts, markup and stylesheets still agree on every name; Python scripts that drive Chrome over
  the DevTools protocol to test the running extension.

## Trying it

Open `chrome://extensions`, enable Developer mode, and load this directory as an unpacked
extension.

## License

BSD 3-Clause, see [LICENSE](LICENSE).
