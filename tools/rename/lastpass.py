# -*- coding: utf-8 -*-
"""The last Cyrillic that was not load-bearing: what every earlier pass missed, and why.

Three names escaped the identifier passes for three different reasons.

  - Two local variables were a single Cyrillic letter, "с" -- visually identical to the Latin
    "c" in most fonts. A human reading the code sees nothing wrong. They are renamed here only
    inside the body of the function that declares them: a whole-file replacement of one letter
    would be reckless.
  - ЭтотКаналУжеОткрыт was renamed as a *message* string in an earlier pass, but the function of
    the same name is an identifier, which that pass never touched. It is called directly, not
    through the message, so nothing was broken -- only left behind.
  - pointerevent.js never appeared in any file list. See its removal below.

Two hidden form values in report.html are translated as well. They are never read by any script
and the forms submit nowhere, which was checked before touching them.

Usage: python lastpass.py
"""
import io
import os

R = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))


def lire(f):
    return io.open(os.path.join(R, f), encoding='utf-8').read()


def ecrire(f, s):
    io.open(os.path.join(R, f), 'w', encoding='utf-8', newline='').write(s)


def dans_fonction(texte, entete, fin, vieux, neuf):
    """Remplace vieux par neuf uniquement entre l'entete de la fonction et sa fin."""
    debut = texte.index(entete)
    arret = texte.index(fin, debut) + len(fin)
    corps = texte[debut:arret]
    return texte[:debut] + corps.replace(vieux, neuf) + texte[arret:], corps.count(vieux)


C = u'с'  # la lettre cyrillique « с »

s = lire('common.js')
s, n1 = dans_fonction(s, 'function SecondsToString(', '\n\t}', C + ' ', 'sTime ')
s, n2 = dans_fonction(s, 'function SecondsToString(', '\n\t}', C + ';', 'sTime;')
print("common.js  SecondsToString : %d occurrences de « с »" % (n1 + n2))

# Le chargeur du polyfill PointerEvent : voir la note plus bas.
chargeur = ("if (!THIS_IS_CONTENT_SCRIPT && !window.PointerEvent) {\n"
            "\tconst nodeScript = document.createElement('script');\n"
            "\tnodeScript.src = 'pointerevent.js';\n"
            "\tdocument.currentScript.parentNode.appendChild(nodeScript);\n"
            "}\n\n")
assert s.count(chargeur) == 1, "chargeur du polyfill introuvable"
s = s.replace(chargeur, '', 1)
ecrire('common.js', s)
print("common.js  chargeur de pointerevent.js retire")

w = lire('worker.js')
w, n3 = dans_fonction(w, 'function GetCodecNames(', '\n\t}', C + ' ', 'sCodecs ')
w, n4 = dans_fonction(w, 'function GetCodecNames(', '\n\t}', C + ' +', 'sCodecs +')
ecrire('worker.js', w)
print("worker.js  GetCodecNames : %d occurrences de « с »" % (n3 + n4))

p = lire('player.js')
vieux = u'ЭтотКаналУжеОткрыт'
assert p.count(vieux) == 2, "ЭтотКаналУжеОткрыт : attendu 2, trouve %d" % p.count(vieux)
p = p.replace(vieux, 'checkChannelAlreadyOpen')
ecrire('player.js', p)
print("player.js  ЭтотКаналУжеОткрыт -> checkChannelAlreadyOpen (2)")

h = lire('report.html')
for ru, en in ((u'value=отзыв>', 'value=feedback>'),
               (u'value=ошибка>', 'value=error>')):
    assert h.count(ru) == 1, "valeur de formulaire introuvable"
    h = h.replace(ru, en, 1)
ecrire('report.html', h)
print("report.html  valeurs de formulaire traduites (2)")
