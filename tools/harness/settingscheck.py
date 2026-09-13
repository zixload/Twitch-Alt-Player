# -*- coding: utf-8 -*-
"""Ouvre la fenetre de reglages et actionne chaque controle comme le ferait l'utilisateur.

Le harnais prouvait que le flux joue, que la console reste propre et que la barre laterale se
retire en plein ecran. Il ne prouvait pas qu'un bouton de reglage repond encore. Or c'est
exactement ce qu'un renommage casse sans bruit : tous les controles passent par un seul switch
sur `id || name` dans HandleLeftClick, et un nom qui n'y figure plus rend le bouton muet, sans
exception et sans ligne en console.

Pour chaque controle visible de #settings :
  - une case, un bouton radio, un bouton : un VRAI clic souris par CDP (Input.dispatchMouseEvent).
    Pas el.click() : les boutons - et + des champs numeriques passent par le mecanisme de glisser,
    qui ecoute le pointeur. Un click() synthetique ne les declencherait jamais, et le test
    conclurait a tort qu'ils sont muets.
  - une liste, un curseur, une couleur, un champ texte : une nouvelle valeur, puis input et change.
Puis on compare l'etat observable avant et apres : les reglages (m_Settings.GetDataForReport),
les classes et attributs de <html> et <body>, un telechargement, un selecteur de fichier, une
boite de dialogue, un nouvel onglet.

Verdicts :
  repond      quelque chose a change.
  MUET        rien d'observable n'a change. Un nom perdu, le plus souvent.
  ERREUR      exception, console.error, ou lecteur termine.
  COUVERT     un autre element recoit le clic a l'endroit du controle : l'utilisateur non plus
              ne peut pas l'atteindre.
  non essaye  invisible, desactive, radio deja cochee, champ fichier.

**Une exception ne tue pas qu'un bouton.** AddExceptionHandler la rattrape, et
TerminateAndSendReport passe g_bWorkFinished a true : desormais TOUS les gestionnaires se taisent.
Sans precaution, un seul bouton fautif ferait paraitre muets tous ceux qui le suivent. Le script
surveille donc g_bWorkFinished apres chaque controle, et recharge le lecteur des qu'il bascule.

**Prendre une chaine en direct.** Sur une chaine hors ligne le lecteur termine avant l'essai
(g_bWorkFinished est deja vrai), et chaque controle paraitrait muet. Le script le detecte et
s'arrete en ECHEC plutot que de rendre un verdict sans valeur.

Usage: py -3.14 settingscheck.py <chrome|vivaldi> [chaine] [--voir] [--ext <dossier>] [--json <fichier>]
  --ext   charge l'extension depuis un autre dossier (une copie mutee, pour prouver l'echec)
  --json  ecrit aussi le verdict de chaque controle, pour verify.py
"""
import asyncio
import io
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request

import websockets

# La console de Windows n'est pas en UTF-8 : sans cela, un titre de chaine en chinois tue le script.
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
LOCALAPPDATA = os.environ.get('LOCALAPPDATA', '')


def option(flag):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


VOIR = '--voir' in sys.argv
EXT_OPT = option('--ext')
JSON_OUT = option('--json')
# **Derive du chemin du script, jamais code en dur.** Voir probe2.py.
EXT = os.path.abspath(EXT_OPT or os.path.join(HERE, '..', '..'))
ARGS = [a for a in sys.argv[1:] if not a.startswith('--') and a not in (EXT_OPT, JSON_OUT)]
WHICH = ARGS[0] if ARGS else 'chrome'
CHANNEL = ARGS[1] if len(ARGS) > 1 else 'zerator'

BIN = {
    'chrome': r'C:\Program Files\Google\Chrome\Application\chrome.exe',
    'vivaldi': os.path.join(LOCALAPPDATA, 'Vivaldi', 'Application', 'vivaldi.exe'),
}[WHICH]
PORT = {'chrome': 9497, 'vivaldi': 9498}[WHICH]
PROFILE = os.path.join(HERE, 'settingscheck-' + WHICH)
OUT = os.path.join(HERE, 'settingscheck-out.txt')

