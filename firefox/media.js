'use strict';
// Firefox has MSE but does not play Twitch HLS manifests directly in <video>.
// Keep the live remuxer unchanged; only secondary videos use the bundled engine.
const FirefoxMedia = (() => {
  const engines = new WeakMap();
  function release(video) {
    const engine = engines.get(video);
    if (engine) {
      engines.delete(video);
      engine.destroy();
    }
  }
  function setSource(video, url) {
    release(video);
    if ((/\.m3u8(?:\?|$)/i.test(url) || url.startsWith('blob:')) && !video.canPlayType('application/vnd.apple.mpegurl') && Hls.isSupported()) {
      const engine = new Hls({ enableWorker: false, maxBufferLength: 30, backBufferLength: 30 });
      engines.set(video, engine);
      engine.on(Hls.Events.ERROR, (event, data) => {
        if (data.fatal) {
          console.error('[Firefox HLS]', data.type, data.details);
          release(video);
          video.dispatchEvent(new Event('error'));
        }
      });
      engine.attachMedia(video);
      engine.loadSource(url);
    } else {
      video.src = url;
    }
  }
  return { setSource, release };
})();
