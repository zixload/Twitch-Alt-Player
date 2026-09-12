# Outillage de renommage

Quatre scripts, dans cet ordre. Chacun refuse de deviner.

    node scan.js <fichiers.js>              classe chaque occurrence cyrillique
    python mine.py <fichiers.js>            extrait les correspondances deja ecrites en commentaire
    node merge.js                           applique overrides.json par-dessus la mine
    node validate.js merged-map.json --write map-clean.json
    node apply.js map-clean.json <fichiers.js>   [--dry pour un essai a blanc]

## Pourquoi overrides.json existe

Les correspondances viennent des traductions que le mainteneur a ecrites en commentaire, et du
glossaire du depot. Elles ne sont pas toutes bonnes. Le glossaire traduit `Узел` par `Node`, ce qui
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
