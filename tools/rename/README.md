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
