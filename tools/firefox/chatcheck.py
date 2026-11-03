"""Regression test: Twitch live chat must render inside the Zen extension."""
from pathlib import Path
import argparse
import json
import os
import shutil
import tempfile
import time
import zipfile
from selenium import webdriver
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.firefox.service import Service

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--browser', required=True)
parser.add_argument('--driver', required=True)
parser.add_argument('--source', type=Path, default=Path(__file__).resolve().parents[3] / 'Twitch-No-Ads-Firefox-Zen')
parser.add_argument('--channel', default='caedrel')
parser.add_argument('--report', type=Path, default=Path(__file__).with_name('chat-verification.json'))
parser.add_argument('--work-dir', type=Path, required=True)
args = parser.parse_args()
args.work_dir.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='twitch-chat-', dir=args.work_dir))
source = work / 'extension'
shutil.copytree(args.source, source)
probe = '''
document.addEventListener('chat-test', () => {
 const mode = document.documentElement.dataset.chatMode;
 m_Settings.Change('bFullChat', mode === 'full');
 m_Chat.ApplyUrl();
 if (!document.getElementById('chat')) m_Chat.TogglePanelState();
});
setInterval(() => browser.storage.local.get('chatNetworkTrace').then(data => {
 document.documentElement.dataset.chatTrace = JSON.stringify(data.chatNetworkTrace || []);
 browser.storage.local.get(['networkRoot', 'networkApplied', 'networkSkip']).then(debug => document.documentElement.dataset.chatDebug = JSON.stringify(debug));
}), 1000);
'''
(source / 'firefox/chat-test.js').write_text(probe, encoding='utf8')
html = source / 'player.html'
html.write_text(html.read_text(encoding='utf8').replace('<script src=channelbar.js defer></script>', '<script src=channelbar.js defer></script><script src=firefox/chat-test.js defer></script>'), encoding='utf8')
network = source / 'firefox/network.js'
network_source = network.read_text(encoding='utf8').replace("const root = browser.runtime.getURL('');", "const root = browser.runtime.getURL(''); browser.storage.local.set({networkRoot:root});")
network_source = network_source.replace('    const url = new URL(details.url);', '    const url = new URL(details.url); browser.storage.local.set({networkSkip:{own:isOwnRequest(details),url:details.url}});')
network_source = network_source.replace('    return { responseHeaders:', '    browser.storage.local.set({networkApplied:details.url}); return { responseHeaders:')
network.write_text('''const chatNetworkTrace = [];
browser.webRequest.onHeadersReceived.addListener(details => {
 chatNetworkTrace.push({url: details.url, originUrl:details.originUrl, documentUrl:details.documentUrl,
   frameAncestors:details.frameAncestors, tabId:details.tabId, frameId:details.frameId, parentFrameId:details.parentFrameId,
   headers:details.responseHeaders.filter(h => ['x-frame-options','content-security-policy'].includes(h.name.toLowerCase()))});
 browser.storage.local.set({chatNetworkTrace});
}, {urls:['https://www.twitch.tv/*'], types:['sub_frame']}, ['responseHeaders']);
browser.webRequest.onResponseStarted.addListener(details => {
 chatNetworkTrace.push({phase:'processed', url:details.url, headers:details.responseHeaders.filter(h => ['x-frame-options','content-security-policy'].includes(h.name.toLowerCase()))});
 browser.storage.local.set({chatNetworkTrace});
}, {urls:['https://www.twitch.tv/*'], types:['sub_frame']}, ['responseHeaders']);
''' + network_source, encoding='utf8')
xpi = work / 'chat-test.xpi'
with zipfile.ZipFile(xpi, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in source.rglob('*'):
        if file.is_file(): archive.write(file, file.relative_to(source).as_posix())
options = Options()
options.binary_location = args.browser
options.page_load_strategy = 'eager'
options.add_argument('-headless')
profile = work / 'profile'
profile.mkdir()
options.add_argument('-profile')
options.add_argument(str(profile))
options.set_preference('media.autoplay.default', 0)
driver = webdriver.Firefox(options=options, service=Service(args.driver, service_args=['--allow-system-access'], log_output=str(work / 'geckodriver.log')))
driver.set_page_load_timeout(40)
results = {'work_directory': str(work), 'modes': []}
try:
    addon = driver.install_addon(str(xpi), temporary=True)
    driver.set_context('chrome')
    root = driver.execute_script('return WebExtensionPolicy.getByID(arguments[0]).getURL("")', addon)
    driver.set_context('content')
    driver.switch_to.new_window('tab')
    driver.get(root + 'player.html?channel=' + args.channel)
    time.sleep(6)
    for mode in ['full', 'embedded']:
        driver.execute_script("document.documentElement.dataset.chatMode=arguments[0]; document.dispatchEvent(new Event('chat-test'));", mode)
        time.sleep(18)
        trace = driver.execute_script('return document.documentElement.dataset.chatTrace')
        debug = driver.execute_script('return document.documentElement.dataset.chatDebug')
        frame = driver.find_element('id', 'chat')
        url = frame.get_attribute('src')
        driver.switch_to.frame(frame)
        state = driver.execute_script('''return {url:location.href, text:document.body.innerText.slice(0,2400),
          chat:!!document.querySelector('[data-a-target="chat-input"], [data-a-target="chat-room-component-layout"], .chat-room, .chat-scrollable-area__message-container'),
          messages:document.querySelectorAll('[data-a-target="chat-line-message"]').length};''')
        driver.switch_to.default_content()
        state.update(mode=mode, frame_url=url, network=json.loads(trace or '[]'), debug=json.loads(debug or '{}'))
        results['modes'].append(state)
        print(json.dumps(state, ensure_ascii=True), flush=True)
    driver.set_context('chrome')
    results['console'] = driver.execute_script('return Services.console.getMessageArray().map(m=>m.message).filter(m=>/frame|security|blocked|extension/i.test(m))')
    print('CONSOLE', json.dumps(results['console'], ensure_ascii=True), flush=True)
    assert all(state['chat'] and state['messages'] > 0 for state in results['modes']), 'Chat frame did not receive real Twitch messages'
    results['passed'] = True
    print('PASS: full and embedded live chat render in Zen', flush=True)
finally:
    args.report.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf8')
    driver.quit()
