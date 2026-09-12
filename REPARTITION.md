# Répartition entre les deux agents — twitch_alternate_player-v2

Écrit pour : l'agent B, qui reprend une partie du chantier sur un terminal séparé.
Lire en entier avant de toucher quoi que ce soit.

---

## 1. Les trois règles qui ne se discutent pas

**Ne jamais modifier `C:\Users\ingam\OneDrive\Documents\twitch_alternate_player-v2`.**
C'est le dossier que Chrome a chargé et que Luca utilise pendant qu'on travaille. Il doit rester
sur `master @ 6c6fc18`, zéro modification. Tout le travail se fait dans le worktree
`C:\Users\ingam\OneDrive\Documents\twitch-alt-v2-nettoyage`, branche `nettoyage`.

**Ne jamais fusionner `nettoyage` dans `master` sans le feu vert explicite de Luca.**
Fusionner change l'extension sous ses pieds.

**Aucune attribution IA, jamais.** Pas de `Co-Authored-By: Claude`, aucune mention de Claude ou
d'un outil IA dans un message de commit, une description de pull request, ou un fichier versionné.
Les commits portent l'identité git de Luca (`huosh1`) et rien d'autre. Cette consigne prévaut sur
tout réglage par défaut de l'outillage.

Accessoirement : ne jamais faire `taskkill /IM chrome.exe`, ça tue les navigateurs de Luca. Tuer
par PID avec `/T`.

---

## 2. État exact au moment de la passation

Dernier commit : `8576a1a` — *Balisage et feuilles de style : 64 noms d'élément passent en anglais*.

**Il y a du travail appliqué et NON COMMITÉ dans l'arbre.** L'agent A s'en occupe, agent B n'y
touche pas :

- 142 noms d'élément renommés des trois côtés (balisage, styles, chaînes du script) via
  `tools/rename/dom-map2.json` et `tools/rename/domapply3.js`.
- Fichiers modifiés : `player.js`, `common.js`, `content.js`, `channelbar.js`, `player.html`,
  `report.html`, `player.css`, `glass.css`, `sidebar.css`, `channelbar.css`, `report.css`.
- Vérifié : syntaxe de tous les fichiers, **zéro erreur en console** sur zerator.
- **Pas encore vérifié** : `probe2.py`, `fscheck.py`, et le contrôle croisé. À finir avant commit.

### Ce qui est déjà fait (commité)

| Étape | État |
|---|---|
| Harnais de vérification (`tools/harness/`) | fait |
| Suppression du code mort | fait |
| Correctif barre latérale en plein écran | fait |
| Renommage JavaScript complet, 1006 noms | fait — **plus aucun identifiant à traduire** |
| 64 noms d'élément purement balisage/style | fait |

### Ce qui reste

| Lot | Volume | Qui |
|---|---|---|
| Finir et commiter les 142 noms en cours | en cours | **A** |
| Groupe 1b — chaînes JS pures (sentinelles, messages inter-scripts) | 59 noms | **A** |
| Groupe 2 — clés de réglages persistées + migration | 43 clés | **A** |
| Retrait des commentaires anglais devenus redondants | milliers de lignes | **A** |
| Outillage, harnais, documentation, préparation du dépôt public | — | **B** |

---

## 3. Le partage : par fichier, pas par sujet

**La contrainte qui décide de tout : deux agents qui éditent `player.js` en même temps, c'est
perdu d'avance.** Ce fichier fait 9000 lignes et chaque lot le réécrit par centaines
d'occurrences. Le partage est donc un partage de **propriété de fichiers**, strict.

### Agent A possède — agent B n'y touche jamais

```
player.js  common.js  content.js  worker.js  sidebar.js  channelbar.js
background.js  autoclaim.js  gqltoken.js  content_injection.js
player.html  report.html
player.css  glass.css  sidebar.css  channelbar.css  report.css
manifest.json  _locales/
```

### Agent B possède — agent A n'y touche pas