# **Sur le deuxieme ecran, pas sur celui ou travaille l'utilisateur.** Voir fscheck.py.
ECRAN2 = ['--window-position=1960,40', '--window-size=1600,950']

# Le lecteur demarre le flux avant d'etre utilisable ; laisser le temps a la page de se poser.
SETTLE = 8
# Apres un controle : les fenetres s'animent, les reglages s'enregistrent en differe.
AFTER = 0.6


# Bibliotheque injectee dans la page. **Elle ne connait aucun nom que le renommage va toucher** :
# la fenetre se trouve par son id `settings`, son bouton par la VALEUR `settings` d'un attribut
# data-*, quel que soit le nom de cet attribut. Seules deux sondes sont nommees, m_Settings et
# g_bWorkFinished, et leur absence fait echouer l'essai au lieu de le fausser.
HELPER = r'''
window.__sc = (() => {
  const SEL = 'input, select, textarea, button';
  const root = () => document.getElementById('settings');
  const controls = () => root() ? [...root().querySelectorAll(SEL)] : [];
  const boxed = (el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    if (el.checkVisibility && !el.checkVisibility({opacityProperty: true, visibilityProperty: true})) return false;
    return boxed(el);
  };
  // Une case stylee est souvent invisible, et c'est son libelle qu'on clique.
  const clickTarget = (el) => {
    if (visible(el)) return el;
    const t = (el.type || '').toLowerCase();
    if (t !== 'checkbox' && t !== 'radio') return null;
    const lab = el.closest('label') || (el.id && document.querySelector('label[for="' + CSS.escape(el.id) + '"]'));
    return lab && visible(lab) ? lab : null;
  };
  const describe = (el) => {
    if (!el) return null;
    if (el.id) return '#' + el.id;
    const c = typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/)[0] : '';
    return el.tagName.toLowerCase() + c;
  };
  const label = (el) => {
    let txt = (el.getAttribute('title') || el.getAttribute('aria-label') || '').trim();
    if (!txt && el.id) {
      const l = document.querySelector('label[for="' + CSS.escape(el.id) + '"]');
      if (l) txt = l.textContent;
    }
    if (!txt && el.closest('label')) txt = el.closest('label').textContent;
    if (!txt) txt = el.textContent || '';
    return txt.replace(/\s+/g, ' ').trim().slice(0, 48);
  };
  const attrs = (el) => [...el.attributes]
    .filter((a) => a.name !== 'class' && a.name !== 'style')
    .map((a) => a.name + '=' + a.value).sort();
  return {
    probes() {
      return {
        settings: typeof m_Settings !== 'undefined' && typeof m_Settings.GetDataForReport === 'function',
        finished: typeof g_bWorkFinished !== 'undefined',
        root: !!root(),
      };
    },
    finished() { return typeof g_bWorkFinished !== 'undefined' && g_bWorkFinished === true; },
    toggleCentre() {
      const b = [...document.querySelectorAll('button')]
        .find((x) => [...x.attributes].some((a) => a.name.startsWith('data-') && a.value === 'settings'));
      if (!b || !boxed(b)) return null;
      b.scrollIntoView({block: 'center', inline: 'center'});
      const r = b.getBoundingClientRect();
      return {x: r.x + r.width / 2, y: r.y + r.height / 2};
    },
    isOpen() { return visible(root()); },
    list() {
      return controls().map((el, i) => ({
        i, tag: el.tagName.toLowerCase(), type: (el.type || '').toLowerCase(),
        id: el.id || '', name: el.name || '', value: String(el.value || ''),
        checked: !!el.checked, disabled: !!el.disabled, readOnly: !!el.readOnly,
        reachable: !!clickTarget(el) || (visible(el) && el.tagName !== 'BUTTON'),
        label: label(el),
      }));
    },
    aim(i) {
      const el = controls()[i];
      const target = el && clickTarget(el);
      if (!target) return null;
      target.scrollIntoView({block: 'center', inline: 'center'});
      const r = target.getBoundingClientRect();
      const x = r.x + r.width / 2, y = r.y + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const ok = !!hit && (hit === target || target.contains(hit) || hit === el
        || (hit.tagName === 'LABEL' && (hit.control === el || hit.contains(el))));
      return {x, y, ok, via: target === el ? '' : describe(target), hit: describe(hit)};
    },
    setValue(i) {
      const el = controls()[i];
      if (!el) return null;
      const t = (el.type || '').toLowerCase();
      const before = String(el.value);
      if (el.tagName === 'SELECT') {
        const o = [...el.options].find((x) => x.value !== el.value && !x.disabled);
        if (!o) return null;
        el.value = o.value;
      } else if (t === 'range') {
        const step = Number(el.step) || 1, max = el.max === '' ? 100 : Number(el.max), v = Number(el.value);
        el.value = String(v + step <= max ? v + step : v - step);
      } else if (t === 'color') {
        el.value = el.value.toLowerCase() === '#123456' ? '#654321' : '#123456';
      } else if (t === 'number') {
        el.value = String(Number(el.value || 0) + (Number(el.step) || 1));
      } else {
        el.value = before + 'x';
      }
      el.focus();
      el.dispatchEvent(new Event('input', {bubbles: true}));
      el.dispatchEvent(new Event('change', {bubbles: true}));
      return {before, after: String(el.value)};
    },
    // Les en-tetes de section sont des radios sans gestionnaire : un selecteur CSS
    // input:not(:checked)+...+section { height: 0 } plie ou deplie. Leur seul effet est
    // geometrique, donc on releve la hauteur de chaque conteneur qui rogne son contenu.
    geometry() {
      const r = root();
      if (!r) return [];
      return [...r.querySelectorAll('*')]
        .filter((el) => getComputedStyle(el).overflow !== 'visible')
        .map((el) => Math.round(el.getBoundingClientRect().height));
    },
    state() {
      let settings;
      try { settings = JSON.parse(JSON.stringify(m_Settings.GetDataForReport())); }
      catch (e) { settings = {'!sonde': String(e)}; }
      return {
        settings,
        bodyClass: [...document.body.classList].sort(),
        htmlClass: [...document.documentElement.classList].sort(),
        bodyAttrs: attrs(document.body),
        htmlAttrs: attrs(document.documentElement),
        style: document.documentElement.style.cssText + ' | ' + document.body.style.cssText,
        geometry: this.geometry(),
        finished: typeof g_bWorkFinished !== 'undefined' && g_bWorkFinished === true,
      };
    },
  };
})();
true
'''


