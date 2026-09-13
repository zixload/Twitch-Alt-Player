# Outillage de renommage

Quatre scripts, dans cet ordre. Chacun refuse de deviner.

    node scan.js <fichiers.js>              classe chaque occurrence cyrillique
    python mine.py <fichiers.js>            extrait les correspondances deja ecrites en commentaire
    node merge.js                           applique overrides.json par-dessus la mine
    node validate.js merged-map.json --write map-clean.json
    node apply.js map-clean.json <fichiers.js>   [--dry pour un essai a blanc]

## Pourquoi overrides.json existe

Les correspondances viennent des traductions que le mainteneur a ecrites en commentaire, et du
glossaire du depot (`Documentation/legacy_code_translation_reference.md`, supprime une fois la
passe JavaScript finie : les 31 paires d'identifiants qu'il contenait etaient toutes appliquees,
et il ne couvrait rien de ce qui reste a traduire). Elles ne sont pas toutes bonnes. Le glossaire traduit `Узел` par `Node`, ce qui
masque l'interface `Node` du navigateur : `Node.ELEMENT_NODE` devient `undefined`, la garde
`if (oEvent.target.nodeType === Node.ELEMENT_NODE)` n'est plus jamais vraie, et tous les
gestionnaires de clic du lecteur cessent de repondre sans lever la moindre erreur.

overrides.json corrige ces cas au cas par cas.

## Ce que l'outil refuse de renommer, et pourquoi

- **Tout nom ecrit quelque part en chaine de caracteres.** `_oSettings` est indexe a la fois par
  propriete et par chaine ; la methode de journal est choisie par `m_Log[n > 0 ? "Вот" : "Ой"]`.
  Deplacer un cote sans l'autre casse en silence.
- **Tout nom present dans un .html ou un .css.** Le schema des reglages est indexe par
  identifiant d'element : `m_Settings.Get(nodeButton.id)`. Le script et le balisage doivent
  s'accorder lettre pour lettre.
- **Les mots reserves du langage et les globales du navigateur.** Voir validate.js.

Ces trois familles bougeront plus tard, dans une passe coordonnee qui renomme les deux cotes a la
fois, avec une migration pour les cles persistees dans chrome.storage.

## Le controle croise : crosscheck.js

    node crosscheck.js --json avant.json        # avant le renommage
    node crosscheck.js --json apres.json        # apres
    node crosscheck-selftest.js                 # prouve que le controle sait encore echouer

Il verifie que script, balisage et feuilles de style s'accordent sur chaque nom : identifiants,
classes, valeurs de `name=`, attributs `data-*`, et prefixes de noms construits par gabarit
(`` `индикаторпрокрутки-${elScroll.id}` ``). Les scripts sont lus avec l'analyseur : gabarits,
constantes (`COLOUR_BUTTON_SELECTOR`), alias (`const oClasses = document.body.classList`),
parametres suivis sur un niveau (`ShowForm(oDocument, "debug-message")`).

**Comparer les listes du JSON, jamais les seuls totaux.** Un renommage peut reparer une
reference et en casser une autre : le total reste egal pendant qu'une recherche vient de casser.
Le cas 8 de l'auto-test le montre.

Deux perimetres, jamais melanges. Les pages de l'extension forment un monde clos : c'est
l'invariant, et le seul total. La page twitch.tv est listee pour information : son DOM est inconnu.

Ce que l'outil ne sait pas suivre est liste sous « CHEMINS NON RESOLUS » — un nom venu d'un
parametre a deux niveaux, d'un `elFrame.id`, d'un `SOURCE[sKey]`. C'est son angle mort : un
renommage qui touche un de ces chemins se verifie a la main.

Le premier jet lisait le script a l'expression reguliere. Il ne voyait ni les gabarits, ni les
`name=`, ni les `data-*`, ni les constantes, ni `GetNode` appele nu, et comptait 150 pendantes
dont presque toutes etaient du bruit. Sur les huit casses de l'auto-test, il en voyait deux.

## L'appariement des evenements internes : eventcheck.js

    node eventcheck.js                          # zero defaut et zero angle mort, sinon sortie 1
    node eventcheck-selftest.js                 # prouve que l'appariement sait encore echouer

Un nom d'evenement interne n'est ni dans le balisage ni dans une feuille de style : il n'existe
que dans deux chaines du script, `m_Events.SendEvent(x)` d'un cote et `m_Events.AddHandler(x)` de
l'autre. Le controle croise ne le voit donc pas. C'est ainsi que le lecteur a emis
`окно-открыто-${sWindowId}` pendant qu'il ecoutait `window-opened-mainmenu` : le menu principal,
le glisser du panneau de statistiques et celui de la taille du chat ne notifiaient plus personne.
Rejoue sur `7fbffdc`, l'outil trouve les trois.

Il apparie par page, parce que chaque page de l'extension est un monde JavaScript a part, sur les
scripts que ses balises `<script src>` chargent : un module extrait dans son fichier est lu sans
rien changer ici. Il signale quatre defauts — envoye sans auditeur, ecoute sans emetteur, retire
sans ajout, trou de motif hors du balisage — et ne compare pas a une reference : l'arbre est a zero.

Les noms se resolvent avec l'analyseur : litteraux, constantes, gabarits, parametres suivis sur un
niveau jusqu'aux appels et aux `new` (`new NumberInput(..., "opacity")`), et proprietes de chaine
hongroises (`oMetadata.sEvent`). Ce qui reste dynamique devient un motif. **Un motif ne suffit pas
a apparier** : `window-opened-${…}` accepterait n'importe quel suffixe, alors ce que remplit le trou
doit etre un id porte par le balisage de la page. Renommer `id=mainmenu` sans renommer
`window-opened-mainmenu` est vu ici.

Ce que l'outil ne sait pas lire est un angle mort, et un angle mort fait echouer : un nom
entierement dynamique, ou le bus utilise autrement que par un appel direct
(`const f = m_Events.SendEvent`). Si une reecriture renomme le bus ou ses methodes, les constantes
sont en tete du fichier ; une page qui n'emet ou n'ecoute plus rien fait echouer aussi, pour que
le renommage ne rende pas le controle muet.