```
tools/harness/      le harnais de vérification
tools/rename/       l'outillage de renommage (scripts, PAS les cartes en cours d'application)
Documentation/      tout
README.md           à créer pour le dépôt public
```

**Exception à sens unique :** agent B peut *produire* des cartes de renommage (fichiers JSON dans
`tools/rename/`) et les proposer. C'est agent A qui les applique aux sources. B analyse et propose,
A applique. Jamais l'inverse.

---

## 4. Le travail d'agent B, par ordre d'utilité

### 4.1 — Combler les trous du contrôle croisé (le plus utile)

`tools/rename/crosscheck.js` compte les références pendantes : un identifiant demandé par le script
ou sélectionné par une feuille de style que le balisage ne porte plus. C'est l'invariant qui garde
les renommages honnêtes — il valait 151 avant, 150 après le dernier lot.

**Il a un trou, et ce trou a déjà coûté une panne.** Il ne lit que les chaînes littérales, pas les
gabarits `` ` ``. Or le lecteur interroge ses contrôles comme ceci :

```js
document.querySelector(`input[name="одновременныхзагрузок"][value="${...}"]`)
```

Le balisage a été renommé, la requête non, `querySelector` a rendu `null`, et le lecteur est mort au
démarrage sur *Cannot set properties of null* — sans que le contrôle croisé voie quoi que ce soit.

**À faire :** faire lire les `TemplateElement` à `crosscheck.js`, comme `domapply3.js` le fait
désormais. Puis chercher les autres chemins non couverts : `setAttribute`, `matches`, `closest`,
les sélecteurs construits par concaténation.

### 4.2 — Rendre le harnais capable de dire « ce bouton ne répond plus »

Aujourd'hui le harnais prouve que le flux joue, que la console est propre, et que la barre latérale
se retire en plein écran. **Il ne prouve pas qu'un bouton de réglage fonctionne encore.** C'est
précisément ce qui a manqué ci-dessus.

Piste : un script qui ouvre la fenêtre de réglages, clique chaque contrôle, et vérifie que la valeur
change. `tools/harness/fscheck.py` montre comment piloter un clic réel par CDP (`Runtime.evaluate`
avec `userGesture: true`).

### 4.3 — Préparer le dépôt public

Le dépôt est un fork de *Alternate Player for Twitch.tv*, BSD 3-Clause, © 2016-2023 Alexander
Choporov (CoolCmd). La licence permet de publier, renommer, modifier, même vendre. Deux obligations
seulement : **conserver `LICENSE` avec sa ligne de copyright**, et ne pas laisser entendre que
l'auteur d'origine cautionne le projet.

À préparer : un `README.md` court — projet en cours, deux ou trois lignes sur les technologies, pas
d'instructions d'installation longues. Ajouter la ligne de copyright de Luca pour ses
modifications, sous celle d'origine. Pas de `CLAUDE.md` ni d'`AGENTS.md` versionné.

### 4.4 — Documentation

`Documentation/` contient des rapports d'archive **périmés** : l'un annonce 11 infobulles russes
actives dans `player.html`, il n'y en a aucune. Vérifier chaque affirmation contre le code avant de
la garder, et dater ce qui reste.

---

## 5. Les huit pièges déjà payés — ne pas les repayer

1. **Exports abrégés.** Les modules finissent par `return { Получить, Установить }`. Renommer la
   liaison sans la propriété réécrit le nom exporté pendant que les appelants gardent l'ancien.
   Mort au chargement, sans erreur de syntaxe.

2. **Objet nu en guise de dictionnaire.** `MAP['hasOwnProperty']` ne rend pas `undefined` mais la
   méthode héritée d'`Object.prototype`. Toujours une `Map`.

3. **Cibles d'affectation.** `x = 1` n'est ni une lecture ni une déclaration : `isReferencedIdentifier()`
   est faux. Il faut aussi `isBindingIdentifier()`.

4. **Globales du navigateur.** Le glossaire du dépôt traduit `Узел` par `Node`, ce qui masque
   l'interface DOM `Node`. `Node.ELEMENT_NODE` devient `undefined` et **tous les gestionnaires de
   clic cessent de répondre, en silence**. `validate.js` porte une liste explicite.

5. **Globales inter-fichiers.** 36 des 48 déclarations de haut niveau de `common.js` sont lues par
   `player.js`, `content.js`, `sidebar.js` — scripts classiques, tout passe par `window`. Renommer
   fichier par fichier est impossible.

6. **Noms écrits aussi en chaîne.** `_oSettings` est indexé par propriété *et* par chaîne ; la
   méthode de journal est choisie par `m_Log[n > 0 ? "Вот" : "Ой"]`. Un nom écrit en chaîne
   quelque part ne bouge nulle part sans son jumeau.

7. **Gabarits.** Voir 4.1. Les sélecteurs vivent souvent dans des `` ` ``.

