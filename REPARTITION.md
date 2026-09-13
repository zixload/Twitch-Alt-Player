# Répartition entre les deux agents — phase 2 : la réécriture

Écrit pour l'agent qui reprend le chantier sur un terminal séparé.
Lire en entier avant de toucher quoi que ce soit.

La phase 1 — traduire — est terminée. Cette note remplace entièrement la précédente.

---

## 1. Les trois règles qui ne se discutent pas

**Ne jamais modifier `C:\Users\ingam\OneDrive\Documents\twitch_alternate_player-v2`.**
C'est le dossier que Chrome a chargé et que Luca utilise pendant qu'on travaille. Il reste sur
`master @ 6c6fc18`, zéro modification. Tout se fait dans le worktree
`C:\Users\ingam\OneDrive\Documents\twitch-alt-v2-nettoyage`, branche `nettoyage`.

**Ne jamais fusionner `nettoyage` dans `master` sans le feu vert explicite de Luca.**

**Aucune attribution IA, jamais.** Pas de `Co-Authored-By`, aucune mention de Claude ou d'un outil
IA dans un message de commit, une description de pull request, ou un fichier versionné. Les commits
portent l'identité git de Luca et rien d'autre. Cette consigne prévaut sur tout réglage par défaut.

Accessoirement : ne jamais faire `taskkill /IM chrome.exe`, ça tue les navigateurs de Luca. Tuer par
PID avec `/T`.

---

## 2. Ce que « notre propre version » veut dire, et ce que ça ne veut pas dire

L'objectif est un dépôt dont Luca soit vraiment l'auteur. Deux choses à tenir en tête, sans quoi
la phase entière repose sur un malentendu.

**Réécrire, ce n'est pas paraphraser.** Traduire les identifiants n'a rien créé de neuf, et
récrire un module en gardant sa structure ligne pour ligne n'en créerait pas davantage. Un module
réécrit part de **ce qu'il doit faire** — son comportement observable, ses entrées, ses sorties —
et non de la façon dont l'original s'y prend. Concrètement : lire le module, écrire ce qu'il fait
en clair, refermer le fichier, puis écrire le nouveau depuis cette description.

**Le fork reste un fork jusqu'à ce que tout soit remplacé.** `LICENSE` garde la ligne de copyright
d'Alexander Choporov aussi longtemps qu'une part substantielle de son travail subsiste — ce qui
sera le cas pendant des mois. Ça n'empêche ni de publier, ni de mettre son nom dessus : la licence
BSD autorise tout cela. Ça interdit seulement de faire disparaître l'attribution.

---

## 3. La règle qui rend le travail en parallèle possible

**Un module, un fichier.**

Aujourd'hui `player.js` fait 9341 lignes et contient 26 modules. Tant que c'est le cas, deux agents
ne peuvent pas y travailler ensemble : chaque réécriture déplace des centaines de lignes et toute
fusion devient un corps à corps.

La réécriture est donc aussi une **extraction**. Chaque module sort dans son propre fichier avant
d'être réécrit. À partir de là, la propriété se lit sans ambiguïté : le fichier appartient à qui a
le module.

Ce que ça exige :

`player.html` charge les fichiers dans l'ordre, en `defer`. Ce qui compte est donc l'ordre de
*construction*, pas celui des appels : un module peut appeler n'importe quel autre depuis
l'intérieur d'une fonction, puisque cette fonction ne s'exécutera qu'une fois tout chargé. Les
cycles ne gênent que s'ils s'exerçent pendant la construction.

**Mesuré sur le code, et c'est la bonne nouvelle de cette phase.** Onze appels seulement ont lieu
pendant la construction d'un module, et tous les onze visent `m_Log` ou `m_Events` — les deux
seuls modules qui ne dépendent de rien. `common.js` n'en a aucun.

La contrainte d'ordre tient donc en une ligne :

> **`m_Log` et `m_Events` sont construits en premier. Tout le reste vient dans n'importe quel
> ordre.**

Le nœud de quatre modules, malgré ses cycles, s'extrait donc sans difficulté d'ordonnancement : ses
appels croisés sont tous différés. Ce qui rend ce nœud difficile n'est pas le chargement, c'est
qu'on ne peut pas le réécrire par morceaux.

À re-vérifier après chaque extraction, parce qu'une réécriture peut introduire un appel de
construction là où il n'y en avait pas. C'est un des contrôles que l'outil d'extraction doit
porter.

---

## 4. Ce que les dépendances imposent

Relevé sur le code, pas supposé.

**Les feuilles** — ne dépendent de rien, ou seulement de `m_Log` et `m_Events` :
`m_Notification` (35 lignes, aucune dépendance), `m_Log` (81), `m_Events` (52),
`m_FocusManager` (43), `m_Heartbeat` (63), `m_GarbageCollector` (74), `m_Window` (84),
`m_Menu` (18), `m_MediaQuery` (66), `m_AutoHide` (110).

