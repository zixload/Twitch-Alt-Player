# Twitch Alt Player — Firefox / Zen

La version Firefox de Twitch-No-Ads, générée à partir de la version Chrome par
`tools/firefox/build.js`. Elle a les mêmes fonctions : le lecteur remplace celui de Twitch dans la
vraie page twitch.tv, et la rangée de boutons sous l'image offre le mode cinéma, la vitesse, le
volume et « Watch together ».

## Installation dans Zen ou Firefox

1. Ouvre `about:debugging#/runtime/this-firefox` dans la barre d'adresse.
2. Clique sur **Charger un module complémentaire temporaire…**.
3. Sélectionne `manifest.json` dans ce dossier, ou le fichier `.xpi` qui est à côté.
4. Ouvre une chaîne en direct : le lecteur prend la place de celui de Twitch.

Le XPI n'est pas signé. Un module chargé par `about:debugging` est temporaire : il faut le
recharger après chaque fermeture complète du navigateur. Pour une installation permanente, il
faut faire signer le module par Mozilla. La signature est gratuite. Il porte le même identifiant
que l'ancienne version (`twitch-alt-player@local`), qu'il remplace donc.

## Ce qui diffère de la version Chrome

- Le manifeste est en V2, avec un arrière-plan persistant et un identifiant Gecko fixe.
- Les règles réseau de Chrome sont remplacées par des écouteurs `webRequest`
  (`firefox/network.js`). C'est aussi `webRequest` qui coupe, onglet par onglet, le direct que
  twitch.tv demande pour lui-même pendant que notre lecteur joue.
- Firefox ne donne à une page d'extension placée en iframe dans un site que les API d'un script de
  contenu. `firefox/api-bridge.js` fait passer par l'arrière-plan (`firefox/api-host.js`) ce qui
  manque au lecteur : `tabs.getCurrent`, `permissions.contains` et les cookies de Twitch. Seule la
  page du lecteur peut s'en servir, et seulement pour les cookies de twitch.tv.
- L'arrière-plan ignore de quel onglet vient l'iframe. La page lui demande donc son numéro et le
  transmet au lecteur dans l'adresse de l'iframe.
- HLS.js 1.7.4 est inclus pour l'enregistrement, que Firefox ne lit pas nativement.
- La sortie audio utilise l'API web de Firefox quand elle est disponible.

## Vérifications

Les tests ont tourné dans Zen 1.23 (Gecko 158), avec un profil jetable, piloté par WebDriver
BiDi :

- Le direct joue dans la page Twitch à 60 images par seconde, et la vidéo de Twitch ne charge
  rien.
- Les boutons sont dans la rangée de Twitch.
- L'enregistrement se lit, 15 minutes en arrière.
- Salon partagé entre Edge (version Chrome) et Zen, par le relais en ligne :
  - au direct, 0,00 à 0,02 s d'écart ;
  - en pause, 0,00 s ;
  - dans l'enregistrement, 0,00 à 0,01 s.

En mode headless, Firefox n'a pas de décodeur vidéo distant. L'enregistrement, qui utilise un
second décodeur, n'y démarre pas : il faut une vraie fenêtre pour le tester. Une page en
arrière-plan ne lance pas non plus sa vidéo si `media.block-autoplay-until-in-foreground` est
actif ; un profil de test doit couper cette préférence.

## Générer

    node tools/firefox/build.js [dossier de sortie]

Par défaut, le dossier de sortie est `../Twitch-No-Ads-integre-Firefox-Zen`.
