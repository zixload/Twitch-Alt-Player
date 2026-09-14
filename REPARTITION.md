# Le chantier — phase 2 : la réécriture

Lire en entier avant de toucher quoi que ce soit.

**Un seul agent depuis le 14 septembre 2026.** Cette note a d'abord servi à partager le travail
entre deux agents qui travaillaient en parallèle ; ce partage n'existe plus, et tout ce qui en
dépendait est marqué comme tel plutôt que supprimé — les mesures qui l'ont motivé restent vraies,
et le journal des incursions raconte deux collisions qui ont chacune laissé un garde-fou dans
l'outillage.

La phase 1 — traduire — est terminée. Cette note remplace entièrement la précédente.

---

## 1. Les trois règles qui ne se discutent pas

**Ne jamais modifier `C:\Users\ingam\OneDrive\Documents\twitch_alternate_player-v2`.**
C'est le dossier que Chrome a chargé et que Luca utilise pendant qu'on travaille. Il reste sur
`master @ 6c6fc18`, zéro modification. Tout se fait dans le worktree
`C:\Users\ingam\OneDrive\Documents\twitch-alt-v2-nettoyage`, branche `nettoyage`.

**Ne jamais fusionner `nettoyage` dans `master` sans le feu vert explicite de Luca.**

**Aucune attribution d'outil, jamais.** Pas de `Co-Authored-By`, aucune mention d'un outil
d'assistance dans un message de commit, une description de pull request, ou un fichier versionné.
Les commits portent l'identité git de Luca et rien d'autre. Cette consigne prévaut sur tout réglage
par défaut.

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

**Correction mesurée (agent B, 2026-09-13, `tools/extract/graph.js`).** Deux points de ce qui
précède ne tiennent pas tels quels. La règle reste bonne ; l'outil qui la porte dit où elle plie.

1. **Un douzième appel de construction, et il vise `m_i18n`.** `m_FullscreenMode` appelle
   `Update()` à la fin de sa construction ; `Update` appelle `ChangeButton`, qui appelle `GetText`
   dès que le bouton porte une infobulle, et `GetText` appelle `m_i18n.GetMessage`. Le relevé des
   onze ne suivait que les appels directs. Rien ne casse aujourd'hui — `m_i18n` est dans
   `common.js`, chargé avant tout — mais « tout le reste dans n'importe quel ordre » est faux d'un
   module. Déclaré comme exception nommée dans `graph.js`, à retirer quand B réécrira
   `m_FullscreenMode`.
2. **« Une fois tout chargé » n'est pas vrai des microtâches.** Un `then` programmé pendant le
   chargement d'un script s'exécute dès que ce script se termine, *avant* le script `defer`
   suivant. Or la dernière instruction de `player.js` lance le démarrage par une chaîne de `then`
   qui atteint `m_Controls`, `m_Player`, `m_Heartbeat` et la plupart des autres. Tant qu'elle est
   dans `player.js`, un module qui a besoin des utilitaires du début de `player.js` pour se
   construire ne peut aller ni avant `player.js` ni après : `extract.js m_Controls` refuse, et dit
   pourquoi. **Le premier fichier à sortir est donc le démarrage lui-même**, vers un fichier
   chargé en dernier :
   `node tools/extract/extract.js --line <n> --from player.js --as startup.js`.
   Essayé sur une copie : après lui, `m_Controls`, `m_Player`, `m_Heartbeat` et `m_FullscreenMode`
   s'extraient tous, chacun vérifié. C'est un fichier de A.

---

## 4. Ce que les dépendances imposent

Relevé sur le code, pas supposé.

**Les feuilles** — ne dépendent de rien, ou seulement de `m_Log` et `m_Events` :
`m_Notification` (35 lignes, aucune dépendance), `m_Log` (81), `m_Events` (52),
`m_FocusManager` (43), `m_Heartbeat` (63), `m_GarbageCollector` (74), `m_Window` (84),
`m_Menu` (18), `m_MediaQuery` (66), `m_AutoHide` (110).

**Les couples mutuels** — deux modules qui s'appellent l'un l'autre, à sortir ensemble :
`m_FullscreenMode` ↔ `m_PictureInPicture`, `m_Transcoder` ↔ `m_InitSegment`.