8. **L'analyseur de playlist lève sur toute balise inconnue** (`default: Проверить(false)`). Ne
   jamais retirer une branche `case "-X-..."`, même vide.

Et un piège d'outillage, pour finir : ne jamais chercher les chaînes JavaScript à l'expression
régulière. Le motif « guillemet, contenu, guillemet » se désynchronise à la première apostrophe
d'un commentaire, et ce dépôt en est plein. Un inventaire bâti ainsi annonçait 211 noms sûrs ;
avec l'analyseur, il y en avait 64.

---

## 6. Vérifier — l'ordre compte, le premier qui échoue arrête tout

```
node --check <chaque fichier touché>
node tools/rename/crosscheck.js            # le total de pendantes ne doit pas augmenter
python tools/harness/errors.py chrome <chaîne> 25    # zéro exception
python tools/harness/probe2.py chrome <chaîne> 40    # doit sortir en 0
python tools/harness/fscheck.py chrome <chaîne>      # barre sans boîte en plein écran
```

**Prendre une chaîne réellement en direct.** Sur une chaîne hors ligne le résultat est zéro image et
ressemble à un succès — c'est exactement ce que le verdict de `probe2` a été ajouté pour empêcher.
`zerator` marchait au moment d'écrire ; `ohnepixel` et `domingo` étaient hors ligne.

Le navigateur d'essai s'ouvre sur le **deuxième écran** (1960,40) pour que Luca regarde tourner les
essais. Ne pas le remettre hors écran.

`probe2` affiche la cadence effective et signale sous 20 images/s. Une alerte n'est pas forcément
une régression : la variante de qualité choisie automatiquement varie d'un essai à l'autre. Mesurer
deux fois avant de conclure.

---

## 7. Si les deux agents doivent quand même toucher au même fichier

Ne pas le faire. Si c'est inévitable : celui qui veut le fichier le demande, l'autre commite son
travail en cours et annonce qu'il lâche le fichier. Jamais de `git stash` nu — le stash est partagé
entre tous les worktrees et l'autre agent peut dépiler le vôtre. Préférer un commit de travail
temporaire.

---

## 8. Retour de l'agent B — 2026-09-12, 22 h

Section écrite par B pendant qu'A était coupé. Le texte au-dessus n'a pas été modifié.

### 8.1 — À corriger par A : casse introduite par `8576a1a`, déjà commitée

`8576a1a` a renommé `id=индикаторпрокрутки-newstext` en `id=scrollindicator-newstext` dans
`player.html`, mais `player.js` construit toujours le nom avec l'ancien préfixe :

```js
// player.js:2277, dans updateScrollIndicator
ShowElement(GetNode(`индикаторпрокрутки-${elScroll.id}`), bShow);
```

`getElementById` rend `null`, `GetNode` lève sur `elElement.nodeType`. Chemin vérifié dans le code :
`OpenHelp` / `OpenNews` → `AddNewsItems` → `configureScrollIndicator` → `updateScrollIndicator`.
Déclencheurs : boutons `openhelp`, `opennews`, `opennews2`, touche **F1**, contrôle des couleurs.
Le harnais ne les touche pas, d'où la console propre sur zerator.

