# Banc d'essai hérité de l'extension

Ces scripts pilotent un navigateur Chromium par CDP pour charger l'extension
`twitch_alternate_player-v2` et mesurer son comportement réel. Ils ont servi à valider la lecture
fMP4, la rédaction du rapport de bug, les quatre états du bouton suivre et les infobulles.

Ils sont conservés ici parce que **la même méthode servira à comparer le lecteur Rust à
l'extension**, et parce qu'ils encodent des connaissances qui coûtent cher à redécouvrir.

## Les pièges qu'ils encodent

- **Chrome 137 et suivants ont supprimé `--load-extension`.** Le contournement par
  `--disable-features=DisableLoadExtensionCommandLineSwitch` ne marche plus non plus. Il faut lancer
  le navigateur avec `--enable-unsafe-extension-debugging` et `--remote-debugging-port`, puis
  installer l'extension par la commande CDP `Extensions.loadUnpacked`.
- **Vivaldi n'accepte pas les sessions CDP aplaties** : `Target.createTarget` puis
  `Target.attachToTarget` avec `flatten: true` ne répond jamais à `Runtime.evaluate`. Il faut passer
  par le WebSocket propre à la cible, récupéré sur `/json/list`.
- **Ne jamais faire `taskkill /IM chrome.exe`** : ça tue les navigateurs ouverts de l'utilisateur.
  Tuer par PID avec `/T`, sur le seul processus lancé par le script.
- Une fenêtre placée en `--window-position=-2400,-2400` reste hors de vue, mais il faut alors
  `--disable-backgrounding-occluded-windows` et `--disable-renderer-backgrounding`, sinon le rendu
  est bridé et la mesure fausse un blocage.

## Les scripts

| Script | Rôle |
|---|---|
| `probe2.py` | Charge l'extension, ouvre une chaîne, échantillonne l'état de lecture. Le plus utile. |
| `admeasure.py` + `analyse.py` | Mesure sur la durée : temps de lecture, tampon, images décodées, périodes de pub. Produit la chronologie des gels et des coupures. |
| `shot.py` | Charge, ouvre une chaîne, sonde le DOM et fait une capture d'écran. |
| `compare.py` | Le même relevé sur deux navigateurs, pour trancher un doute de moteur. |
| `entrycheck.py` | Vérifie l'insertion du bouton de l'extension dans le DOM actuel de twitch.tv. |
| `tipcheck.py`, `followcheck.py`, `reporttest.py` | Vérifications ciblées : infobulles, états du bouton suivre, contenu du rapport. |
| `survey.py` | Recense les conteneurs servis par les grosses chaînes (fMP4 contre MPEG-TS). |
| `settingscheck.py` | Ouvre les réglages et actionne chaque contrôle à la souris : dit lequel est muet, lequel lève, lequel est couvert. |

Ils dépendent de `websockets` et, pour les captures, de `Pillow`. Sur cette machine, seul
`py -3.14` a `websockets` : `python` pointe sur un 3.12 qui ne l'a pas.

## verify.py : toutes les vérifications d'un lot, dans l'ordre

    py -3.14 tools/harness/verify.py --statique      # 7 s : syntaxe, contrôle croisé, auto-test
    py -3.14 tools/harness/verify.py                 # ~3 min : les mêmes, puis le navigateur
    py -3.14 tools/harness/verify.py --accepter      # enregistre l'état comme référence

Huit étapes, arrêt au premier échec : syntaxe des scripts chargés et des JSON, contrôle croisé,
auto-test du contrôle, chaîne en direct, console, lecture, plein écran, réglages.

**Des références, pas des seuils.** Le contrôle croisé et les réglages sont comparés, nom par nom
et contrôle par contrôle, à `tools/rename/crosscheck-reference.json` et
`settingscheck-reference.json`. Un défaut nouveau fait échouer ; un défaut connu est rappelé à
chaque passage ; un défaut disparu est signalé. `--accepter` enregistre l'état du passage : à ne
lancer qu'après avoir lu ce qu'il rapporte. Les références se commitent avec le lot qui les change.

Chaque étape est jugée sur un fait, jamais sur l'absence de message : `probe2` doit sortir en 0
**et** écrire « OK : la lecture a eu lieu » — ses échecs de mise en place sortaient en 0 ; la
chaîne est d'abord vérifiée en direct, par l'aperçu public qui redirige vers une image 404 quand
elle ne l'est pas.

## settingscheck.py : un bouton muet ne se voit qu'en le cliquant

    py -3.14 settingscheck.py chrome <chaîne en direct>
    py -3.14 settingscheck.py chrome <chaîne> --ext <copie mutée>   # prouver qu'il échoue

Tous les contrôles passent par un seul `switch` sur `id || name` : un nom perdu rend le bouton
muet, sans exception ni ligne en console. Ni la console propre ni le contrôle croisé ne le voient.

Ce que le script encode, et qui a coûté un faux verdict chacun :

- **Un vrai clic, pas `el.click()`.** Les boutons − et + des champs numériques écoutent le
  pointeur (mécanisme de glisser) : un clic synthétique ne les déclenche jamais.
- **Survoler avant de mesurer.** La classe `autohide` va et vient avec le mouvement de la souris.
  Mesurée autour d'un clic qui déplace la souris, elle faisait passer un bouton retiré du `switch`
  pour un bouton qui répond. La souris est amenée, la page réagit, puis seulement l'état de
  référence est pris et le bouton pressé sans bouger.
- **Une exception tue tous les boutons suivants.** Elle est rattrapée, `g_bWorkFinished` passe à
  vrai et plus aucun gestionnaire ne répond. Le script recharge le lecteur dès qu'il bascule.
- **Les en-têtes de section n'ont pas de gestionnaire** : un sélecteur CSS plie la section. Leur
  effet se mesure à la hauteur des conteneurs.
- « Réinitialiser » recharge la page : c'est un effet, pas une panne.

Preuve qu'il sait échouer, sur une copie mutée : un `case` renommé dans le `switch` (muet), un
`data-тащилка` renommé sur un bouton − (muet), un `Check(false)` dans un gestionnaire (erreur, et
les contrôles suivants répondent encore). Les trois sont vus.