def stop(proc):
    if proc and proc.poll() is None:
        subprocess.run(['taskkill', '/F', '/T', '/PID', str(proc.pid)],
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


def http(path):
    with urllib.request.urlopen('http://127.0.0.1:%d%s' % (PORT, path), timeout=6) as r:
        return json.load(r)


def page_targets():
    try:
        return set(t['id'] for t in http('/json/list') if t.get('type') == 'page')
    except Exception:
        return set()


class Cdp(object):
    """Une session CDP : les reponses par identifiant, les evenements dans un journal.

    Les scripts plus anciens lisaient la socket en attendant leur reponse et jetaient les
    evenements recus entre-temps. Ici l'essai doit savoir quelle exception est arrivee pendant
    QUEL controle, donc une tache lit tout et conserve les evenements dans l'ordre.
    """

    def __init__(self, ws):
        self.ws = ws
        self.n = 0
        self.pending = {}
        self.events = []
        self.task = asyncio.ensure_future(self._read())

    async def _read(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw)
                if 'id' in msg:
                    fut = self.pending.pop(msg['id'], None)
                    if fut and not fut.done():
                        fut.set_result(msg)
                else:
                    self.events.append(msg)
        except Exception:
            pass

    async def call(self, method, params=None, timeout=20):
        self.n += 1
        n = self.n
        fut = asyncio.get_running_loop().create_future()
        self.pending[n] = fut
        await self.ws.send(json.dumps({'id': n, 'method': method, 'params': params or {}}))
        try:
            msg = await asyncio.wait_for(fut, timeout)
        except asyncio.TimeoutError:
            self.pending.pop(n, None)
            raise RuntimeError(u'delai depasse : ' + method)
        if 'error' in msg:
            raise RuntimeError(u'%s -> %s' % (method, msg['error']))
        return msg.get('result', {})

    async def js(self, expression, timeout=20):
        r = await self.call('Runtime.evaluate', {'expression': expression, 'returnByValue': True},
                            timeout=timeout)
        if 'exceptionDetails' in r:
            d = r['exceptionDetails']
            raise RuntimeError(u'evaluation : %s' % ((d.get('exception') or {}).get('description')
                                                     or d.get('text')))
        return r.get('result', {}).get('value')

    async def mouse(self, kind, x, y, **extra):
        p = {'type': kind, 'x': x, 'y': y}
        p.update(extra)
        await self.call('Input.dispatchMouseEvent', p)

    async def click(self, x, y, move=True):
        if move:
            await self.mouse('mouseMoved', x, y)
        await self.mouse('mousePressed', x, y, button='left', buttons=1, clickCount=1)
        await asyncio.sleep(0.08)
        await self.mouse('mouseReleased', x, y, button='left', buttons=0, clickCount=1)


async def open_player(cdp, url):
    """Ouvre le lecteur (url) ou attend celui que la page vient de recharger d'elle-meme (None)."""
    if url:
        await cdp.call('Page.navigate', {'url': url})
    for _ in range(60):
        await asyncio.sleep(0.5)
        try:
            if await cdp.js("document.readyState === 'complete' && typeof m_Settings !== 'undefined'"):
                break
        except Exception:
            pass
    await asyncio.sleep(SETTLE)
    await cdp.js(HELPER)


async def ensure_settings_open(cdp):
    """Ouvre la fenetre par son bouton, a la souris. Rend False si l'utilisateur ne le pourrait pas."""
    if await cdp.js('__sc.isOpen()'):
        return True
    for _ in range(3):
        # La barre de controle se masque seule : un mouvement de souris la fait revenir.
        await cdp.mouse('mouseMoved', 500, 300)
        await asyncio.sleep(0.3)
        c = await cdp.js('__sc.toggleCentre()')
        if c:
            await cdp.click(c['x'], c['y'])
            await asyncio.sleep(AFTER)
            if await cdp.js('__sc.isOpen()'):
                return True
        await asyncio.sleep(0.5)
    return False


def diff(a, b):
    """Ce qui a change entre deux etats, en phrases courtes."""
    out = []
    sa, sb = a['settings'], b['settings']
    for k in sorted(set(sa) | set(sb)):
        if sa.get(k, u'(defaut)') != sb.get(k, u'(defaut)'):
            out.append(u'reglage %s : %s -> %s' % (k, json.dumps(sa.get(k, u'(defaut)'), ensure_ascii=False),
                                                   json.dumps(sb.get(k, u'(defaut)'), ensure_ascii=False)))
    for key, what in (('bodyClass', u'classe body'), ('htmlClass', u'classe html'),
                      ('bodyAttrs', u'attribut body'), ('htmlAttrs', u'attribut html')):
        plus = sorted(set(b[key]) - set(a[key]))
        moins = sorted(set(a[key]) - set(b[key]))
        if plus:
            out.append(u'%s +%s' % (what, u' +'.join(plus)))
        if moins:
            out.append(u'%s -%s' % (what, u' -'.join(moins)))
    if a['style'] != b['style']:
        out.append(u'style en ligne modifie')
    ga, gb = a.get('geometry', []), b.get('geometry', [])
    if ga != gb:
        n = sum(1 for x, y in zip(ga, gb) if x != y) + abs(len(ga) - len(gb))
        out.append(u'fenetre : %d conteneur(s) changent de hauteur' % n)
    return out


def error_text(ev):
    """Le message et les premieres lignes de pile : « TypeError » seul ne dit pas OU."""
    p = ev.get('params', {})
    if ev.get('method') == 'Runtime.exceptionThrown':
        d = p.get('exceptionDetails', {})
        txt = (d.get('exception') or {}).get('description') or d.get('text') or ''
    else:
        txt = u' '.join(str(x.get('value', x.get('description', ''))) for x in p.get('args', []))
    lines = [l.strip() for l in txt.split('\n') if l.strip()]
    head = lines[:1]
    # Les cadres utiles : ceux de l'extension, sans le chemin chrome-extension://<id>/.
    # « at nom (url:l:c) » ou, pour une fonction anonyme, « at url:l:c ».
    frames = []
    for l in lines[1:]:
        if not l.startswith('at ') or 'chrome-extension://' not in l:
            continue
        where = l.split('/')[-1].rstrip(')')
        name = l[3:].split(' (')[0] if ' (' in l else ''
        frames.append((where + u' ' + name).strip())
    frames = frames[:4]
    return u'%s%s' % (head[0][:160] if head else u'(sans message)',
                      (u'  <- ' + u' <- '.join(frames)) if frames else u'')


def is_last(c):
    # Remettre les reglages a zero fausserait toutes les differences suivantes : en dernier.
    return 'reset' in (c['id'] + c['name']).lower()


async def main():
    shutil.rmtree(PROFILE, ignore_errors=True)
    cmd = [BIN, '--no-first-run', '--no-default-browser-check',
           '--user-data-dir=' + PROFILE,
           '--enable-unsafe-extension-debugging',
           '--remote-debugging-port=%d' % PORT,
           '--remote-allow-origins=*',
           '--autoplay-policy=no-user-gesture-required',
           '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding']
    cmd += ECRAN2 if VOIR else ['--headless=new', '--window-size=1600,900', '--screen-info={1920x1080}']
    cmd.append('about:blank')
    proc = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    out = io.open(OUT, 'w', encoding='utf-8')

    def w(line=u''):
        out.write(line + u'\n')
        out.flush()

    try:
        ver = None
        for _ in range(30):
            time.sleep(1)
            try:
                ver = http('/json/version')
                break
            except Exception:
                pass
        if not ver:
            w(u"ECHEC : aucun point d'entree DevTools")
            return 1
        w(u'%s %s' % (WHICH, ver.get('Browser')))
        w(u'extension : %s' % EXT)

        async with websockets.connect(ver['webSocketDebuggerUrl'], max_size=None, ping_interval=None) as bws:
            b = Cdp(bws)
            r = await b.call('Extensions.loadUnpacked', {'path': EXT}, timeout=30)
            ext_id = r['id']
            # Un telechargement ne doit rien deposer : on veut seulement savoir qu'il a eu lieu.
            try:
                await b.call('Browser.setDownloadBehavior', {'behavior': 'deny', 'eventsEnabled': True})
            except Exception:
                pass
        url = 'chrome-extension://%s/player.html?channel=%s' % (ext_id, CHANNEL)
        w(u'chaine : %s' % CHANNEL)

        page = None
        for _ in range(15):
            for t in http('/json/list'):
                if t.get('type') == 'page' and t.get('webSocketDebuggerUrl'):
                    page = t
                    break
            if page:
                break
            time.sleep(1)
        if not page:
            w(u'ECHEC : aucune cible de page')
            return 1

        async with websockets.connect(page['webSocketDebuggerUrl'], max_size=None, ping_interval=None) as pws:
            cdp = Cdp(pws)
            for m in ('Page.enable', 'Runtime.enable', 'Log.enable'):
                await cdp.call(m)
            await cdp.call('Page.setInterceptFileChooserDialog', {'enabled': True})
            await open_player(cdp, url)

            probes = await cdp.js('__sc.probes()')
            if not (probes['settings'] and probes['finished'] and probes['root']):
                w(u'ECHEC : sondes introuvables %s — un renommage les a emportees, le script doit suivre.'
                  % json.dumps(probes))
                return 1
            if await cdp.js('__sc.finished()'):
                w(u"ECHEC : le lecteur a termine avant l'essai. Chaine hors ligne ? Rien n'est prouve.")
                return 1
            if not await ensure_settings_open(cdp):
                w(u"ECHEC : la fenetre de reglages ne s'ouvre pas par son bouton.")
                return 1

            inventaire = await cdp.js('__sc.list()')
            order = sorted(range(len(inventaire)), key=lambda i: is_last(inventaire[i]))
            w(u'controles dans #settings : %d' % len(inventaire))
            w(u'')

            counts = {}
            lignes = []
            rechargements = 0

            for i in order:
                if not await ensure_settings_open(cdp):
                    lignes.append((i, None, u'ERREUR', [u"la fenetre de reglages ne se rouvre plus"]))
                    counts[u'ERREUR'] = counts.get(u'ERREUR', 0) + 1
                    break
                c = (await cdp.js('__sc.list()'))[i]
                nom = c['id'] or (c['name'] + '=' + c['value'] if c['name'] else '') or c['label'] or c['tag']
                quoi = c['tag'] + ('/' + c['type'] if c['type'] and c['tag'] == 'input' else '')

                raison = None
                if c['disabled']:
                    raison = u'desactive'
                elif c['readOnly'] and c['tag'] != 'button':
                    raison = u'lecture seule'
                elif c['type'] == 'file':
                    raison = u'champ fichier'
                elif c['type'] == 'radio' and c['checked']:
                    raison = u'radio deja cochee'
                elif c['type'] == 'hidden' or not c['reachable']:
                    raison = u'invisible'
                if raison:
                    lignes.append((i, (nom, quoi, c['label']), u'non essaye', [raison]))
                    counts[u'non essaye'] = counts.get(u'non essaye', 0) + 1
                    continue

                details = []
                par_clic = c['tag'] == 'button' or c['type'] in ('checkbox', 'radio', 'button', 'submit', 'reset')
                a = await cdp.js('__sc.aim(%d)' % i)
                if par_clic and not a:
                    lignes.append((i, (nom, quoi, c['label']), u'non essaye', [u'invisible']))
                    counts[u'non essaye'] = counts.get(u'non essaye', 0) + 1
                    continue
                if par_clic and not a['ok']:
                    lignes.append((i, (nom, quoi, c['label']), u'COUVERT', [u'le clic tombe sur %s' % a['hit']]))
                    counts[u'COUVERT'] = counts.get(u'COUVERT', 0) + 1
                    continue

                # **Survoler avant de mesurer.** La barre de controle se masque et revient selon le
                # mouvement de la souris et une minuterie (classe autohide). Mesurer autour d'un clic
                # qui deplace la souris attribuait ce va-et-vient au controle : un bouton retire du
                # switch passait pour un bouton qui repond. On amene donc la souris, on laisse la page
                # reagir au mouvement, PUIS on prend l'etat de reference et on presse sans bouger.
                if a:
                    await cdp.mouse('mouseMoved', a['x'], a['y'])
                    await asyncio.sleep(AFTER)

                avant = await cdp.js('__sc.state()')
                mark = len(cdp.events)
                onglets = page_targets()

                if par_clic:
                    if a['via']:
                        details.append(u'clic sur le libelle %s' % a['via'])
                    await cdp.click(a['x'], a['y'], move=False)
                else:
                    v = await cdp.js('__sc.setValue(%d)' % i)
                    if v is None:
                        lignes.append((i, (nom, quoi, c['label']), u'non essaye', [u'aucune autre valeur']))
                        counts[u'non essaye'] = counts.get(u'non essaye', 0) + 1
                        continue
                    details.append(u'valeur %s -> %s' % (json.dumps(v['before'], ensure_ascii=False),
                                                         json.dumps(v['after'], ensure_ascii=False)))

                await asyncio.sleep(AFTER)

                effets, erreurs = [], []
                recharge = False
                for ev in cdp.events[mark:]:
                    meth = ev.get('method')
                    p = ev.get('params', {})
                    if meth == 'Page.frameNavigated' and not p.get('frame', {}).get('parentId'):
                        recharge = True
                    elif meth == 'Page.javascriptDialogOpening':
                        effets.append(u'boite de dialogue « %s »' % p.get('message', '')[:60])
                        try:
                            await cdp.call('Page.handleJavaScriptDialog', {'accept': True})
                        except Exception:
                            pass
                    elif meth == 'Page.fileChooserOpened':
                        effets.append(u'selecteur de fichier ouvert')
                    elif meth in ('Page.downloadWillBegin', 'Browser.downloadWillBegin'):
                        effets.append(u'telechargement demande')
                    elif meth == 'Runtime.exceptionThrown' or (
                            meth == 'Runtime.consoleAPICalled' and p.get('type') == 'error'):
                        t = error_text(ev)
                        if t not in erreurs:
                            erreurs.append(t)
                    elif meth == 'Log.entryAdded' and p.get('entry', {}).get('level') == 'error':
                        # « Unchecked runtime.lastError » et les refus du navigateur passent par ici.
                        t = (p['entry'].get('text') or '').split('\n')[0][:160]
                        if t and t not in erreurs:
                            erreurs.append(t)
                if page_targets() - onglets:
                    effets.append(u'nouvel onglet')

                apres = None
                if recharge:
                    # « Reinitialiser » recharge la page : c'est son effet, pas une panne. Mais la
                    # bibliotheque injectee a disparu avec l'ancienne page.
                    effets.append(u'la page se recharge')
                    await open_player(cdp, None)
                    apres = await cdp.js('__sc.state()')
                else:
                    try:
                        apres = await cdp.js('__sc.state()')
                    except Exception as e:
                        erreurs.append(u'etat illisible apres le controle : %s' % e)

                if apres is not None and not recharge:
                    effets = diff(avant, apres) + effets
                    if apres['finished']:
                        erreurs.append(u'le lecteur a termine (g_bWorkFinished)')

                if erreurs:
                    verdict = u'ERREUR'
                    details += erreurs + effets
                elif effets:
                    verdict = u'repond'
                    details += effets
                else:
                    verdict = u'MUET'
                    details.append(u"aucun reglage, aucune classe, aucun attribut n'a change")
                counts[verdict] = counts.get(verdict, 0) + 1
                lignes.append((i, (nom, quoi, c['label']), verdict, details))

                # Apres une exception rattrapee, plus aucun gestionnaire ne repond : repartir d'un
                # lecteur neuf, sans quoi tous les controles suivants paraitraient muets.
                if apres is None or apres['finished']:
                    rechargements += 1
                    await open_player(cdp, url)
                    if await cdp.js('__sc.finished()'):
                        lignes.append((i, None, u'ERREUR', [u'le lecteur recharge termine aussitot : essai interrompu']))
                        break

            for i, ident, verdict, details in sorted(lignes, key=lambda x: x[0]):
                if ident is None:
                    w(u'  %-10s  %s' % (verdict, u' ; '.join(details)))
                    continue
                nom, quoi, lib = ident
                w(u'  %-10s  %-34s %-15s %s' % (verdict, nom[:34], quoi, lib))
                for d in details:
                    w(u'              %s' % d)

            essayes = sum(v for k, v in counts.items() if k != u'non essaye')
            if JSON_OUT:
                with io.open(JSON_OUT, 'w', encoding='utf-8') as jf:
                    json.dump({
                        'chaine': CHANNEL,
                        'essayes': essayes,
                        'comptes': counts,
                        'controles': [{'i': i, 'nom': ident[0], 'quoi': ident[1], 'verdict': verdict,
                                       'details': details}
                                      for i, ident, verdict, details in sorted(lignes, key=lambda x: x[0])
                                      if ident is not None],
                        'interruptions': [u' ; '.join(details) for _, ident, _, details in lignes if ident is None],
                    }, jf, ensure_ascii=False, indent=1)
            w(u'')
            w(u'=' * 64)
            for k in (u'repond', u'MUET', u'ERREUR', u'COUVERT', u'non essaye'):
                w(u'  %-10s : %d' % (k, counts.get(k, 0)))
            w(u'  rechargements du lecteur : %d' % rechargements)
            if essayes == 0:
                w(u"ECHEC : aucun controle essaye, rien n'est prouve.")
                return 1
            mauvais = counts.get(u'MUET', 0) + counts.get(u'ERREUR', 0) + counts.get(u'COUVERT', 0)
            if mauvais:
                w(u'ECHEC : %d controle(s) ne repondent pas comme un utilisateur l\'attend.' % mauvais)
                return 1
            w(u'OK : les %d controles essayes repondent.' % essayes)
            return 0
    except Exception as e:
        w(u'ECHEC : %s' % e)
        return 1
    finally:
        out.close()
        stop(proc)


code = asyncio.run(main()) or 0
with io.open(OUT, encoding='utf-8') as f:
    sys.stdout.buffer.write(f.read().encode('utf-8'))
sys.exit(code)