Correctif, une ligne dans un fichier d'A : le préfixe du gabarit devient `scrollindicator-`.
Non testé à l'exécution par B (fichier d'A, et le lot en cours partage l'arbre).

### 8.2 — Le contrôle croisé a changé : refaire la référence

`tools/rename/crosscheck.js` est réécrit, voir `tools/rename/README.md`. Il lit le script avec
l'analyseur (gabarits, constantes, alias de `classList`, `GetNode` nu, paramètres sur un niveau)
et vérifie en plus `name=`, `data-*` et les préfixes construits par gabarit.
`node crosscheck-selftest.js` injecte huit casses d'un seul côté : le nouveau les voit toutes,
l'ancien en voyait deux — et ratait la panne `одновременныхзагрузок` elle-même.

**Les chiffres de `crosscheck-baseline.json` / `crosscheck-apres*.json` ne sont plus comparables.**
Les 150 d'avant étaient presque tous du bruit. Avec le nouvel outil :

| État | Pendantes (extension) |
|---|---|
| `8576a1a` (dernier commit) | 7 |
| arbre avec le lot de 142 noms non commité | 7 |

Les deux listes sont identiques, aux renommages du lot près (`отладка-ошибка` → `debug-error`,
`отладка-отзыв` → `debug-feedback`). **Le lot n'introduit aucune pendante.** Le contrôle croisé
de l'étape « pas encore vérifié » est donc fait ; restent `probe2.py` et `fscheck.py`.

Les 7 : `индикаторпрокрутки-` (8.1) ; cinq `debug-*` de `report.css`, fournis par
`ShowForm(oDocument, nodeForm.id)` que l'outil ne suit pas (le rapport les marque « porte aussi
comme id ») ; `.support`, règle morte depuis `2fa2738` qui a retiré le lien de soutien — supprimable.

**Procédure à changer en section 6 :** comparer les listes du `--json`, pas le total. Un
renommage qui répare une référence et en casse une autre laisse le total inchangé.

### 8.3 — Renommages à faire à la main

La section « CHEMINS NON RESOLUS » du rapport liste ce que l'outil ne suit pas. Deux de ces
lignes portent du cyrillique qu'A renommera, et doivent bouger en même temps que le balisage :