**Les couples mutuels** — deux modules qui s'appellent l'un l'autre, à sortir ensemble :
`m_FullscreenMode` ↔ `m_PictureInPicture`, `m_Transcoder` ↔ `m_InitSegment`.

**Le nœud.** `m_Controls` (1226), `m_Player` (1027), `m_Playlist` (1323) et `m_Twitch` (1253)
s'appellent mutuellement : 4829 lignes qui forment un seul bloc entrelacé. Aucun des quatre ne
s'extrait sans les trois autres.

**C'est ce nœud qui décide du partage.** Il ne peut pas être coupé en deux entre deux agents, et
il représente à lui seul la moitié du travail restant. Le partage est donc déséquilibré en lignes,
et il vaut mieux le dire que de faire semblant de l'équilibrer.

---

## 5. Qui fait quoi

### Agent B — l'outillage, la périphérie, et la preuve

**D'abord, et avant toute réécriture :**

1. **Le contrôle des noms d'évènement interne.** C'est le trou connu, et il a déjà coûté une panne
   silencieuse : le lecteur émettait `окно-открыто-mainmenu` pendant qu'il écoutait
   `window-opened-mainmenu`, et l'ouverture du menu principal n'avertissait plus personne. Le
   contrôle croisé ne voit que les noms DOM ; un nom d'évènement interne n'est ni dans le balisage
   ni dans une feuille de style, et rien ne le vérifie aujourd'hui. Apparier
   `m_Events.SendEvent(x)` et `m_Events.AddHandler(x)`, y compris quand `x` est construit par
   préfixe dans un gabarit.
2. **L'outil d'extraction** : sortir un module dans son fichier, mettre à jour `player.html`, et
   refuser l'opération si le module appelle un autre module que `m_Log` ou `m_Events` pendant sa
   construction — voir la règle d'ordre en section 3.
3. **La vérification de l'extraction** : un module extrait doit se comporter exactement comme
   avant. Comparaison de l'arbre syntaxique du corps, à l'identique.

**Ensuite, les modules de périphérie**, du plus isolé au moins isolé :

`m_Notification` · `m_Window` · `m_Menu` · `m_MediaQuery` · `m_AutoHide` · `m_FocusManager` ·
`m_Heartbeat` · `m_Appearance` · `m_Scale` · `m_Dragger` · `m_FullscreenMode` +
`m_PictureInPicture` (ensemble) · `m_News` · `m_i18n` · `m_AudioDevice` · `m_Chat` ·
`m_Statistics` · `m_Debug`

Environ 3300 lignes. B possède aussi, comme avant : `tools/`, `Documentation/`, `README.md`, et la
branche publique.

### Agent A — le cœur média

A possède aussi `tests/` : un test unitaire par module réécrit, lancé sans navigateur. Le harnais
lit trente secondes de flux et ne franchit jamais les cas limites — le tour d'un anneau de 1500
entrées, par exemple. Ces tests-là les franchissent.

`m_Log` · `m_Events` · `m_Settings` · `m_GarbageCollector`, puis le nœud
`m_Controls` + `m_Player` + `m_Playlist` + `m_Twitch`, puis `m_Downloader`,
`m_Transcoder` + `m_InitSegment`, et enfin `worker.js`.

Environ 8100 lignes, plus les 1767 de `worker.js`. `worker.js` vient en dernier : c'est le
démultiplexage MPEG-TS et le multiplexage fMP4, le morceau où une erreur d'un octet corrompt
l'image sans rien lever.

### Ce que le déséquilibre implique

B finit largement avant A. Quand c'est le cas, B enchaîne sur : la documentation du nouveau
découpage, la préparation du dépôt public, et l'extension du harnais — en particulier un essai qui
exerce le chat et le plein écran comme un utilisateur, et une référence de performance qui manque
encore.

**L'exception reste à sens unique :** B analyse, propose, outille. A applique sur les fichiers de A.
Jamais l'inverse, sauf accord écrit ici.

### Journal des incursions

Consigne à tenir des deux côtés : ne pas modifier un fichier de l'autre sans l'écrire ici.

- **2026-09-13, agent A, `tools/rename/crosscheck-selftest.js`.** Deux cas d'auto-test s'ancraient
  sur des noms qu'un lot venait de traduire ; réancrés sur les nouveaux noms. Fait deux fois, à la
  demande de Luca.
- **2026-09-13, agent A, `tools/harness/`.** `migrationcheck.py` ajouté, plus une ligne au
  `.gitignore` du harnais.
