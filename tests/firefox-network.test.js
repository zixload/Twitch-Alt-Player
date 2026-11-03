'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.resolve(__dirname, '../firefox/network.js');
function load() {
  assert.ok(fs.existsSync(file), 'Firefox network bridge is missing');
  const hooks = {};
  const context = vm.createContext({ URL, Promise, Set, browser: {
    runtime: { getURL: () => 'moz-extension://local-uuid/' },
    tabs: { onRemoved: { addListener(fn) { hooks.tabRemoved = fn; } } },
    webRequest: Object.fromEntries(['onBeforeSendHeaders','onHeadersReceived','onBeforeRequest'].map(name => [name, { addListener(fn, filter, extra) { hooks[name] = fn; } }]))
  }});
  vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  hooks.network = context.FirefoxNetwork;
  return hooks;
}
test('Only extension requests receive Twitch Origin and Referer, with no duplicates', () => {
  const hooks = load();
  const result = hooks.onBeforeSendHeaders({ originUrl: 'moz-extension://local-uuid/player.html', requestHeaders: [
    { name: 'Origin', value: 'null' }, { name: 'Referer', value: 'wrong' }, { name: 'Client-ID', value: 'test' }
  ] });
  assert.equal(result.requestHeaders.filter(h => h.name.toLowerCase() === 'origin').length, 1);
  assert.equal(result.requestHeaders.find(h => h.name.toLowerCase() === 'origin').value, 'https://www.twitch.tv');
  assert.equal(result.requestHeaders.find(h => h.name === 'Client-ID').value, 'test');
  assert.equal(hooks.onBeforeSendHeaders({ originUrl: 'https://example.com/', requestHeaders: [] }), undefined);
});
test('Frame restrictions are stripped only for Twitch chat embedded by the extension', () => {
  const hook = load().onHeadersReceived;
  const responseHeaders = [{ name: 'content-security-policy', value: "frame-ancestors 'self'" }, { name: 'X-Frame-Options', value: 'DENY' }, { name: 'Content-Type', value: 'text/html' }];
  const result = hook({ url: 'https://www.twitch.tv/popout/test/chat?popout=', originUrl: 'moz-extension://local-uuid/player.html', responseHeaders });
  assert.deepEqual(Array.from(result.responseHeaders, h => h.name), ['Content-Type']);
  assert.equal(hook({ url: 'https://www.twitch.tv/test', originUrl: 'moz-extension://local-uuid/player.html', responseHeaders }), undefined);
  assert.equal(hook({ url: 'https://www.twitch.tv/popout/test/chat', originUrl: 'https://example.com', responseHeaders }), undefined);
});
test('The live stream Twitch requests for itself is cut only in tabs where our player plays, never our requests', () => {
  const hooks = load();
  const usher = 'https://usher.ttvnw.net/api/channel/hls/test.m3u8?sig=x';
  const segment = 'https://video-edge-1.abs.hls.ttvnw.net/v1/segment/abc.ts';
  const thumbnail = 'https://dgeft87wbj63p.cloudfront.net/abc_x_1_2/storyboards/123-low-0.jpg';
  const twitch = { tabId: 7, originUrl: 'https://www.twitch.tv/test' };
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: usher }), undefined);
  hooks.network.blockTwitchPlayer(7, true);
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: usher }).cancel, true);
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: segment }).cancel, true);
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: thumbnail }), undefined);
  assert.equal(hooks.onBeforeRequest({ tabId: 7, originUrl: 'moz-extension://local-uuid/player.html', url: usher }), undefined);
  assert.equal(hooks.onBeforeRequest({ tabId: 8, originUrl: 'https://www.twitch.tv/test', url: usher }), undefined);
  hooks.tabRemoved(7);
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: usher }), undefined);
});
test('A Twitch VOD is cut too while our player plays it; its thumbnails are not', () => {
  const hooks = load();
  const twitch = { tabId: 3, originUrl: 'https://www.twitch.tv/videos/123' };
  hooks.network.blockTwitchPlayer(3, true);
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: 'https://dgeft87wbj63p.cloudfront.net/abc_strogo_1_2/1080p60/index-dvr.m3u8' }).cancel, true);
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: 'https://dgeft87wbj63p.cloudfront.net/abc_strogo_1_2/1080p60/0.mp4' }).cancel, true);
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: 'https://usher.ttvnw.net/vod/123.m3u8?sig=x' }).cancel, true);
  assert.equal(hooks.onBeforeRequest({ ...twitch, url: 'https://dgeft87wbj63p.cloudfront.net/abc_strogo_1_2/storyboards/123-info.json' }), undefined);
  assert.equal(hooks.onBeforeRequest({ tabId: 3, originUrl: 'moz-extension://local-uuid/player.html', url: 'https://dgeft87wbj63p.cloudfront.net/abc_strogo_1_2/1080p60/0.mp4' }), undefined);
});