- `player.js:1039` — `` `#${sNodeId} > .вводчисла-число` `` (la classe est vérifiée, l'id non)
- `player.js:2277` — le préfixe de 8.1

### 8.5 — `settingscheck.py` : ce qu'il a trouvé dans l'arbre, lot de 142 noms compris

`tools/harness/settingscheck.py` ouvre les réglages et actionne les 55 contrôles à la souris.
Sur l'arbre actuel : 43 répondent, 10 non essayés (lecture seule, radio déjà cochée, invisible),
et deux vrais défauts, aucun faux positif. Il sort en échec tant qu'ils restent.

1. **`colourcheck` → exception.** Pile relevée à l'exécution :
   `GetNode ← updateScrollIndicator (player.js:2277) ← configureScrollIndicator ← AddNewsItems`.
   C'est la casse de 8.1, confirmée indépendamment de l'analyse statique.
2. **`audiodevices-access` → muet, pour tout utilisateur.** `chrome.permissions.request` y demande
   `contentSettings`, que le manifeste ne déclare pas en permission optionnelle. Réponse du
   navigateur, relevée : *« Only permissions specified in the manifest may be requested »*. Présent
   depuis la copie de départ `bb7fd8e`. Correctif probable, fichier d'A :
   `"optional_permissions": ["contentSettings"]` dans `manifest.json` (retirer et recharger
   l'extension ensuite). Non essayé par B.

Et un défaut que ni l'un ni l'autre outil ne voit, trouvé en lisant : dans `player.html`, la ligne
active de `statistics-server` porte `data-clear` alors que le script ne vide que `[data-очистить]`.
Le champ serveur n'est donc jamais remis à zéro. Présent depuis `bb7fd8e`. Le contrôle croisé ne
le voit pas parce qu'il vérifie qu'un attribut existe *quelque part*, pas sur *chaque* élément.

**À ajouter en section 6**, après `fscheck.py` :
`py -3.14 tools/harness/settingscheck.py chrome <chaîne>` — aucun nouveau MUET, ERREUR ou COUVERT.

### 8.7 — La section 6 tient désormais en une commande

```
py -3.14 tools/harness/verify.py --statique     # 7 s, après chaque modification
py -3.14 tools/harness/verify.py                # ~3 min, avant chaque commit de lot
```

Huit étapes, arrêt au premier échec. Le contrôle croisé et les réglages sont comparés à des
références enregistrées, **nom par nom** : c'est la règle « comparer les listes, pas les totaux »
appliquée par l'outil au lieu d'être rappelée à l'agent. Les deux références actuelles contiennent
les défauts analysés en 8.2 et 8.5 : quand A les corrige, le passage les signale « réparés » ; A
lance alors `--accepter` et commite la référence avec le correctif.

Corrigé au passage : `probe2.py` sortait en 0 quand le navigateur ne démarrait pas ou que
l'extension ne se chargeait pas.

**Le harnais nomme des éléments, et le renommage les déplace.** Premier passage complet : échec à
l'étape « plein écran », « bouton absent », « lecteur : None ». L'extension n'y était pour rien :
le lot de 142 noms a traduit `проигрывательичат`, `переключитьчат` et `скрытьчат`, que
`fscheck.py` cherchait en dur. **A aurait heurté exactement ce mur** en finissant la vérification
de son lot. `fscheck.py` et `probe2.py` cherchent maintenant l'ancien nom puis le nouveau
(`playerandchat`, `togglechat`, `hidechat`, `advert`). Les autres scripts du harnais —
`shot`, `tipcheck`, `followcheck`, `reporttest`, `entrycheck` — ont encore des noms figés ; ils
ne sont pas dans `verify.py`. **Quand un lot renomme un élément que le harnais cite, ajouter le
nouveau nom à côté de l'ancien dans le script concerné** (`grep` du nom dans `tools/harness/`).

### 8.9 — Référence de performance : `admeasure.py` réécrit

**L'ancien `admeasure.py` faisait `taskkill /F /IM chrome.exe` au début et à la fin** : il tuait
tous les Chrome, ceux de Luca et les essais en cours. Ne jamais lancer une version antérieure à
cette réécriture. Il tue maintenant son seul processus, par PID, sur le deuxième écran.

Ce qu'il mesure, en un fichier : première image, images décodées et perdues, cadence, gels
(horloge arrêtée), image figée (horloge qui avance sans nouvelle image), tampon (médiane, 10e
centile, minimum), temps et passages en publicité. Et pendant toute la mesure : charge processeur
et **autres navigateurs d'essai**. Deux navigateurs qui décodent en même temps se font perdre des
images : une mesure prise pendant qu'un autre agent lance `verify.py` n'est pas une référence, et
le script le dit (code 2) au lieu de l'enregistrer.

Il mesure une **copie figée** d'un commit (`--ext`, `--commit`), pas le dossier de travail qu'un
agent modifie pendant les 20 minutes de mesure :

```
git archive <commit> | tar -x -C <copie>      # en Bash : PowerShell corrompt le cyrillique
py -3.14 tools/harness/admeasure.py zerator 20 reference-<commit> --ext <copie> --commit <commit> --enregistrer
```

`--enregistrer` écrit `tools/harness/perf-reference.json` — résumé et contexte seulement.
**Les captures brutes `admeasure-*.json` ne vont jamais dans git** : le lecteur recopie dans son
journal les balises publicitaires entières, jetons `RADS-TOKEN` et identifiants de session compris.

Premier essai (3 min, non propre : un essai d'A tournait) : première image 1 048 ms, 0 image perdue
sur 5 394, 30,2 images/s, aucun gel, tampon médian 9,9 s, aucune publicité.

### 8.8 — Documentation vérifiée contre le code (tâche 4.4)

**`legacy_code_translation_reference.md` a fini son travail.** Audit de ses 671 lignes contre les
cartes appliquées (`map-clean.json`, `manual-map.json`, `dom-map*.json`, `overrides.json`) et le
code vivant :
- 31 paires d'identifiants : toutes appliquées telles quelles, aucune contredite ;
- 622 lignes de code traduites, 348 identifiants cyrilliques : 338 traduits, 7 disparus avec le
  code mort, 3 encore vivants (`Вот`, et deux mots de messages) ;
- à l'inverse, 1 643 des 1 670 noms réellement renommés n'y figurent pas ; et il ne couvre presque
  rien des 549 noms cyrilliques qui restent (chaînes, noms d'éléments, clés de réglages).
**Décision de Luca : supprimé partout** (`a88d587`). `CLAUDE.md` l'annonce encore comme « the
authoritative glossary » : cette ligne est morte. Le vrai registre des renommages JavaScript est
`tools/rename/map-clean.json` — **non versionné**, présent seulement sur le disque.

**Le bug « Zombie Ads » n'est plus ce que `CLAUDE.md` décrit.** `CLAUDE.md` et l'ancien README le
disent ouvert, correctif à faire : valider `START-DATE`. Or `player.js:6725` filtre déjà les
publicités expirées ou lointaines (« STRICT AD FILTER FIX, UPDATED DEC 16 », présent dès la copie
de départ). Si les écrans noirs ont disparu, rien ne le prouve : c'est à mesurer, pas à supposer.

**Code mort, fichier d'A :** `player.js:6599-6614`, « ZOMBIE SEGMENT OVERRIDE ». Le drapeau
`g_bIgnoreAdSegments` est déclaré `false` (ligne 151), remis à `false` (6608), et jamais passé à
`true` nulle part : la branche ne s'exécute jamais, et son commentaire décrit un mécanisme absent.

**`ad-data-structure.md`** se contredit (annonce 22 attributs, en liste 26), repose sur une capture
qui n'est pas dans le dépôt, et le lecteur ne lit que 11 des 26 attributs listés (`CLASS`,
`START-DATE`, `DURATION`, et `X-TV-TWITCH-AD-` suivi de `ROLL-TYPE`, `POD-LENGTH`,
`POD-POSITION`, `LINE-ITEM-ID`, `CREATIVE-ID`, `RADS-TOKEN`, `AD-SESSION-ID`, `AD-FORMAT`). Son en-tête interdit à un modèle de langage de
le modifier : B ne l'a pas touché.

### 8.6 — Dépôt public : branche `public`, historique neuf (décision de Luca)

Worktree `C:\Users\ingam\OneDrive\Documents\twitch-alt-v2-public`, branche orpheline `public`,
un seul commit `1a41bcc` signé huosh1/Proton, sans parent : aucune version ne contient l'adresse
Gmail des anciens commits, un trailer IA ou un fichier d'agent. **Rien n'est poussé.**
`nettoyage` et `master` ne sont pas touchés ; leur historique reste local et privé.

Contenu : l'arbre de `b24f824`, plus README.md, LICENSE et les commentaires du harnais modifiés
par B, **moins** : `CLAUDE.md`, `CLAUDE/`, `.agent/`, `Documentation/archive/`,
`Documentation/Translation/`, `_metadata/`, `player-english-translating-test.js`. Vérifié : 78
fichiers, identiques octet pour octet à la source hors fichiers voulus.

**Pour reporter du travail de `nettoyage` vers `public`** : pas de fusion ni de cherry-pick, les
deux historiques n'ont rien en commun. Appliquer le diff filtré, puis vérifier que `public` égale
la source moins les exclusions, fichier par fichier. **Dernier report : `a88d587`** (23 h 25).

```
git -C twitch-alt-v2-nettoyage diff --binary a88d587..<nouveau> -- . \
  ':(exclude)CLAUDE.md' ':(exclude)CLAUDE' ':(exclude).agent' ':(exclude)Documentation' \
  ':(exclude)_metadata' ':(exclude)player-english-translating-test.js' ':(exclude)REPARTITION.md' \
  > sync.patch
git -C twitch-alt-v2-public apply --check sync.patch && git -C twitch-alt-v2-public apply sync.patch
```

**La forme longue `:(exclude)` est obligatoire** : la forme courte `':!_metadata'` fait lire à git
le `_` comme un modificateur, et le diff sort vide sans que `apply` ne se plaigne vraiment. La
première version de cette procédure avait ce défaut ; elle a été éprouvée et corrigée au premier
report. `Documentation/` est exclu en entier : le glossaire est supprimé, et
`ad-data-structure.md` reste une note de travail de Luca, qu'il réécrira lui-même.

La liste des exclusions vit ici et pas dans le `.gitignore` publié : un `.gitignore` qui nomme
`CLAUDE.md` annonce ce qu'il cache.

**Décisions de Luca (2026-09-12, 22 h 45) :**
- Publication sur un **nouveau** dépôt GitHub — pas `zixload/twitch-alt-player`, dont l'historique
  porte l'adresse Gmail.
- **Rien n'est poussé, et le dépôt n'est pas créé, tant que le projet n'est pas fini, refait et
  optimisé.** La branche `public` se prépare en local jusque-là.
- **Seul zix est crédité.** Aucun tiers dans le README, les messages, les métadonnées. Exception
  imposée par la licence : la ligne de copyright de CoolCmd reste dans `LICENSE`, c'est la
  condition de redistribution de la BSD 3-Clause. Rien d'autre ne la cite.

Le commit unique de `public` a été refait en conséquence, puis à chaque report : **`6c11966`**
(état de `a88d587`, sans `Documentation/`).

**Identité des commits : zix, et non plus huosh1** (décision de Luca, 22 h 50). Cela remplace la
consigne de la section 1. Réglé par `git config --local user.name zix` dans ce dépôt : les trois
worktrees l'héritent, la configuration globale (huosh1, utilisée par ses autres projets) n'est pas
touchée. L'adresse reste `huoshi1@proton.me`. Premier commit signé zix sur `nettoyage` : `2c84d90`
(README, LICENSE, prénom retiré du harnais). Les commits antérieurs restent signés huosh1 ; ils ne
partiront pas, l'historique public est neuf.

À faire par A avant la publication — mentions de tiers dans ses fichiers :
- `manifest.json` : `"author": "Alexander Choporov (CoolCmd)"` → `zix`. Le nom
  `Alternate Player for Twitch.tv (v2)` est aussi celui du produit d'origine : à renommer.
- `_locales/en` et `_locales/ru`, messages ~1054 et ~1154 : textes d'aide qui présentent l'auteur
  d'origine et l'histoire de l'extension sur le Web Store.
- `common.js:744` et `player.js:6942` : `'CoolCmd'` n'y est pas un crédit mais une valeur
  sentinelle. Celle de `common.js` est la valeur par défaut d'un réglage persisté
  (`сНазваниеВарианта`) : la changer demande la migration du groupe 2.

### 8.4 — Fichiers touchés par B

`tools/rename/crosscheck.js` (réécrit), `tools/rename/crosscheck-selftest.js` (nouveau),
`tools/rename/README.md` (section ajoutée) : **commités par B en `6a2c4b9`**, par-dessus `8576a1a`.
`tools/harness/settingscheck.py`, `tools/harness/README.md`, `tools/harness/.gitignore` :
**commités par B en `b24f824`**.
README, LICENSE, prénom retiré du harnais : `2c84d90`. `verify.py`, les deux références,
correctifs de `fscheck`/`probe2`/`settingscheck` : `553a02d`.
`HEAD` a donc avancé de quatre commits depuis `8576a1a` ; le lot de 142 noms d'A est resté intact,
non indexé. **Reprise pour A : lancer `py -3.14 tools/harness/verify.py` sur l'arbre tel quel —
il passait à 23 h 07 avec le lot en place — puis corriger les défauts de 8.1 et 8.5.**
Cette section 8 n'est pas versionnée, comme le reste de ce fichier.
