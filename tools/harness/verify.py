# -*- coding: utf-8 -*-
"""Enchaine toutes les verifications d'un lot, et s'arrete au premier echec.

Apres chaque lot de renommage, la procedure comptait six etapes lancees a la main. C'est dans
cet intervalle que les erreurs passaient : un total compare au lieu d'une liste, une chaine hors
ligne dont les zeros ressemblaient a un succes, un harnais qui sortait en 0 sans avoir rien
lance. Ce script les enchaine et juge chacune sur un fait verifiable, jamais sur l'absence
de message.

  1. syntaxe          node --check sur chaque script charge ; JSON du manifeste, des regles,
                      des traductions.
  2. controle croise  crosscheck.js, compare NOM PAR NOM a une reference acceptee.
  3. auto-test        crosscheck-selftest.js : le controle sait encore echouer.
  4. evenements       eventcheck.js : chaque SendEvent a son AddHandler et reciproquement, zero
                      defaut et zero angle mort. Pas de reference : l'arbre est a zero.
  5. auto-test        eventcheck-selftest.js : l'appariement sait encore echouer.
  6. chaine           une chaine reellement en direct, sans quoi rien de ce qui suit ne prouve.
  7. console          errors.py : zero exception, zero console.error.
  8. lecture          probe2.py : des images decodees et un temps de lecture qui avance.
  9. plein ecran      fscheck.py : la barre laterale n'a plus de boite.
 10. reglages         settingscheck.py, compare controle par controle a une reference acceptee.

**Des references, pas des seuils.** Le controle croise et les reglages portent aujourd'hui des
defauts connus. Exiger zero ferait echouer chaque lot jusqu'a leur correction, et un outil qui
echoue toujours finit par ne plus etre lu. Ils sont donc compares a une reference :
  - un defaut NOUVEAU fait echouer ;
  - un defaut connu est rappele a chaque passage, jamais tu ;
  - un defaut disparu est signale, et --accepter l'enregistre.
--accepter enregistre l'etat du passage comme nouvelle reference. A ne lancer qu'apres avoir lu
ce que le passage rapporte : c'est une decision, pas une formalite.

Usage: py -3.14 tools/harness/verify.py [--statique] [--chaines a,b,c] [--accepter]
  --statique  etapes 1 a 5 seulement, quelques secondes, sans navigateur
  --chaines   candidates, essayees dans l'ordre (defaut : zerator)
  --accepter  enregistre les resultats des etapes 2 et 10 comme reference
"""
import io
import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

sys.stdout.reconfigure(encoding='utf-8', errors='replace')

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
RENAME = os.path.join(ROOT, 'tools', 'rename')
REF_CROSS = os.path.join(RENAME, 'crosscheck-reference.json')
REF_SETTINGS = os.path.join(HERE, 'settingscheck-reference.json')
LOG = os.path.join(HERE, 'verify-out.txt')

# Present dans le depot, jamais charge par l'extension : son en-tete le dit.
NOT_LOADED = {'player-english-translating-test.js'}

STATIQUE = '--statique' in sys.argv
ACCEPTER = '--accepter' in sys.argv


def option(flag, default):
    if flag in sys.argv:
        i = sys.argv.index(flag)
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return default


CHAINES = [c.strip() for c in option('--chaines', 'zerator').split(',') if c.strip()]

# Les scripts Python enfants ecrivent du cyrillique dans un tube : sans cela, Windows les encode
# dans la page de code de la console et ils meurent sur UnicodeEncodeError.
ENV = dict(os.environ, PYTHONIOENCODING='utf-8', PYTHONUTF8='1')

log = io.open(LOG, 'w', encoding='utf-8')


def say(line=u''):
    print(line)
    log.write(line + u'\n')
    log.flush()


