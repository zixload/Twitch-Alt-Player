'use strict';
/*
	=== PORT DE TWITCHNOSUB — TEMPORAIRE, POUR RELECTURE ===

	Ce fichier reprend, dans ses propres termes, la resolution de VOD de TwitchNoSub
	(https://github.com/besuper/TwitchNoSub, src/patch_amazonworker.js) : reconstruire l'adresse des
	listes de segments d'une rediffusion a partir de son `seekPreviewsURL`, ce qui donne acces aux
	rediffusions reservees aux abonnes ET a chaque qualite separement.

	L'original patche le `fetch` du worker du lecteur Amazon IVS de twitch.tv. Ce lecteur n'existe pas
	ici : notre onglet Videos lit les rediffusions dans un <video> natif. La logique est donc la meme
	-- fetchTwitchDataGQL, createServingID, defaultResolutions, isValidQuality --, mais exposee comme
	une fonction que modules/videos.js appelle, `TwitchNoSub.resolveVodQualities(vodId)`, au lieu d'une
	interception de fetch.

	Volontairement laisse tel quel, en anglais et sous ses noms d'origine, pour que Luca puisse le
	comparer a l'amont et completer ce qui manque (le remplacement -unmuted -> -muted des vieilles
	VOD, notamment, que le lecteur natif ne peut pas appliquer par-dessus une lecture en cours).
*/
const TwitchNoSub = (() => {
  async function fetchTwitchDataGQL(vodID) {
    const resp = await fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      body: JSON.stringify({
        query: 'query { video(id: "' + vodID + '") { broadcastType, createdAt, seekPreviewsURL, owner { login } }}',
      }),
      headers: {
        'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
    });
    return resp.json();
  }

  function createServingID() {
    const w = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
    let id = '';
    for (let i = 0; i < 32; i++) {
      id += w[Math.floor(Math.random() * w.length)];
    }
    return id;
  }

  const defaultResolutions = (() => {
    const _defaultResolutions = {
      '160p30': { name: '160p', resolution: '284x160', frameRate: 30 },
      '360p30': { name: '360p', resolution: '640x360', frameRate: 30 },
      '480p30': { name: '480p', resolution: '854x480', frameRate: 30 },
      '720p60': { name: '720p60', resolution: '1280x720', frameRate: 60 },
      '1080p60': { name: '1080p60', resolution: '1920x1080', frameRate: 60 },
      '1440p60': { name: '1440p60', resolution: '2560x1440', frameRate: 60 },
      chunked: { name: 'Source', resolution: 'chunked', frameRate: 60 },
    };
    let sorted_dict = Object.keys(_defaultResolutions);
    sorted_dict = sorted_dict.reverse();
    const ordered_resolutions = {};
    for (const key in sorted_dict) {
      ordered_resolutions[sorted_dict[key]] = _defaultResolutions[sorted_dict[key]];
    }
    return ordered_resolutions;
  })();

  async function isValidQuality(url) {
    const response = await fetch(url, { cache: 'force-cache' });
    if (response.ok) {
      const data = await response.text();
      if (data.includes('.ts')) {
        // ts files should still use the h264
        return { codec: 'avc1.4D001E' };
      }
      if (data.includes('.mp4')) {
        // mp4 file use h265, but sometimes h264
        const mp4Request = await fetch(url.replace('index-dvr.m3u8', 'init-0.mp4'), { cache: 'force-cache' });
        if (mp4Request.ok) {
          const content = await mp4Request.text();
          return { codec: content.includes('hev1') ? 'hev1.1.6.L93.B0' : 'avc1.4D001E' };
        }
        return { codec: 'hev1.1.6.L93.B0' };
      }
    }
    return null;
  }

  /*
    La sortie que notre onglet Videos attend : une qualite par entree, la meilleure d'abord.
    { sKey, sName, sResolution, nFrameRate, sUrl }. Reconstruit exactement comme l'usher-403 de
    patch_amazonworker.js, mais en rendant les adresses au lieu d'un faux master m3u8.
  */
  async function resolveVodQualities(vodId) {
    const data = await fetchTwitchDataGQL(vodId);
    if (!data || !data?.data.video) {
      console.log('[TNS] Unable to fetch twitch data API');
      return [];
    }
    console.log(`[TNS] Found data for VOD ${vodId}`);
    const vodData = data.data.video;
    const channelData = vodData.owner;
    const currentURL = new URL(vodData.seekPreviewsURL);
    const domain = currentURL.host;
    const paths = currentURL.pathname.split('/');
    const vodSpecialID = paths[paths.findIndex((element) => element.includes('storyboards')) - 1];

    const now = new Date('2023-02-10');
    const created = new Date(vodData.createdAt);
    const time_difference = now.getTime() - created.getTime();
    const days_difference = time_difference / (1000 * 3600 * 24);
    const broadcastType = vodData.broadcastType.toLowerCase();

    const aoQualities = [];
    for (const [resKey, resValue] of Object.entries(defaultResolutions)) {
      let playlistUrl;
      if (broadcastType === 'highlight') {
        playlistUrl = `https://${domain}/${vodSpecialID}/${resKey}/highlight-${vodId}.m3u8`;
      } else if (broadcastType === 'upload' && days_difference > 7) {
        // Only old uploaded VOD works with this method now
        playlistUrl = `https://${domain}/${channelData.login}/${vodId}/${vodSpecialID}/${resKey}/index-dvr.m3u8`;
      } else {
        playlistUrl = `https://${domain}/${vodSpecialID}/${resKey}/index-dvr.m3u8`;
      }
      const result = await isValidQuality(playlistUrl);
      if (result) {
        console.log(`[TNS] Found quality ${resKey}`);
        aoQualities.push({
          sKey: resKey,
          sName: resValue.name,
          sResolution: resValue.resolution,
          nFrameRate: resValue.frameRate,
          sUrl: playlistUrl,
        });
      }
    }
    return aoQualities;
  }

  return {
    resolveVodQualities,
    createServingID,
    defaultResolutions,
  };
})();
