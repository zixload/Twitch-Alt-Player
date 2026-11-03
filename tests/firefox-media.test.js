'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const file = path.resolve(__dirname, '../firefox/media.js');
function setup() {
  assert.ok(fs.existsSync(file), 'Firefox HLS adapter is missing');
  const instances = [];
  class Hls {
    static isSupported() { return true; }
    static Events = { ERROR: 'error' };
    constructor(config) { this.config = config; instances.push(this); }
    attachMedia(video) { this.video = video; video.src = 'blob:media-source'; }
    loadSource(url) { this.url = url; }
    on() {}
    destroy() { this.destroyed = true; }
  }
  const context = vm.createContext({ Hls, console });
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\nglobalThis.adapter = FirefoxMedia;', context);
  return { adapter: context.adapter, instances };
}
test('HLS playlists and closed playlist blobs use the local HLS engine; MP4 remains native', () => {
  const { adapter, instances } = setup();
  const video = { canPlayType: () => '', src: '' };
  adapter.setSource(video, 'https://example.com/index.m3u8?token=1');
  assert.equal(instances[0].url, 'https://example.com/index.m3u8?token=1');
  assert.equal(instances[0].config.enableWorker, false);
  adapter.setSource(video, 'blob:closed-playlist');
  assert.equal(instances[0].destroyed, true);
  assert.equal(instances[1].url, 'blob:closed-playlist');
  adapter.setSource(video, 'https://example.com/clip.mp4');
  assert.equal(instances[1].destroyed, true);
  assert.equal(video.src, 'https://example.com/clip.mp4');
});
test('Stopping one secondary video destroys only its own HLS engine', () => {
  const { adapter, instances } = setup();
  const a = { canPlayType: () => '' }, b = { canPlayType: () => '' };
  adapter.setSource(a, 'https://example.com/a.m3u8');
  adapter.setSource(b, 'https://example.com/b.m3u8');
  adapter.release(a);
  adapter.release(a);
  assert.equal(instances[0].destroyed, true);
  assert.notEqual(instances[1].destroyed, true);
});