**Le nœud, mesuré.** `m_Controls` (1225), `m_Player` (1023), `m_Playlist` (1312) et `m_Twitch`
(1175) : **4735 lignes**. Le chiffre de 4829 donné plus tôt comptait d'un module au suivant, ce qui
attribuait à `m_Twitch` les 78 lignes de la chaîne de démarrage qui le suit et ne lui appartient
pas.

**Et ce n'est pas un nœud, c'est une étoile.** Relevé par analyse syntaxique, appel par appel :

| de → vers | appels | membres |
|---|---|---|
| `m_Controls` → `m_Player` | 11 | `AddNextSegment ApplyVolume Reload SeekReplayBy SetReplaySpeed TogglePause` |
| `m_Controls` → `m_Twitch` | 11 | 7 membres |
| `m_Controls` → `m_Playlist` | 3 | `ChangeBroadcastVariant Start Stop` |
| `m_Player` → `m_Controls` | 21 | `ChangeState GetState StopWatchingBroadcast UpdateTrackCount getReplaySpeed` |
| `m_Playlist` → `m_Twitch` | 6 | 5 membres |
| `m_Playlist` → `m_Controls` | **1** | `StopWatchingBroadcast` |
| `m_Twitch` → `m_Player` | **2** | `GetBroadcastPlaybackPosition` |

`m_Controls` est le centre. Des trois cycles, **deux tiennent à un seul membre appelé à un seul
endroit**, et les deux sont superficiels :

- `m_Playlist` → `m_Controls.StopWatchingBroadcast()`, dans `_listNotUpdated`, quand le serveur
  répond `ACCESS_DENIED`. « La liste m'est refusée, arrête la lecture. »
- `m_Twitch` → `m_Player.GetBroadcastPlaybackPosition()`, deux fois, pour l'adresse d'enregistrement
  et pour le clip. « Où en est le spectateur en ce moment. »

Le seul vrai couple est `m_Controls` ↔ `m_Player` : 11 appels dans un sens, 21 dans l'autre.

**Ce que ça change pour le partage.** Le bloc indivisible de 4735 lignes devient trois morceaux :
`m_Twitch` (1175), `m_Playlist` (1312), puis `m_Controls` + `m_Player` ensemble (2248). Les
surfaces publiques sont d'ailleurs minces pour la taille — `m_Playlist` fait 1312 lignes et
n'expose que trois membres, dont un seul, `Start`, au reste du lecteur.

Le partage reste déséquilibré en lignes et il vaut mieux le dire que de faire semblant de
l'équilibrer. Mais il n'est plus vrai qu'aucun des quatre ne s'extrait sans les trois autres.

---

## 5. Qui fait quoi

**Un seul agent.** Tout le dépôt : les modules, l'outillage, le harnais, `tests/`, la branche
publique. Ce qui suit reste vrai sur le *contenu* du travail, et n'a plus de propriétaire.

### Où en est la phase — terminée le 14 septembre 2026

Tous les modules sont sortis de `player.js` et réécrits : la périphérie, puis le cœur média dans
l'ordre mesuré en section 4 (`m_Twitch`, `m_Playlist`, `m_Controls` + `m_Player`), puis
`worker.js`. `player.js` ne garde que les constantes partagées, la file de segments, `Segment`,
`NumberInput` et `Terminate`.

Chaque réécriture a été comparée à l'extrait d'origine : verdicts identiques ligne à ligne sur
sa sonde, mutations volontaires signalées, harnais complet au vert. Pour `worker.js`, la sonde
est une comparaison octet par octet sur des segments réels (`tools/worker/`), désormais dans
`verify.py --statique`.

Trois défauts trouvés en route, corrigés chacun dans son propre commit après la réécriture :
un segment fMP4 qui attendait ressortait en discontinuité (`m_Transcoder`) ; Twitch sert ses
variantes dans un ordre tournant, et rien ne les triait — qualité par défaut tirée au sort, menu
dans le désordre (`m_Twitch.sortVariantList`) ; un auto-test d'évènements renommait un seul des
deux côtés depuis que l'émetteur et l'écouteur vivent dans deux fichiers.

Ce qui attend une décision de Luca est listé à la fin de `CLAUDE.md`.

### Ce que le travail à deux a laissé, et qui sert encore