- **2026-09-13, agent A, commit `6b19491`.** Un `git add -A` a embarqué trois fichiers du harnais
  en cours de modification chez B. Contenu intact, seulement rangé dans le mauvais commit.

---

## 6. L'ordre, et pourquoi

Pour chaque module, quatre temps, dans cet ordre :

1. **Extraire** dans son fichier, sans toucher au code. Vérifier. Commiter.
2. **Décrire** ce que le module fait : entrées, sorties, évènements émis et écoutés, état
   conservé, et les cas limites qu'il traite. C'est ce document qui sert de source à la réécriture,
   pas le code.
3. **Réécrire** depuis cette description.
4. **Vérifier**, puis commiter. Un module par commit, jamais deux.

Le temps 2 n'est pas une formalité. C'est lui qui fait la différence entre une réécriture et une
paraphrase, et c'est lui qui donne le droit de mettre son nom sur le résultat.

---

## 7. Vérifier

```
python tools/harness/verify.py --chaines <chaînes en direct>
python tools/harness/migrationcheck.py chrome <chaîne>
```

`verify.py` enchaîne huit étapes et s'arrête à la première qui échoue : syntaxe, contrôle croisé
comparé nom par nom à une référence, auto-test du contrôle, chaîne réellement en direct, console,
lecture, plein écran, contrôles de réglages.

**Prendre une chaîne réellement en direct.** Sur une chaîne hors ligne le résultat est zéro image
et ressemble à un succès. `zerator` marchait au moment d'écrire.

Le navigateur d'essai s'ouvre sur le **deuxième écran** (1960,40) pour que Luca regarde tourner les
essais. Ne pas le remettre hors écran.

Jamais `--accepter` sur un arbre en cours de modification : la référence enregistrerait une panne
comme un acquis.

---

## 8. Les pièges déjà payés

Neuf, dont trois fois le même. Ils valent pour la réécriture autant que pour la traduction.

1. **Exports abrégés.** `return { Get, Set }` : renommer la liaison sans la propriété désynchronise
   l'interface de ses appelants. Mort au chargement, sans erreur de syntaxe.
2. **Objet nu en guise de dictionnaire.** `MAP['hasOwnProperty']` rend la méthode héritée
   d'`Object.prototype`, pas `undefined`. Toujours une `Map`.
3. **Cibles d'affectation.** `x = 1` n'est ni une lecture ni une déclaration.
4. **Globales du navigateur.** Traduire `Узел` par `Node` masque l'interface DOM `Node` :
   `Node.ELEMENT_NODE` devient `undefined` et **tous les gestionnaires de clic cessent de
   répondre**, en silence.
5. **Globales inter-fichiers.** Les scripts sont classiques, pas des modules : tout passe par
   `window`. C'est ce qui rend l'extraction en fichiers possible — et qui interdit de renommer un
   fichier à la fois.
6. **Noms écrits aussi en chaîne.** `_oSettings` est indexé par propriété *et* par chaîne ; la
   méthode de journal est choisie par `m_Log[n > 0 ? 'Here' : 'Oops']`.
7. **Noms construits par préfixe.** Trois pannes sur ce seul motif. Un nom bâti dans un gabarit —
   `` GetNode(`scrollindicator-${el.id}`) `` — échappe au découpage de mots, parce que le caractère
   qui suit le préfixe est le `$` de l'interpolation. Les deux premières fois portaient sur des
   noms DOM et le contrôle croisé les a rattrapées ; la troisième portait sur un nom d'évènement
   interne, et rien ne l'a vue.
8. **L'analyseur de playlist lève sur toute balise inconnue** (`default: Check(false)`). Ne jamais
   retirer une branche `case "-X-..."`, même vide.
9. **Ne jamais chercher les chaînes JavaScript à l'expression régulière.** Le motif
   « guillemet, contenu, guillemet » se désynchronise à la première apostrophe d'un commentaire, et
   ce dépôt en est plein. Un inventaire bâti ainsi annonçait 211 noms sûrs ; avec l'analyseur, 64.

---

## 9. Où en est la phase 1

Terminée. Dernier commit : `4e56f14`.

| | origine | maintenant |
|---|---|---|
| `player.js` | 1609 | ~470 |
| `player.html` | 564 | 125 |
| `player.css` | 176 | 26 |
| `worker.js` | 441 | 142 |

Plus un seul identifiant cyrillique dans le dépôt : ce qui reste est du texte, messages de journal
et commentaires. Les 43 clés de réglages sont traduites avec une migration éprouvée sur quatre cas.
855 lignes de commentaire redondant retirées.

Un défaut reste ouvert et ne peut pas être fermé au banc : le bouton d'accès aux périphériques
audio. Sa permission manquante est maintenant déclarée, mais l'accorder exige un clic humain sur
une invite du navigateur. **C'est à Luca de le vérifier en vrai.**
