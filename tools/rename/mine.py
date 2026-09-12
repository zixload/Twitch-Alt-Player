# -*- coding: utf-8 -*-
"""Extrait des correspondances russe -> anglais du travail de traduction deja present.

La convention du depot double chaque ligne russe d'une traduction anglaise en commentaire :

    function TranslateDocument(оДокумент) {
    // function TranslateDocument(oDocument) {

C'est une mine : le mainteneur a deja choisi les noms anglais. Plutot que d'en inventer 1324,
on lit les siens.

**L'alignement n'est accepte que si la structure des deux lignes est identique** — memes jetons
non-identifiants, dans le meme ordre, en meme nombre. Sans ce garde-fou, deux lignes qui se
ressemblent vaguement produiraient des correspondances fausses, et une correspondance fausse
renomme un identifiant en un autre qui existe deja : le genre de degat qui ne se voit pas a la
lecture et casse a l'execution.

Usage: python mine.py <fichier.js> [...]
"""
import collections
import io
import json
import os
import re
import sys

CYR = re.compile(u'[Ѐ-ӿ]')
# Un identifiant JavaScript tel que ce depot les ecrit : cyrillique, latin, chiffres, _ et $.
TOKEN = re.compile(u'[A-Za-z_$Ѐ-ӿ][A-Za-z0-9_$Ѐ-ӿ]*|[^\\sA-Za-z0-9_$Ѐ-ӿ]+|\\s+')
IDENT = re.compile(u'^[A-Za-z_$Ѐ-ӿ][A-Za-z0-9_$Ѐ-ӿ]*$')

HERE = os.path.dirname(os.path.abspath(__file__))


def tokenise(line):
    return [t for t in TOKEN.findall(line) if t.strip()]


def align(ru, en):
    """Rend les paires (jeton russe, jeton anglais) si les deux lignes ont la meme charpente."""
    a, b = tokenise(ru), tokenise(en)
    if len(a) != len(b):
        return None
    pairs = []
    for x, y in zip(a, b):
        xi, yi = bool(IDENT.match(x)), bool(IDENT.match(y))
        if xi != yi:
            return None            # un identifiant en face d'un signe : structures differentes
        if not xi:
            if x != y:
                return None        # ponctuation differente : ce ne sont pas les memes lignes
            continue
        if CYR.search(x):
            if CYR.search(y):
                return None        # la « traduction » est restee russe, elle n'apprend rien
            pairs.append((x, y))
        elif x != y:
            return None            # deux identifiants latins differents : lignes distinctes
    return pairs


def mine(paths):
    votes = collections.defaultdict(collections.Counter)
    for path in paths:
        lines = io.open(path, encoding='utf-8').read().split('\n')
        for i in range(len(lines) - 1):
            ru, nxt = lines[i], lines[i + 1].strip()
            if not CYR.search(ru) or not nxt.startswith('//'):
                continue
            en = nxt[2:].strip()
            if not en or CYR.search(en):
                continue
            got = align(ru.strip(), en)
            if not got:
                continue
            for k, v in got:
                votes[k][v] += 1
    return votes


def main():
    paths = sys.argv[1:]
    if not paths:
        print('usage: python mine.py <fichier.js> [...]')
        return 2
    votes = mine(paths)

    mapping, conflicts, collisions = {}, [], []
    for ru, counter in votes.items():
        ranked = counter.most_common()
        best, n = ranked[0]
        if len(ranked) > 1 and ranked[1][1] == n:
            # Deux traductions a egalite : on ne tranche pas a pile ou face.
            conflicts.append((ru, [r[0] for r in ranked]))
            continue
        mapping[ru] = best

    # Deux noms russes qui viseraient le meme nom anglais fusionneraient deux variables
    # distinctes en une seule. C'est la faute la plus grave possible ici, donc elle sort.
    seen = collections.defaultdict(list)
    for ru, en in mapping.items():
        seen[en].append(ru)
    for en, rus in seen.items():
        if len(rus) > 1:
            collisions.append((en, sorted(rus)))
    for en, rus in collisions:
        for ru in rus:
            mapping.pop(ru, None)

    out = io.open(os.path.join(HERE, 'mined-report.txt'), 'w', encoding='utf-8')
    out.write(u"correspondances retenues : %d\n" % len(mapping))
    out.write(u"conflits (deux traductions a egalite, ecartes) : %d\n" % len(conflicts))
    for ru, opts in sorted(conflicts):
        out.write(u"    %-42s %s\n" % (ru, u' | '.join(opts)))
    out.write(u"\ncollisions (plusieurs noms russes vers le meme anglais, tous ecartes) : %d\n"
              % len(collisions))
    for en, rus in sorted(collisions):
        out.write(u"    %-28s <- %s\n" % (en, u', '.join(rus)))
    out.write(u"\nextrait des correspondances retenues :\n")
    for ru, en in sorted(mapping.items())[:40]:
        out.write(u"    %-42s -> %s\n" % (ru, en))
    out.close()

    with io.open(os.path.join(HERE, 'mined-map.json'), 'w', encoding='utf-8') as f:
        f.write(json.dumps(mapping, ensure_ascii=False, indent=1, sort_keys=True))

    print('correspondances : %d   conflits : %d   collisions : %d'
          % (len(mapping), len(conflicts), len(collisions)))
    return 0


sys.exit(main())
