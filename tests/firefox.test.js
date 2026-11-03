'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const builderPath = path.join(root, 'tools/firefox/build.js');

test('Firefox build provides an event background and only supported permissions', () => {
  assert.ok(fs.existsSync(builderPath), 'Firefox build tool is missing');
  const { transformManifest } = require(builderPath);
  const original = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json')));
  const manifest = transformManifest(original);
  assert.equal(manifest.manifest_version, 2, 'Firefox MV3 refuses removal of Twitch framing restrictions');
  assert.deepEqual(manifest.background, { scripts: ['firefox/network.js', 'firefox/api-host.js', 'background.js'], persistent: true });
  assert.ok(!manifest.host_permissions);
  for (const host of original.host_permissions) assert.ok(manifest.permissions.includes(host));
  assert.equal(typeof manifest.content_security_policy, 'string');
  assert.ok(manifest.web_accessible_resources.includes('player.html'));
  assert.ok(manifest.web_accessible_resources.every(resource => typeof resource === 'string'));
  assert.ok(!manifest.permissions.some(p => ['system.memory', 'system.cpu', 'declarativeNetRequest'].includes(p)));
  assert.ok(manifest.permissions.includes('webRequestBlocking'));
  assert.ok(manifest.permissions.includes('tabs'));
  assert.ok(!manifest.optional_permissions?.includes('contentSettings'));
  assert.ok(!manifest.declarative_net_request);
  assert.equal(manifest.browser_specific_settings.gecko.id, 'twitch-alt-player@local');
  assert.equal(original.background.service_worker, 'background.js', 'Chrome manifest must not be modified');
});

test('Firefox and Zen do not crash on missing Chromium user-agent fields', () => {
  const builder = require(builderPath);
  assert.equal(typeof builder.transformScript, 'function', 'Firefox script transformer is missing');
  const source = builder.transformScript('common.js', fs.readFileSync(path.join(root, 'common.js'), 'utf8'));
  const fn = source.slice(source.indexOf('function getBrowserEngineVersion()'), source.indexOf('function isMobileDevice()'));
  for (const userAgent of ['Mozilla/5.0 Gecko/20100101 Firefox/158.0', 'Some browser']) {
    const context = vm.createContext({ navigator: { userAgent } });
    vm.runInContext(fn, context);
    assert.ok(vm.runInContext('getBrowserEngineVersion()', context) >= 92);
  }
  const context = vm.createContext({ navigator: { userAgent: 'Chrome/130.0.0.0' } });
  vm.runInContext(fn, context);
  assert.equal(vm.runInContext('getBrowserEngineVersion()', context), 130);
});

test('Firefox package wires HLS for secondary videos and preserves all Chrome files', () => {
  const { build } = require(builderPath);
  assert.equal(typeof build, 'function', 'Firefox packager is missing');
  const os = require('node:os');
  const temp = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'twitch-firefox-test-'));
  try {
    const before = fs.readFileSync(path.join(root, 'manifest.json'), 'utf8');
    fs.mkdirSync(path.join(temp, 'firefox'), { recursive: true });
    fs.writeFileSync(path.join(temp, 'firefox/test-probe.js'), '// Stale diagnostics must never ship');
    build(temp);
    assert.ok(!fs.existsSync(path.join(temp, 'firefox/test-probe.js')), 'Build must remove stale diagnostic files');
    assert.equal(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'), before);
    const html = fs.readFileSync(path.join(temp, 'player.html'), 'utf8');
    assert.ok(html.indexOf('firefox/vendor/hls.min.js') < html.indexOf('modules/rewind.js'));
    for (const name of ['rewind','videos','preview']) {
      const source = fs.readFileSync(path.join(temp, 'modules', `${name}.js`), 'utf8');
      assert.ok(source.includes('FirefoxMedia.setSource(_elVideo, sPlayable)'));
      assert.ok(source.includes('FirefoxMedia.release(_elVideo)'));
      assert.ok(!source.includes('_elVideo.src = sPlayable'));
    }
    const bg = fs.readFileSync(path.join(temp, 'background.js'), 'utf8');
    assert.ok(!bg.includes('chrome-extension://'));
    assert.ok(bg.includes("browser.runtime.getURL('player.html')"));
    const audio = fs.readFileSync(path.join(temp, 'modules/audio-device.js'), 'utf8');
    assert.ok(audio.includes('navigator.mediaDevices.selectAudioOutput()'));
    assert.ok(!fs.existsSync(path.join(temp, 'tools')));
    assert.ok(!fs.existsSync(path.join(temp, '_metadata')));
    const startup = fs.readFileSync(path.join(temp, 'modules/startup.js'), 'utf8');
    assert.ok(!startup.includes('navigator.userAgent.includes("Gecko/")'), 'Original player explicitly refuses Gecko');
    const rawLocales = fs.readFileSync(path.join(temp, '_locales/en/messages.json'), 'utf8');
    assert.equal((rawLocales.match(/"A0926"\s*:/g) || []).length, 1, 'Firefox rejects duplicate translation keys');
    for (const match of html.matchAll(/<script src=([^\s>]+)/g)) assert.ok(fs.existsSync(path.join(temp, match[1])), match[1]);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});
