"""Survey live Twitch channels: which serve MPEG-TS, which serve fMP4, which are encrypted.

The player refuses a playlist carrying either #EXT-X-KEY or #EXT-X-MAP. Those mean very
different things, so this checks which one actually shows up in the wild.
"""
import json
import urllib.parse
import urllib.request

CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'


def post_gql(body):
    req = urllib.request.Request(
        'https://gql.twitch.tv/gql',
        data=json.dumps(body).encode(),
        headers={'Client-ID': CLIENT_ID, 'Content-Type': 'text/plain'})
    return json.load(urllib.request.urlopen(req, timeout=20))


def get(url):
    return urllib.request.urlopen(
        urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=20
    ).read().decode('utf-8', 'replace')


def top_channels(n):
    data = post_gql({'query': '{ streams(first:%d) { edges { node { viewersCount broadcaster { login } } } } }' % n})
    return [(e['node']['broadcaster']['login'], e['node']['viewersCount'])
            for e in data['data']['streams']['edges']]


def access_token(login):
    data = post_gql({
        'query': 'query($login:String!,$playerType:String!){ streamPlaybackAccessToken('
                 'channelName:$login, params:{platform:"web",playerBackend:"mediaplayer",'
                 'playerType:$playerType}) { value signature } }',
        'variables': {'login': login, 'playerType': 'site'}})
    return data['data']['streamPlaybackAccessToken']


def probe(login):
    token = access_token(login)
    if token is None:
        return 'no token'
    url = ('https://usher.ttvnw.net/api/channel/hls/%s.m3u8?allow_source=true'
           '&allow_audio_only=true&fast_bread=true&p=1234&play_session_id=probe'
           '&sig=%s&supported_codecs=av1,h265,h264&token=%s&transcode_mode=cbr_v1'
           % (login, token['signature'], urllib.parse.quote(token['value'], safe='')))
    master = get(url)
    variants = [l for l in master.splitlines() if l.startswith('https')]
    codecs = set()
    for line in master.splitlines():
        if line.startswith('#EXT-X-STREAM-INF') and 'CODECS="' in line:
            codecs.add(line.split('CODECS="')[1].split('"')[0])
    if not variants:
        return 'no variant'
    media = get(variants[0])
    has_key = '#EXT-X-KEY' in media
    has_map = '#EXT-X-MAP' in media
    seg = next((l for l in media.splitlines() if l.startswith('https')), '')
    ext = 'mp4' if '.mp4' in seg.split('?')[0] else ('ts' if '.ts' in seg.split('?')[0] else '?')
    return 'KEY=%-5s MAP=%-5s seg=%-3s codecs=%s' % (
        has_key, has_map, ext, ','.join(sorted(c.split(',')[0] for c in codecs)))


for login, viewers in top_channels(14):
    try:
        print('%-24s %8d  %s' % (login, viewers, probe(login)))
    except Exception as exc:
        print('%-24s %8d  ERROR %s' % (login, viewers, type(exc).__name__ + ': ' + str(exc)[:70]))