def run(cmd, timeout, cwd=None):
    """Lance une commande ; rend (code, sortie). Un depassement de delai est un echec."""
    try:
        p = subprocess.run(cmd, cwd=cwd or ROOT, env=ENV, timeout=timeout,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
        return p.returncode, p.stdout.decode('utf-8', 'replace')
    except subprocess.TimeoutExpired as e:
        out = (e.stdout or b'').decode('utf-8', 'replace')
        return 124, out + u'\n(delai de %d s depasse)' % timeout


def tail(text, n=12):
    lines = [l for l in text.strip().splitlines() if l.strip()]
    return u'\n'.join(u'      ' + l for l in lines[-n:])


class Echec(Exception):
    pass


# ---------------------------------------------------------------------------------------------
# Etapes

def etape_syntaxe():
    scripts = sorted(f for f in os.listdir(ROOT) if f.endswith('.js') and f not in NOT_LOADED)
    bad = []
    for f in scripts:
        code, out = run(['node', '--check', f], 60)
        if code != 0:
            bad.append(u'%s\n%s' % (f, tail(out, 6)))
    jsons = ['manifest.json', 'rules.json'] + [os.path.join('_locales', d, 'messages.json')
                                               for d in sorted(os.listdir(os.path.join(ROOT, '_locales')))]
    for f in jsons:
        try:
            with io.open(os.path.join(ROOT, f), encoding='utf-8') as fh:
                json.load(fh)
        except Exception as e:
            bad.append(u'%s : %s' % (f, e))
    if bad:
        raise Echec(u'fichier(s) illisible(s) :\n' + u'\n'.join(bad))
    return u'%d scripts, %d fichiers JSON' % (len(scripts), len(jsons))


def compare_names(ref, cur):
    """ref, cur : {categorie: [noms]}. Rend (nouveaux, disparus), chacun {categorie: [noms]}."""
    nouveaux, disparus = {}, {}
    for k in sorted(set(ref) | set(cur)):
        a, b = set(ref.get(k, [])), set(cur.get(k, []))
        if b - a:
            nouveaux[k] = sorted(b - a)
        if a - b:
            disparus[k] = sorted(a - b)
    return nouveaux, disparus


def fmt(d):
    return u'\n'.join(u'      %-14s %s' % (k, u' '.join(v)) for k, v in d.items())


def etape_croise(etat):
    tmp = os.path.join(tempfile.gettempdir(), 'verify-crosscheck.json')
    if os.path.exists(tmp):
        os.remove(tmp)
    code, out = run(['node', 'crosscheck.js', '--json', tmp], 120, cwd=RENAME)
    if code != 0 or not os.path.exists(tmp):
        raise Echec(u'crosscheck.js n\'a pas produit de resultat\n' + tail(out))
    with io.open(tmp, encoding='utf-8') as fh:
        cur = json.load(fh)['extension']
    etat['croise'] = cur
    if not os.path.exists(REF_CROSS):
        if ACCEPTER:
            return u'pas de reference : celle-ci sera enregistree (%d pendante(s))' % sum(map(len, cur.values()))
        raise Echec(u'aucune reference (%s).\n'
                    u'      Lire tools/rename/crosscheck-report.txt, puis relancer avec --accepter.'
                    % os.path.relpath(REF_CROSS, ROOT))
    with io.open(REF_CROSS, encoding='utf-8') as fh:
        ref = json.load(fh)['extension']
    nouveaux, disparus = compare_names(ref, cur)
    total = sum(map(len, cur.values()))
    msg = u'%d pendante(s), toutes connues' % total
    if disparus:
        msg += u'\n    reparees depuis la reference (--accepter pour l\'enregistrer) :\n' + fmt(disparus)
    if nouveaux and not ACCEPTER:
        raise Echec(u'NOUVELLES references pendantes — un renommage a perdu un cote :\n' + fmt(nouveaux)
                    + u'\n      Detail : tools/rename/crosscheck-report.txt')
    if nouveaux:
        msg += u'\n    nouvelles, ACCEPTEES par --accepter :\n' + fmt(nouveaux)
    return msg


def etape_autotest():
    code, out = run(['node', 'crosscheck-selftest.js'], 600, cwd=RENAME)
    if code != 0:
        raise Echec(u'le controle croise ne detecte plus toutes les casses\n' + tail(out))
    return out.strip().splitlines()[-1]


def etape_evenements():
    code, out = run(['node', 'eventcheck.js'], 120, cwd=RENAME)
    last = out.strip().splitlines()[-1] if out.strip() else u''
    if code != 0 or not last.startswith(u'TOTAL DEFAUTS : '):
        raise Echec(u'un evenement interne a perdu un cote, ou le controle ne voit plus tout\n' + tail(out)
                    + u'\n      Detail : tools/rename/eventcheck-report.txt')
    envois = [l.strip() for l in out.splitlines() if u' envois, ' in l]
    return u'zero defaut, zero angle mort' + (u' — ' + u' ; '.join(envois) if envois else u'')


def etape_autotest_evenements():
    code, out = run(['node', 'eventcheck-selftest.js'], 600, cwd=RENAME)
    if code != 0:
        raise Echec(u'l\'appariement des evenements ne detecte plus toutes les casses\n' + tail(out, 20))
    return out.strip().splitlines()[-1]


def en_direct(chaine):
    """L'apercu public d'une chaine hors ligne redirige vers une image « 404 » ; en direct, il est servi."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    opener = urllib.request.build_opener(NoRedirect)
    url = 'https://static-cdn.jtvnw.net/previews-ttv/live_user_%s-80x45.jpg' % chaine
    try:
        return opener.open(url, timeout=10).status == 200
    except urllib.error.HTTPError:
        return False
    except Exception as e:
        raise Echec(u'impossible de joindre Twitch pour savoir si %s est en direct : %s' % (chaine, e))


def etape_chaine(etat):
    essayees = []
    for c in CHAINES:
        if en_direct(c):
            etat['chaine'] = c
            return c + (u' (hors ligne : %s)' % u', '.join(essayees) if essayees else u'')
        essayees.append(c)
    raise Echec(u'aucune chaine en direct parmi : %s\n'
                u'      Sur une chaine hors ligne le lecteur ne joue rien, et chaque essai ressemblerait\n'
                u'      a un succes. Passer d\'autres candidates avec --chaines a,b,c.' % u', '.join(CHAINES))


def etape_console(etat):
    out_file = os.path.join(HERE, 'errors-out.txt')
    if os.path.exists(out_file):
        os.remove(out_file)
    code, out = run(['py', '-3.14', 'errors.py', 'chrome', etat['chaine'], '25'], 180, cwd=HERE)
    if not os.path.exists(out_file):
        raise Echec(u'errors.py n\'a rien ecrit\n' + tail(out))
    with io.open(out_file, encoding='utf-8') as fh:
        text = fh.read()
    n = None
    for line in text.splitlines():
        if line.startswith(u'erreurs relevees :'):
            n = int(line.split(':')[1])
    if code != 0 or n is None:
        raise Echec(u'errors.py n\'est pas alle au bout\n' + tail(text))
    if n:
        raise Echec(u'%d erreur(s) en console :\n%s' % (n, tail(text, 20)))
    return u'zero erreur en 25 s'


def etape_lecture(etat):
    code, out = run(['py', '-3.14', 'probe2.py', 'chrome', etat['chaine'], '40'], 240, cwd=HERE)
    # Le code de sortie ET la phrase : l'un sans l'autre a deja menti.
    if code != 0 or u'OK : la lecture a eu lieu' not in out:
        raise Echec(u'la lecture n\'est pas prouvee\n' + tail(out))
    cadence = [l.strip() for l in out.splitlines() if l.startswith(u'cadence')]
    return cadence[0] if cadence else u'lecture prouvee'


def etape_plein_ecran(etat):
    code, out = run(['py', '-3.14', 'fscheck.py', 'chrome', etat['chaine']], 240, cwd=HERE)
    out_file = os.path.join(HERE, 'fscheck-out.txt')
    text = io.open(out_file, encoding='utf-8').read() if os.path.exists(out_file) else out
    if code != 0 or u'\nOK :' not in text:
        raise Echec(u'plein ecran\n' + tail(text))
    return u'barre sans boite en plein ecran'


def cles_reglages(controles):
    """Cle stable d'un controle en defaut : son nom, et son rang parmi les homonymes (les « − »)."""
    vus, cles = {}, {}
    for c in controles:
        base = u'%s (%s)' % (c['nom'], c['quoi'])
        vus[base] = vus.get(base, 0) + 1
        key = base if vus[base] == 1 else u'%s #%d' % (base, vus[base])
        if c['verdict'] in (u'MUET', u'ERREUR', u'COUVERT'):
            cles[key] = u'%s : %s' % (c['verdict'], (c['details'] or [u''])[0])
    return cles


def etape_reglages(etat):
    tmp = os.path.join(tempfile.gettempdir(), 'verify-settings.json')
    if os.path.exists(tmp):
        os.remove(tmp)
    code, out = run(['py', '-3.14', 'settingscheck.py', 'chrome', etat['chaine'], '--json', tmp], 900, cwd=HERE)
    if not os.path.exists(tmp):
        raise Echec(u'settingscheck.py n\'a pas pu mener l\'essai\n' + tail(out))
    with io.open(tmp, encoding='utf-8') as fh:
        res = json.load(fh)
    if res['interruptions']:
        raise Echec(u'essai interrompu : ' + u' ; '.join(res['interruptions']))
    if res['essayes'] == 0:
        raise Echec(u'aucun controle essaye, rien n\'est prouve')
    cur = cles_reglages(res['controles'])
    etat['reglages'] = cur
    resume = u'%d controles essayes, %d repondent' % (res['essayes'], res['comptes'].get(u'repond', 0))
    if not os.path.exists(REF_SETTINGS):
        if ACCEPTER:
            return resume + u' ; pas de reference : celle-ci sera enregistree (%d defaut(s))' % len(cur)
        raise Echec(u'aucune reference (%s).\n      Lire settingscheck-out.txt, puis relancer avec --accepter.\n%s'
                    % (os.path.relpath(REF_SETTINGS, ROOT), u'\n'.join(u'      ' + k + u'  ' + v for k, v in cur.items())))
    with io.open(REF_SETTINGS, encoding='utf-8') as fh:
        ref = json.load(fh)['defauts']
    nouveaux = {k: v for k, v in cur.items() if k not in ref}
    connus = {k: v for k, v in cur.items() if k in ref}
    repares = [k for k in ref if k not in cur]
    msg = resume
    if connus:
        msg += u'\n    defauts connus, toujours la :\n' + u'\n'.join(u'      %s  %s' % (k, v) for k, v in connus.items())
    if repares:
        msg += u'\n    repares depuis la reference (--accepter pour l\'enregistrer) :\n' + u'\n'.join(u'      ' + k for k in repares)
    if nouveaux and not ACCEPTER:
        raise Echec(msg + u'\n    NOUVEAUX controles en defaut :\n'
                    + u'\n'.join(u'      %s  %s' % (k, v) for k, v in nouveaux.items())
                    + u'\n      Detail : tools/harness/settingscheck-out.txt')
    if nouveaux:
        msg += u'\n    nouveaux, ACCEPTES par --accepter :\n' + u'\n'.join(u'      %s  %s' % (k, v) for k, v in nouveaux.items())
    return msg


# ---------------------------------------------------------------------------------------------

def main():
    etat = {}
    etapes = [
        (u'syntaxe', lambda: etape_syntaxe()),
        (u'controle croise', lambda: etape_croise(etat)),
        (u'auto-test du controle', lambda: etape_autotest()),
        (u'evenements internes', lambda: etape_evenements()),
        (u'auto-test des evenements', lambda: etape_autotest_evenements()),
    ]
    if not STATIQUE:
        etapes += [
            (u'chaine en direct', lambda: etape_chaine(etat)),
            (u'console', lambda: etape_console(etat)),
            (u'lecture', lambda: etape_lecture(etat)),
            (u'plein ecran', lambda: etape_plein_ecran(etat)),
            (u'reglages', lambda: etape_reglages(etat)),
        ]
    say(u'VERIFICATION — %s%s' % (time.strftime('%Y-%m-%d %H:%M'), u' (statique)' if STATIQUE else u''))
    say(u'')
    debut = time.time()
    for n, (nom, f) in enumerate(etapes, 1):
        t = time.time()
        say(u'%d. %s ...' % (n, nom))
        try:
            msg = f()
        except Echec as e:
            say(u'   ECHEC (%.0f s) : %s' % (time.time() - t, e))
            say(u'')
            say(u'ARRET a l\'etape %d sur %d. Les suivantes n\'ont pas ete lancees.' % (n, len(etapes)))
            return 1
        say(u'   ok (%.0f s) : %s' % (time.time() - t, msg))

    if ACCEPTER:
        if 'croise' in etat:
            with io.open(REF_CROSS, 'w', encoding='utf-8') as fh:
                json.dump({'extension': etat['croise']}, fh, ensure_ascii=False, indent=1)
            say(u'')
            say(u'reference enregistree : %s' % os.path.relpath(REF_CROSS, ROOT))
        if 'reglages' in etat:
            with io.open(REF_SETTINGS, 'w', encoding='utf-8') as fh:
                json.dump({'defauts': etat['reglages']}, fh, ensure_ascii=False, indent=1)
            say(u'reference enregistree : %s' % os.path.relpath(REF_SETTINGS, ROOT))
    say(u'')
    say(u'OK : %d etapes en %.0f s.%s' % (len(etapes), time.time() - debut,
                                          u' Navigateur non lance (--statique).' if STATIQUE else u''))
    return 0


code = 1  # une exception imprevue est un echec, pas un succes silencieux
try:
    code = main()
finally:
    log.close()
sys.exit(code)