- **`extract.js` refuse de partir d'un arbre sale.** Né d'une collision : une extraction a emporté
  le travail non commité d'un autre agent, et `git commit -- <chemins>` ne le dit pas. La règle
  vaut pour un seul agent aussi — un commit d'extraction se fait seul, et ce qui traîne dans
  l'arbre finit dedans.
- **`verify.py` dit quand l'arbre bouge pendant qu'il mesure.** Né d'un doute : une étape de
  lecture a échoué parce qu'un fichier était réécrit pendant que le navigateur le lisait. Un vert
  qui porte sur deux arbres différents n'est pas un vert.
- **Les auto-tests ne dépendent plus de l'avancement.** L'auto-test de l'extraction travaille sur
  une fixture, celui des évènements cherche ses motifs dans tous les scripts chargés. Un contrôle
  qui accompagne la phase ne peut pas dépendre de l'état de la phase.

### Journal des incursions — clos

Tenu tant que deux agents se partageaient le dépôt : ne pas modifier un fichier de l'autre sans
l'écrire ici. Gardé pour ce qu'il raconte.

- **2026-09-13, agent B, `player.js` et `player.html`, en cours.** Chaque extraction d'un module de
  B retire sa declaration de `player.js` et ajoute une balise `<script>` a `player.html`. C'est le
  seul moyen de sortir un module, et `extractcheck.js` prouve a chaque fois que rien d'autre n'a
  bouge. Un commit par module, et rien d'autre dedans : voir le journal git. Premier :
  `m_Notification`.
- **2026-09-13, agent A, `tools/harness/entrycheck.py`.** L'essai cherchait le bouton injecte sur
  twitch.tv par son identifiant russe, que ce lot traduit : il aurait echoue pour une mauvaise
  raison. Il accepte desormais les deux noms, comme `fscheck.py`, et compte les boutons portant
  l'identifiant -- ce qui prouve la disparition d'un doublon d'amont (voir le commit).
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

`verify.py` enchaîne treize étapes et s'arrête à la première qui échoue : syntaxe, contrôle croisé
comparé nom par nom à une référence, auto-test du contrôle, appariement des évènements internes,
son auto-test, ordre de construction, auto-test de l'extraction, tests unitaires, chaîne réellement
en direct, console, lecture, plein écran, contrôles de réglages. Les huit premières tournent sans
navigateur en vingt-cinq secondes : `--statique`.

Pour un commit de **réécriture**, en plus : la sonde du module dans le vrai lecteur,
`py -3.14 tools/harness/modulecheck.py <module>`. Elle s'écrit depuis la description, avant la
réécriture, et se lance trois fois — sur le module tel qu'extrait, qui est la référence de
comportement ; sur une version délibérément cassée, pour prouver qu'elle sait échouer ; sur le
module réécrit, dont les verdicts doivent être ceux du premier passage. Voir
`tools/harness/README.md`.

Pour un commit d'extraction, en plus : `node tools/extract/extractcheck.js` avant de commiter. Il
échoue si un fichier chargé a changé ailleurs que par le déplacement — un commit d'extraction se
fait seul.

**Prendre une chaîne réellement en direct.** Sur une chaîne hors ligne le résultat est zéro image
et ressemble à un succès. `zerator` marchait au moment d'écrire.

Le navigateur d'essai s'ouvre sur le **deuxième écran** (1960,40) pour que Luca regarde tourner les
essais. Ne pas le remettre hors écran.

Jamais `--accepter` sur un arbre en cours de modification : la référence enregistrerait une panne
comme un acquis.

---

## 8. Les pièges déjà payés

Dix, dont trois fois le même. Ils valent pour la réécriture autant que pour la traduction.

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

10. **Sept tests de version du navigateur ne peuvent plus être vrais.** `manifest.json` déclare
    MV3 et `minimum_chrome_version: 92` ; MV3 lui-même exige Chrome 88. Tout garde en dessous est
    donc mort : `content.js:343` et `player.js:1189` (`< 67`), `player.js:4573` (`<= 68`),
    `worker.js:3` (`< 50`), `worker.js:37` (`< 58`), et deux conditions toujours vraies,
    `worker.js:55` (`>= 70`) et `worker.js:610` (`>= 64` — qui rend le `isMobileDevice() ||` qui le
    précède inutile). Conséquence la plus visible : `WorkerThreadGarbageCollector` est
    inatteignable, et `recycler.js` est un fichier entier que seule cette branche morte maintient
    en vie. **Chaque retrait se fait dans le commit de réécriture du module concerné**, pas en une
    passe éparpillée : c'est la règle « un module par commit ».

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

