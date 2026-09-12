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

Ils dépendent de `websockets` et, pour les captures, de `Pillow`.
