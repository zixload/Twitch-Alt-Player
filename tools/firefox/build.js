'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '../..');

function transformManifest(original) {
  const manifest = structuredClone(original);
  delete manifest.minimum_chrome_version;
  delete manifest.declarative_net_request;
  delete manifest.optional_permissions;
  manifest.incognito = 'spanning';
  manifest.name = 'Twitch Alt Player — Firefox / Zen';
  manifest.version = '2025.5.28.2';
  // Gecko MV3 forbids relaxing CSP and X-Frame-Options via webRequest.
  // MV2 keeps these changes scoped to this extension's embedded Twitch chat.
  manifest.manifest_version = 2;
  manifest.permissions = ['storage', 'cookies', 'management', 'tabs', 'webRequest', 'webRequestBlocking', ...original.host_permissions];
  delete manifest.host_permissions;
  manifest.content_security_policy = original.content_security_policy.extension_pages;
  manifest.web_accessible_resources = original.web_accessible_resources.flatMap(group => group.resources);
  manifest.background = { scripts: ['firefox/network.js', 'firefox/api-host.js', 'background.js'], persistent: true };
  manifest.browser_specific_settings = {
    gecko: { id: 'twitch-alt-player@local', strict_min_version: '140.0', data_collection_permissions: { required: ['none'] } }
  };
  return manifest;
}

function replaceRequired(source, before, after) {
  if (!source.includes(before)) throw new Error(`Source changed; cannot apply Firefox patch: ${before.slice(0, 90)}`);
  return source.replaceAll(before, after);
}

function transformScript(file, source) {
  if (file === 'common.js') {
    source = replaceRequired(source,
      'Number(/Chrome\\/(\\d+)/.exec(navigator.userAgent)[1])',
      '(navigator.userAgent.match(/Chrome\\/(\\d+)/)?.[1] ? Number(navigator.userAgent.match(/Chrome\\/(\\d+)/)[1]) : Number.MAX_SAFE_INTEGER)');
  }
  if (file === 'modules/startup.js') {
    source = replaceRequired(source, '  if (navigator.userAgent.includes("Gecko/")) {\n    m_Debug.FinishWorkAndShowMessage("J0204");\n  }', '  // Gecko uses the Firefox manifest and bundled secondary HLS player.');
  }
  if (file === 'background.js') {
    source = replaceRequired(source, '`chrome-extension://${chrome.runtime.id}/player.html`', "chrome.runtime.getURL('player.html')");
    // The Firefox manifest drops declarativeNetRequest: firefox/network.js cuts Twitch's own player.
    source = replaceRequired(source, 'function blockTwitchPlayer(nTabId, bBlock) {\n',
      'function blockTwitchPlayer(nTabId, bBlock) {\n\treturn FirefoxNetwork.blockTwitchPlayer(nTabId, bBlock);\n}\n\nfunction blockTwitchPlayerWithRules(nTabId, bBlock) {\n');
    source = replaceRequired(source, "chrome.tabs.onRemoved.addListener((nTabId) => {\n\tblockTwitchPlayer(nTabId, false).catch(() => {});\n});\n", '');
    source = source.replaceAll('chrome.', 'browser.');
  }
  if (['modules/rewind.js', 'modules/videos.js', 'modules/preview.js'].includes(file)) {
    source = replaceRequired(source, '_elVideo.src = sPlayable;', 'FirefoxMedia.setSource(_elVideo, sPlayable);');
    source = replaceRequired(source, '_elVideo.removeAttribute("src");', 'FirefoxMedia.release(_elVideo);\n      _elVideo.removeAttribute("src");');
  }
  if (file === 'embedhost.js') {
    // Firefox does not tell the background which tab a framed extension page lives in: the page,
    // whose content script it does know, passes its tab id to the player in the frame address.
    source = replaceRequired(source, '\tfunction playerAddress(sChannel) {\n\t\treturn GetOurPlayerAddress(sChannel);\n\t}\n',
      "\tlet _nTabId = NaN;\n\tbrowser.runtime.sendMessage({ sQuery: 'FirefoxWhoAmI' }).then((n) => { _nTabId = n; }, () => {});\n\n" +
      "\tfunction playerAddress(sChannel) {\n\t\treturn GetOurPlayerAddress(sChannel) + (Number.isSafeInteger(_nTabId) ? `&tab=${_nTabId}` : '');\n\t}\n");
  }
  if (file === 'modules/audio-device.js') {
    source = replaceRequired(source, '    m_Log.Wow("[AudioDevices] Requesting contentSettings permission");',
      `    if (!chrome.contentSettings) {
      if (!navigator.mediaDevices.selectAudioOutput) {
        m_Log.Oops('[AudioDevices] Audio output selection is not available');
        return;
      }
      navigator.mediaDevices.selectAudioOutput()
        .then(device => _elVideo.setSinkId(device.deviceId))
        .then(Refresh)
        .catch(reason => m_Log.Oops('[AudioDevices] ' + reason));
      return;
    }
    m_Log.Wow("[AudioDevices] Requesting contentSettings permission");`);
  }
  return source;
}

function build(destination = path.resolve(ROOT, '../Twitch-No-Ads-integre-Firefox-Zen')) {
  destination = path.resolve(destination);
  if (destination === ROOT || ROOT.startsWith(destination + path.sep)) throw new Error('Unsafe output directory');
  fs.mkdirSync(destination, { recursive: true });
  // Whitelist shipped assets: never copy development browser profiles or generated Chrome metadata.
  for (const entry of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (entry.isFile() && (/\.(?:js|css|html|svg|png|wasm)$/.test(entry.name) || entry.name === 'LICENSE') && entry.name !== 'player-english-translating-test.js') {
      const source = path.join(ROOT, entry.name), target = path.join(destination, entry.name);
      if (entry.name.endsWith('.js')) fs.writeFileSync(target, transformScript(entry.name, fs.readFileSync(source, 'utf8')));
      else fs.copyFileSync(source, target);
    }
  }
  for (const folder of ['modules', '_locales', 'firefox']) {
    fs.rmSync(path.join(destination, folder), { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, folder), path.join(destination, folder), { recursive: true });
  }
  for (const locale of fs.readdirSync(path.join(destination, '_locales'))) {
    const file = path.join(destination, '_locales', locale, 'messages.json');
    fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')), null, 2) + '\n');
  }
  for (const entry of fs.readdirSync(path.join(ROOT, 'modules'))) {
    if (entry.endsWith('.js')) fs.writeFileSync(path.join(destination, 'modules', entry), transformScript(`modules/${entry}`, fs.readFileSync(path.join(ROOT, 'modules', entry), 'utf8')));
  }
  const manifest = transformManifest(JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')));
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  const html = fs.readFileSync(path.join(destination, 'player.html'), 'utf8');
  fs.writeFileSync(path.join(destination, 'player.html'), replaceRequired(html, '<script src=modules/i18n.js defer>', '<script src=firefox/api-bridge.js defer></script>\n<script src=firefox/vendor/hls.min.js defer></script>\n<script src=firefox/media.js defer></script>\n<script src=modules/i18n.js defer>'));
  fs.copyFileSync(path.join(ROOT, 'firefox/INSTALLATION.md'), path.join(destination, 'README.md'));
  return destination;
}

module.exports = { transformManifest, transformScript, build };
if (require.main === module) console.log(build(process.argv[2]));