---

## 10. Où en est la phase 2

| module | agent | état |
|---|---|---|
| `m_Notification` | B | sorti, réécrit |
| `m_Window` | B | sorti, réécrit |
| `m_Menu` | B | sorti, réécrit |
| `m_MediaQuery` | B | sorti, réécrit |
| `m_FocusManager` | B | sorti, réécrit |
| `m_AutoHide` | B | sorti, réécrit |
| `m_Log` | A | réécrit — `4d5e937`, `tests/log.test.js` |
| `m_Settings` | A | réécrit — `f628c6c`, `tests/settings.test.js` + son auto-test |
| chaîne de démarrage | A | sortie dans `modules/startup.js` — `28e58b1` |
| `m_Events` | A | réécrit — `23eeea8`, une seule convention d'appel |
| `m_GarbageCollector` | A | réécrit — `ebfca7e`, `recycler.js` et `Burn` retirés |
| `m_Twitch` | A | réécrit — `5a8f07a`, 119 constats ; les trois fonctions de pub laissées telles quelles |

### Le verrou du démarrage est levé

La dernière instruction de `player.js` programmait le démarrage. Tant qu'elle y vivait, un module
qui a besoin des utilitaires du début de `player.js` pour se construire ne pouvait aller ni avant,
ni après. Sortie dans `modules/startup.js`, elle libère **six modules d'un coup** : les quatre du
nœud de A, et `m_Dragger` et `m_FullscreenMode` chez B. L'outil glisse désormais chaque nouveau
module entre `player.js` et `startup.js`, à la place qu'il lui faut. `extract.js m_Controls --dry`
passe.

Vérifié au navigateur, puisque c'est le code qui lance la lecture : zéro exception, 1802 images à
60 im/s sur caedrel.

### Qui touche quoi en ce moment

- **B est dans `common.js`** pour `m_i18n`. A n'y écrit pas tant que ce n'est pas commité.
  `tests/log.test.js` et `tests/settings.test.js` découpent `common.js` par ancres —
  `const DO_NOT_REDIRECT_ADDRESS`, `const m_Log = (() => {`, `const m_Settings = (() => {` — et
  aucune ne tombe dans `m_i18n` : le sortir ou le réécrire ne les casse pas. S'ils cassaient,
  l'étape 8 le dirait.
- **A est dans `modules/events.js` et `modules/garbage-collector.js`**, puis dans `player.js` pour
  le nœud. B y revient pour `m_Dragger` et `m_FullscreenMode` : un extrait à la fois, commit entre
  les deux, et chacun relit `git log` avant de lancer `extract.js`.

Ordre du nœud, résultat de la section 4 : **`m_Twitch`, puis `m_Playlist`, puis `m_Controls` +
`m_Player` ensemble.**

### Décision de Luca : trois fonctions de `m_Twitch` restent telles qu'elles sont

`sendAdTrackingData`, `sendAdPodImpression` et `createAdEvent`. Le lecteur ne montre jamais les
pubs — `queueSegment` écarte leurs segments — mais, trois secondes après chaque coupure, ces
fonctions envoient à Twitch par `recordAdEvent` une impression, les quatre quartiles et la fin du
bloc, avec `visible: true` et les identifiants réels de l'annonce, de la campagne et de la
commande.

Luca a décidé de les garder **écrites comme elles le sont**. Conséquences pour les deux agents :

- **Personne ne les réécrit**, et personne ne les retire sans nouvelle décision de sa part.
- La réécriture de `m_Twitch` les laisse à l'identique et **garde les interfaces qu'elles
  appellent** — `sendGqlRequest`, `combineGqlRequests`, `createGqlRequestBody`, `Wait` — pour
  qu'elles tournent sans qu'on y touche.
- Elles n'ont pas de test sans navigateur.

Le reste de `m_Twitch` est réécrit normalement. Le suivi « minute regardée » vers
`spade.twitch.tv` n'est pas concerné : il déclare un visionnage réel.

