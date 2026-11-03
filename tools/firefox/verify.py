"""Real Zen/Firefox integration test. Uses a separate profile and test-only copy.

python tools/firefox/verify.py --browser <zen.exe> --driver <geckodriver.exe>
Requires selenium. No installed extensions, settings or personal sessions are changed.
"""
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
parser.add_argument('--channel', default='caedrel', help='A channel currently broadcasting with a public recording')
parser.add_argument('--report', type=Path, default=Path(__file__).with_name('verification.json'))
parser.add_argument('--work-dir', type=Path, default=Path(os.environ.get('TMPDIR', Path.home() / 'AppData/Local/hermes/cache/scratch')))
args = parser.parse_args()
args.work_dir.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='twitch-zen-', dir=args.work_dir))
source = work / 'extension'
shutil.copytree(args.source, source)
# This probe exists only in the isolated test package, never in the delivered XPI.
(source / 'firefox/test-probe.js').write_text('''
document.addEventListener('firefox-test', () => {
 const command = document.documentElement.dataset.testCommand;
 if (command === 'videos') m_Videos.Open();
 if (command === 'rewind') m_Rewind.PlayAt(60);
 if (command === 'rewind-stop') m_Rewind.Stop();
});
''', encoding='utf8')
html = source / 'player.html'
html.write_text(html.read_text(encoding='utf8').replace('<script src=channelbar.js defer></script>', '<script src=channelbar.js defer></script><script src=firefox/test-probe.js defer></script>'), encoding='utf8')
xpi = work / 'test.xpi'
with zipfile.ZipFile(xpi, 'w', zipfile.ZIP_DEFLATED) as archive:
    for file in source.rglob('*'):
        if file.is_file():
            archive.write(file, file.relative_to(source).as_posix())
options = Options()
options.binary_location = args.browser
options.page_load_strategy = 'eager'
options.add_argument('-headless')
profile = work / 'profile'
profile.mkdir()
options.add_argument('-profile')
options.add_argument(str(profile))
options.set_preference('browser.shell.checkDefaultBrowser', False)
options.set_preference('media.autoplay.default', 0)
options.set_preference('media.autoplay.blocking_policy', 0)
service = Service(args.driver, service_args=['--allow-system-access'], log_output=str(work / 'geckodriver.log'))
driver = webdriver.Firefox(options=options, service=service)
driver.set_page_load_timeout(40)
results = {'user_agent': driver.capabilities.get('userAgent'), 'browser_version': driver.capabilities['browserVersion'], 'work_directory': str(work)}

def video_state(element_id):
    return driver.execute_script('''const v=document.getElementById(arguments[0]);
    return v && {time:v.currentTime, frames:v.getVideoPlaybackQuality().totalVideoFrames,
      width:v.videoWidth, hidden:v.hidden, paused:v.paused, error:v.error?.message || null};''', element_id)

def wait_playback(element_id):
    deadline = time.monotonic() + 35
    state = None
    while time.monotonic() < deadline:
        time.sleep(2)
        state = video_state(element_id)
        if state and state['frames'] > 100 and not state['paused']:
            print(element_id, json.dumps(state), flush=True)
            return state
    raise AssertionError(f'{element_id}: no playback: {state}')

def command(value):
    driver.execute_script("document.documentElement.dataset.testCommand=arguments[0]; document.dispatchEvent(new Event('firefox-test'));", value)

try:
    addon_id = driver.install_addon(str(xpi), temporary=True)
    driver.set_context('chrome')
    root = driver.execute_script('return WebExtensionPolicy.getByID(arguments[0]).getURL("")', addon_id)
    driver.set_context('content')
    # Zen's initial automation placeholder is not a browser tab (getCurrent: Invalid tab ID -1).
    driver.switch_to.new_window('tab')
    driver.get(root + 'player.html?channel=' + args.channel)
    results['live'] = wait_playback('eye')
    first_time = results['live']['time']
    time.sleep(2)
    assert video_state('eye')['time'] > first_time, 'Live playback is frozen'
    command('rewind')
    results['rewind'] = wait_playback('rewind')
    assert results['rewind']['time'] >= 60, 'Recording did not seek to the requested position'
    command('rewind-stop')
    command('videos')
    time.sleep(5)
    cards = driver.find_elements('css selector', '[data-video-id]')
    assert cards, 'No VOD cards were loaded'
    results['video_cards'] = len(cards)
    cards[0].click()
    results['vod'] = wait_playback('videos-video')
    # Close the original player first: the background deliberately prevents duplicate channels.
    driver.close()
    driver.switch_to.window(driver.window_handles[0])
    driver.switch_to.new_window('tab')
    driver.get('https://www.twitch.tv/' + args.channel)
    deadline = time.monotonic() + 30
    while time.monotonic() < deadline and not driver.current_url.startswith(root):
        time.sleep(1)
    results['twitch_entry_url'] = driver.current_url
    assert driver.current_url.startswith(root + 'player.html'), 'Twitch content script did not redirect'
    results['twitch_entry_playback'] = wait_playback('eye')
    driver.set_context('chrome')
    errors = driver.execute_script('return Services.console.getMessageArray().map(m=>m.message).filter(m=>m.includes("JavaScript Error") && m.includes("moz-extension://"))')
    results['extension_errors'] = errors
    assert not errors, errors
    results['passed'] = True
    print('PASS: live, rewind, VOD, Twitch redirect, extension console', flush=True)
finally:
    args.report.parent.mkdir(parents=True, exist_ok=True)
    args.report.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding='utf8')
    driver.quit()
