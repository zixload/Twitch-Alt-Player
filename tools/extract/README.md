# Extraction : un module, un fichier

    npm install                                   # une fois : l'analyseur, comme tools/rename
    node graph.js                                 # ordre de construction et regle de construction
    node extract.js m_Log --dry                   # le plan, sans rien ecrire
    node extract.js m_Log                         # extrait, verifie en memoire, puis ecrit
    node extractcheck.js                          # HEAD contre l'arbre de travail : extraction pure ?
    node extract-selftest.js                      # prouve que les trois savent encore echouer

`verify.py --statique` lance `graph.js` (etape 6) et l'auto-test (etape 7).

## Le probleme que ca resout

Les scripts de l'extension sont classiques : toutes les declarations de premier niveau partagent
une portee globale, et chaque script s'execute en entier des qu'il est charge. Un module est une
IIFE, son corps s'execute a ce moment-la. Decouper `player.js` en fichiers est donc un probleme
d'ordre, et seulement d'ordre : ce qu'un module touche *pendant sa construction* doit exister
avant lui.

`graph.js` le calcule sur le code, pas au texte. Evaluer une instruction, c'est executer ses IIFE,
les fonctions appelees sur-le-champ — locales, globales, ou methodes exportees d'un autre module
(`m_Events.AddHandler(...)` pendant la construction execute le corps d'`AddHandler`). Une fonction
passee a `addEventListener`, `setTimeout` ou `AddHandler` n'est pas suivie. Une fonction passee a un
appele du depot est suivie seulement si le corps de cet appele l'appelle vraiment : c'est ce qui
distingue `createElementEventHandler(fn)`, qui rend un gestionnaire, de `forEach(fn)`.

**Trois moments, pas deux.** Une *microtache* — `then`, `catch`, `finally` — programmee pendant le
chargement s'execute des que le script en cours se termine, avant le script `defer` suivant : la
spec HTML fait un point de controle des microtaches apres chaque script. Ce qu'elle reference doit
etre defini dans le meme fichier ou avant. Une *tache* — evenement, minuterie, rappel `chrome.*` —
ne s'intercale pas entre des scripts `defer` deja prets ; elle ne contraint pas l'ordre.

## Ce que les mesures ont montre

- **Le demarrage d'abord.** La derniere instruction de `player.js` programme le demarrage par une
  chaine de `then` qui atteint `m_Controls`, `m_Player`, `m_Heartbeat` et la plupart des autres. Tant
  qu'elle est dans `player.js`, un module qui a besoin des utilitaires du debut de `player.js` pour
  se construire (`createElementEventHandler`, `ChangeButton`, les constantes...) ne peut aller ni
  avant `player.js` ni apres. Sortie en premier vers un fichier charge en dernier, elle les libere :

      node extract.js --line <ligne de AddExceptionHandler(() => {> --from player.js --as startup.js

  `extract.js m_Controls` refuse tant que ce n'est pas fait, et dit pourquoi.

- **Un douzieme appel de construction.** `m_FullscreenMode` appelle `Update()` a la fin de sa
  construction, et `Update` finit par `m_i18n.GetMessage` via `ChangeButton` et `GetText`. Le releve
  de REPARTITION.md ne suivait que les appels directs. Exception nommee dans `graph.js`, a retirer a
  la reecriture de `m_FullscreenMode`.

## extract.js

Refuse, dans cet ordre : un nom introuvable ou declare dans deux mondes (`m_Debug` : `--from`) ; une
source chargee autrement que par `<script src>` ou un script de contenu du manifeste (un
`getURL('common.js')`, une ressource accessible au web) ; un module qui en appelle un autre que
`m_Log` ou `m_Events` pendant sa construction ; aucune place de chargement valable.

Coupe la declaration avec le bloc de commentaire juste au-dessus, l'ecrit dans `modules/<nom>.js`
sous le meme mode strict que sa source, et l'ajoute a chaque contexte qui charge la source — les
deux, pour `common.js` : `player.html` et les scripts de contenu. La place choisie est juste avant la
source si l'ordre le permet, sinon juste apres, sinon la plus proche qui marche.

Avant d'ecrire, il fait tourner `extractcheck.js` sur le resultat en memoire. Un fichier qui lit
encore le module dans son ancien fichier (`tests/log.test.js` lit `m_Log` dans `common.js`) est
signale « A VERIFIER » : il vit hors de l'extension et l'outil n'y touche pas.

## extractcheck.js

Relit les deux arbres de zero et exige : les memes contextes, chargeant les memes fichiers dans le
meme ordre relatif, plus des fichiers nouveaux ; les memes instructions de premier niveau,
comparees comme arbres syntaxiques (positions et commentaires ignores, tout le reste identique) ;
chaque fichier nouveau issu d'un seul ancien fichier, ordre et mode strict conserves ; le balisage et
le manifeste identiques une fois les entrees ajoutees retirees ; aucune violation d'ordre ni appel
de construction interdit nouveaux.

Un commit d'extraction se verifie seul : `extractcheck.js` compare HEAD a l'arbre de travail, et un
fichier charge modifie ailleurs le fera echouer. C'est voulu. Pour un commit deja fait :
`node extractcheck.js --base <rev>~1 --head <rev>`.

## L'auto-test travaille sur une fixture

`fixture.js` ecrit une extension minuscule — quatre fichiers, une page, un monde de scripts de
contenu — qui porte tous les pieges a la fois : un module qui ne touche rien, un module partage par
les deux contextes, un module qui a besoin du prelude de son fichier pendant que le demarrage le
reclame par une microtache, un module qui en appelle un autre pendant sa construction, un nom
declare dans deux mondes.

La premiere version travaillait sur l'extension et prenait `m_Notification` comme cobaye. Elle a
casse le jour ou `m_Notification` a vraiment ete extrait : le module n'etait plus dans `player.js`,
et les treize cas echouaient pour cette seule raison. Un outil qui doit accompagner toute la phase
ne peut pas dependre de l'avancement de cette phase.

Deux cas restent sur l'extension, parce qu'une fixture ne peut pas les prouver : qu'un vrai module
s'extrait, et qu'apres l'extraction le controle croise, l'appariement des evenements et l'ordre de
construction rapportent exactement ce qu'ils rapportaient avant. Leur cobaye est choisi a
l'execution : le premier module que l'outil accepte encore.

## Limites connues

- Le monde des scripts de contenu est la reunion de toutes les entrees du manifeste, sans departager
  les motifs d'adresse : il ne peut que signaler trop.
- Une fonction passee a un appele inconnu est supposee appelee sur-le-champ, et le rapport le liste
  (aujourd'hui une seule : `ReplaceHandler`, dans `Wait`).
- `worker.js` n'est charge par aucun contexte que l'outil connait (`new Worker`, `importScripts`) :
  l'extraire n'est pas pris en charge.