### Deux défauts du banc, vus pendant l'extraction de `m_Twitch` — pour B

- **`probe2.py` échoue sur toute coupure pub.** À l'arrivée d'une pub, le lecteur bascule sur le
  flux sans pub : le temps média repart de zéro et le compteur d'images aussi. Le verdict
  soustrait deux compteurs de sources différentes et obtient un nombre négatif — « la lecture n'a
  pas eu lieu » alors qu'elle continue (état 6, tampon de 12 s). Mesuré sur HEAD, sur gaules.
- **Sur caedrel pendant sa coupure, la sonde perd la cible de la page** dans les dix premières
  secondes (`ConnectionClosedError`), HEAD comme arbre modifié. Le lecteur recharge-t-il sa page
  pendant la pub ? Deux endroits le peuvent : `m_Debug` (`location.reload`) et `m_Twitch.start`
  (`location.replace`). Non tranché.

### Décision : `tests/` est commun, et un critère dit qui y entre

`tests/` était à A seulement parce que A l'a créé. Il devient commun. Mais la règle n'est pas « un
test unitaire par module » : ce serait écrire des tests qui éprouvent surtout leurs propres faux.

**Un module a un test sans navigateur quand il porte un comportement qui survit sans DOM et
qu'une sonde ne peut pas montrer.** L'anneau de `m_Log` qui tourne après 1500 lignes, la
prédéfinie de `m_Settings` qui couvre la valeur rangée, le tampon que `m_GarbageCollector` détache
— rien de tout ça n'atteint un pixel. À l'inverse, un module qui *est* son interaction avec le DOM
se prouve mieux par une sonde qui pilote le vrai DOM qu'avec un DOM imité.

Appliqué à la périphérie :

- **Oui** : `m_i18n` (formats de nombres, pluriels, repli de langue — un pluriel faux est
  invisible à une sonde), `m_Statistics` (~880 lignes de compteurs et de moyennes).
- **Non, la sonde suffit** : `m_Menu`, `m_Window`, `m_FocusManager`, `m_AutoHide`,
  `m_MediaQuery`, `m_Notification`. **Les six modules déjà réécrits par B n'ont donc pas de dette.**
- **À juger module par module** pour le reste, avec ce critère.

Deux obligations pour toute suite qui entre dans `tests/` : un fichier par module,
`tests/<module>.test.js`, pour que la propriété se lise dans le nom ; et **la preuve qu'elle peut
échouer** — un `-selftest.js` qui abîme le module et exige la chute au constat prévu, ou à défaut
une mutation faite à la main et consignée dans le message de commit. Une suite jamais vue en échec
ne mérite pas sa ligne à l'étape 8.

### Trois points à traiter côté B — les trois sont faits

- **Quatre outils auxiliaires étaient cassés** : `shot.py`, `reporttest.py`, `compare.py` et
  `followcheck.py` désignaient encore des noms traduits en phase 1. *Fait (`43f41f3`), plus
  `tipcheck.py`, cassé de la même façon sans figurer dans la liste.* La moitié de ces noms se
  cachaient en échappements `\uXXXX`, invisibles à une recherche littérale du cyrillique. Les cinq
  outils ont été lancés sur une chaîne en direct pour le prouver ; trois défauts sans rapport avec
  les noms sont sortis à cette occasion, dont `compare.py` qui ne mesurait rien sur Vivaldi.
- **Les tests unitaires n'étaient dans aucune chaîne.** *Fait (`7f90a8c`) : étape 8 de `verify.py`,
  deux secondes.* La règle de nommage décide de ce qui tourne : `tests/*.test.js` et
  `tests/*-selftest.js`. Un fichier qui rend 0 sans rien écrire est compté comme un échec.
- **`eventcheck.js` signalait quatre défauts** `window-opened-svg-*`. *Ce n'était pas le découpage
  de `m_Window` : c'était un défaut de l'outil.* Il suivait un paramètre jusqu'aux appels de sa
  fonction en se fiant au seul nom de l'appelé, et `m_Window.Show` et `m_Notification.Show` sont
  homonymes. Corrigé en `6d0a372`, avec un cas de non-régression qui plante les deux côtés du
  piège.
