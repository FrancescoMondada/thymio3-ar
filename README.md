# Thymio 3 — Test RA

Première question d'une vue en réalité augmentée du Thymio 3 : **une tablette retrouve-t-elle les 16 LED du dessus du
robot dans l'image de sa caméra, assez vite, et sous quels angles ?** Cette page ne calcule pas encore de pose : elle
compte les points, les dessine sur l'image et mesure ce que ça coûte.

Même base que les autres projets (Vite, API [`Mobsya/thymio3-ts-api`](https://github.com/Mobsya/thymio3-ts-api) prise sur
GitHub, Web Bluetooth). Textes en français seulement. En ligne : <https://francescomondada.github.io/thymio3-ar/>.

```bash
npm install
npm run dev        # http://localhost:5180 (Chrome : la caméra et le Bluetooth marchent sur localhost)
npm test           # tests JavaScript + tests Python (le vrai script du robot, sur un robot virtuel)
npm run build
```

## Trois façons de trouver les LED

Le robot fait clignoter **4 LED alignées** d'une rangée, **une sur deux (16 mm d'écart)** : côte à côte, à 8 mm, les 16 LED
se confondent dans l'image d'un téléphone. Quatre groupes : avant A, avant B, arrière A, arrière B (indices pairs ou impairs
de la rangée ; ensemble, les 16). Le clignotement est de **2,5 Hz** par défaut (200 ms allumées, 200 ms éteintes ; réglable de
1,25 à 7,5 Hz) : `src/py/leds_lego.py`, mode `blink`. Pas besoin de connaître la phase ni de synchroniser la caméra et le
robot, et à 2,5 Hz une demi-période dure environ 6 images de caméra.

- **Par suivi d'une carte du plan** (par défaut depuis le neuvième essai : `src/homography.js`, `src/evidence.js`, `src/tracker.js`). Reprise à la base,
  « prédire puis vérifier » au lieu de « détecter puis filtrer ». **L'état est une seule chose : l'homographie H** du plan du robot (mm) vers l'image (px) :
  avec elle, chacune des 4 LED de la rangée et chacun des 4 arcs a une place prédite, à n'importe quel zoom et quelle inclinaison, et l'échelle est une
  propriété de H, pas un nombre mesuré sur la rangée. À chaque image, le suivi pose **une question par place** (« y a-t-il une réponse ici ? », dans les cartes
  de la différence, de la couleur du jeu : `blobNear`, rayon de quelques mm autour de la place, plus une part pour la vitesse du téléphone) puis **ajuste H sur
  les réponses**. Plus de seuil sur toute l'image, plus de liste de candidats, plus de fenêtres aux marges du pire cas. Détails : (1) **réponses fraîches et
  anciennes** : P (ce qui vient de s'allumer) dit où est un jeu *maintenant*, N (ce qui vient de s'éteindre) où il *était* il y a 0,1 à 0,3 s ; comme la sortie
  réelle est le maximum sur plusieurs images plus anciennes, un jeu allumé répond aussi dans N, à son ancienne place, aussi fort : P est pris dès qu'il répond de
  façon comparable (≥ 60 % de N), N seulement pour le jeu qui vient de s'éteindre. (2) Les deux jeux clignotant à tour de rôle, chaque image n'a qu'un jeu frais :
  **l'anneau allumé corrige toute la carte** (4 points : homographie par RANSAC ; 3 : correction affine), **la rangée allumée, sur une droite, ne la décale que
  d'une translation**. (3) **Cohérence** : avec 4 points une carte n'a aucune redondance (4 points s'ajustent toujours), donc une réponse dont le déplacement
  par rapport à la prévision n'est pas proche du déplacement médian est écartée (une tache parasite ne tire pas la carte). (4) **Seuil qui suit** : une réponse
  compte au-dessus de max(20, 30 % de la force avec laquelle le jeu répond d'habitude). (5) **Initialisation** par `locate` (4 coins du carré, ou 3 coins +
  les hypothèses du 4ᵉ) : un carré se ressemble tourné d'un quart, donc les 4 tours et les 2 sens de la rangée (`mirror`, retenu : c'est une propriété du robot)
  sont essayés, et la carte n'est acceptée que si **au moins 6 des 8 places répondent** et que la rangée tombe sur les spots vus. (6) Perdue après 8 images
  sans correction ; reprise aussitôt par `locate`. Sortie : H, échelle, nombre de réponses par jeu, écart, état (acquise / suivie / dérive / perdue).
- **Par différence de deux images** (par défaut, `src/pairdiff.js`). Pour chaque image, la page garde le *vert en excès*
  `max(0, G − max(R, B))` de chaque pixel et le compare aux images vieilles de 0,4 à 1,6 demi-période : ce qui **monte** (LED
  allumée maintenant, à sa place maintenant) ou **descend** (LED allumée avant, à sa place d'alors) est une LED. Le corps, la
  table, l'anneau ambre, les lumières bleue, rouge, cyan, magenta, les reflets blancs ne changent pas ou n'ont pas de vert :
  ils disparaissent. **Marche quand le téléphone bouge** : une LED qui s'allume apparaît dans la différence où qu'elle soit
  dans l'image. Sur les vraies photos, une LED allumée donne 170 à 210 sur cette mesure.
- **Par clignotement sur 1 s** (`src/lockin.js`) : pour chaque pixel, ce qui varie au rythme du robot dans les 2,5 dernières
  périodes (détecteur à verrouillage). Plus sélectif en fréquence, mais **le téléphone doit rester posé** : dès que l'image
  bouge de 2 à 4 diamètres de LED par seconde (moins d'une dizaine de pixels par seconde), il ne voit plus rien. C'est ce qui a
  fait échouer le deuxième essai sur téléphone (voir plus bas). Deux signaux : *couleur* (par défaut) et *toute variation*.
- **Par luminosité** (LED fixes) : plus clair que le seuil *et* que les voisins, de forme ronde, avec la couleur du point.

**Deuxième jeu : 4 arcs du cercle** (étape 1 de la pose, `src/square.js`). Les 8 LED du cercle autour du pavé sont des arcs ambre
d'environ 45° (le firmware les nomme N, NE, E, SE, S, SW, W, NW). Le robot peut en faire clignoter 4 : **NE SE SW NW** (un
carré dont les côtés sont parallèles aux axes du robot, donc deux d'entre eux à la rangée de LED vertes si le nord pointe vers
le nez) ou **N E S W** (un carré tourné de 45°). Avec des LED vertes ET des arcs, ils clignotent **à tour de rôle** (la rangée est
allumée quand le cercle est éteint, et inversement) ; la couleur dit lequel est lequel : vert pour la rangée, ambre pour les
arcs (`PairDiff` avec la mesure *ambre* `R ≥ 0,75 G ? min(R, G) − B : 0`, tolérante : dans l'image du téléphone les arcs sont **jaune saturé**, (255,255,24), R et G égaux au bruit près, et la première mesure `R ≥ G ? G − B : 0` perdait un pixel sur deux selon le bruit : sur la photo où 6 des 8 arcs sont allumés, elle trouve
exactement ces 6, et ni le bois de la table, ni les lueurs du corps, ni la lueur rouge, ni les LED vertes).
Filtre de forme : de tous les points ambre, la page garde 4 points qui font un quadrilatère convexe pas trop plat (côtés
opposés à moins de 2 fois l'un de l'autre, diagonales qui se coupent près de leur milieu : entre 30 % et 70 %, **de même taille** : rapport des
surfaces ≤ 4, car ce sont 4 fois le même arc). **Parallélisme** : le point de fuite de
deux côtés opposés doit se trouver sur la droite de la rangée ; l'écart est mesuré et affiché (≈ 0,02 si les côtés sont
parallèles à la rangée, 0,3 à 0,7 pour le carré tourné de 45°), pas imposé (option `preferParallel`, désactivée tant qu'on n'a pas
vu sur le robot que le nord du cercle pointe vers le nez).

**Prédiction croisée et échelle** (`src/layout.js`, `src/locate.js`). On sait où sont les LED sur le robot (plan, en mm : arcs à 26 mm
autour de (0, 26), rangées de LED à y = −7 et −15, 16 mm entre deux LED d'un groupe) : sur la photo des arcs, 16 mm = 84 px et le carré
des arcs donne la même échelle (5,3 px/mm), et le centre du cercle est à 33 mm de la rangée. Un jeu bien vu donne donc l'échelle et dit où
l'autre doit être : la rangée dit où chercher les arcs, les arcs disent où chercher la rangée. Tout est exprimé en rapport à l'échelle mesurée dans
l'image, donc **au même titre à tous les zooms** (testé de 1 à 5 px/mm) ; les tailles minimales viennent de l'échelle (un cinquième d'un côté du
carré, un quart de l'écart entre LED) et, avant d'avoir une échelle, d'une fraction de l'image (1,2 % et 0,7 % de son grand côté), pas de pixels
fixes. Trois usages : (1) si un jeu manque, on le cherche parmi les candidats **dans la fenêtre** prédite ; (2) s'il n'y en a pas, on regarde
encore dans la fenêtre seule avec un **seuil plus bas** (45 % du seuil des arcs, 60 % de celui de la rangée), sans le bruit du reste de
l'image ; (3) si les deux sont trouvés mais ne vont pas ensemble (le carré hors de la fenêtre de la rangée, ou l'inverse), on prend la meilleure paire
cohérente ou on signale une incohérence. La fenêtre « arcs depuis la rangée » dépend de la hauteur de la caméra (le gyroscope du téléphone) :
regardée dans l'axe de la rangée, l'échelle mesurée le long d'elle est réduite de sin(hauteur) alors que les distances en travers ne le sont
pas ; elle couvre de 14 % (au-dessus de 70°) à 43 % (20–35°) d'une image portrait, celle « rangée depuis les arcs » 7 à 9 %. Elle est dessinée
en pointillés quand elle sert. Les échelles de la rangée et du carré sont comparées (rapport entre 0,4 et 2,5), sinon incohérence signalée.

**Filtre d'alignement** (`src/aligned.js`, quand 4 LED clignotent) : de tous les points trouvés, la page ne garde que 4
(ou 3, signalé) **sur une droite, à intervalles réguliers** : les écarts le long de la droite ne varient que
progressivement (jamais plus de 1,8 fois le voisin, 3 fois le plus petit), les points sont à moins de 6 % de la longueur
+ 1 px de la droite. Les autres points sont dessinés en gris. Une fausse détection tombe rarement sur la droite.

## Ce que fait la page

- **Caméra** (arrière par défaut) ou **scène simulée** : `?demo`, avec `&blink` (LED clignotantes), `&extra` (lumières fixes
  d'autres couleurs), `&shake=2` (la main qui tremble), `&sway=20` (le téléphone qui balance à la main, 20 px de chaque côté),
  `&elev=30` (angle fixé), `&group=-1` (les 16 LED ; `-2` : aucune), `&circle=0` (arcs N E S W ; `-1` : aucun), `&half=100` (clignotement 5 Hz), `&detect=blink` (autre détection). Elle ne montre que la *géométrie* (quand les
  LED se touchent dans l'image), pas la vraie lumière des LED vues de côté.
- **Vu de côté ?** : l'angle entre l'axe de la caméra et la table (capteur d'orientation) et un tableau « combien de
  points vus à chaque angle », par tranches de 15°. Dessous : **le mouvement du téléphone** (gyroscope, `devicemotion`, en °/s) et un
  tableau « part des images où tous les points sont trouvés » selon qu'il est immobile (< 5 °/s), lent (5 à 30) ou rapide (> 30) :
  il dira d'où viennent les images perdues.
- **Vitesse** : images reçues et analysées par seconde, retard caméra → page, durée de lecture et de recherche, et **images
  analysées par période de clignotement** (il en faut au moins 5). La taille analysée se règle par le **côté long** (480 px par
  défaut) : un téléphone tenu droit donne du 720×1280.
- **Robot** : *Connecter le robot et lancer* envoie `leds_lego.py` au robot, avec le mode choisi (LED clignotantes,
  allumées en continu, éteintes), les LED vertes (une des 4 rangées partielles de 4 LED, les 16, ou aucune), les arcs ambre
  (carré NE SE SW NW, carré N E S W, ou aucun ; par défaut : avant A + carré NE SE SW NW, en alternance) et la vitesse ; changer l'un d'eux renvoie le script. Il faut un script **sur le robot** : le comportement par défaut (gyroscope), le mode
  leçons et le mode cartes dessinent déjà sur ces LED, et une commande Bluetooth serait écrasée (elle ne monte d'ailleurs
  qu'à 15 : 15/16 de PWM à 50 Hz scintille, 16 non). Tant qu'il tourne, ces affichages sont interrompus.
- **Rapport** : tout ce qui précède en texte, à copier.

## Essayer sur un téléphone ou une tablette

La caméra et le Bluetooth exigent https (ou localhost). `.github/workflows/deploy.yml` publie la page sur GitHub Pages à
chaque push sur `main`. Android : Chrome. iPad : Bluefy. Sans Web Bluetooth, la caméra se teste quand même (`?detect=bright`
avec des LED allumées autrement).

## Outil : tester sur des photos

```bash
node scripts/detect-photo.mjs photos/robot.jpg --width 1280 --color vert --out annotee.png --mask masque.png
node scripts/detect-photo.mjs photos/allumees.jpg --off photos/eteintes.jpg --out difference.png
```

(macOS : lit les photos avec `sips`.) Le premier passe la détection par luminosité sur une photo ; le second fait la
**différence** entre une photo LED allumées et une photo du même point de vue LED éteintes (trépied ou main très stable).
Le dossier `photos/` est ignoré par git : ce sont des photos de test personnelles, elles restent sur l'ordinateur.

## Ce qu'on sait, ce qu'on ne sait pas

Vu sur les photos de l'utilisateur (Samsung, vues de dessus et de côté vers 35–45°) :
- les 16 LED sont une **grille 2 × 8, pas 8 mm**, au milieu de la grille de têtons, vertes, chacune allume son tenon ;
  elles se voient une à une de dessus et de côté vers 35–45° ;
- d'autres LED restent allumées même quand le script a coupé les comportements : un voyant bleu sur l'avant, une lueur rouge au
  pied du robot, un trait vert dans le passage de roue, une lueur verte dans le trou du stylo ; avec tous les modes, l'anneau
  ambre et les 4 LED du corps (magenta, cyan…) ;
- un tenon éteint vaut environ (152,167,158), allumé (143,251,19) avec un cœur presque blanc.

**Quatrième essai** (2026-11-07, version 11b4502 : rangée avant A + arcs NE SE SW NW en alternance, 2073 images, 90 s) : la rangée est
trouvée comme avant, mais **les arcs rarement** : tous les points (8) dans 25 à 43 % des images à 45–90° et 72 % à 30–45° ; même téléphone
immobile (< 5 °/s) seulement 37 % d'images complètes (781 images), 29 % en mouvement lent (1170), 20 % en rapide (122) : le mouvement n'est donc
pas la cause principale. Photo des arcs fournie ensuite : les 4 arcs NE SE SW NW ressortent jaune saturé, blocs compacts de 28×30 px (300 à 430 px²,
tous de la même taille) à la taille analysée (270×479), valeurs 230 sur la mesure ambre, tenant même à un seuil de 120 ; le bois y vaut ≤ 42. Une
simulation de la scène de l'utilisateur (bois orange, arcs jaune saturé bruité, balancement) donne, au seuil unique de 50, **60 faux candidats par
image** et 50 à 56 % de carrés trouvés, contre 81 à 89 % avec un seuil de 80 : d'où un seuil propre aux arcs (80 par défaut, réglable), la mesure
ambre tolérante, la contrainte de même taille, et la prédiction croisée (idée de l'utilisateur, avec la taille qui varie avec le zoom).
**Pas encore réessayé sur le téléphone.** Le rapport affiche maintenant, par jeu : candidats trouvés, part d'images où il est retenu, réponse
maximale, part sauvée par la prédiction, échelle mesurée.

**Cinquième essai** (2026-11-07 12h21, version 31cb3a3 : seuils par défaut 50 / arcs 80, analyse en 540×960 : l'utilisateur avait pris 960 px, d'où
14,5 images analysées par seconde au lieu de 22,9 à 480 px, 5,8 par période de clignotement ; lecture 30 ms + recherche 30 ms) : **43 % des
870 images sont complètes** (8 points sur 8), contre 37 % au quatrième essai (à l'arrêt 40 % contre 37, mouvement lent 47 % contre 29, rapide 33 %
contre 20). Dans les 60 dernières images la rangée a une réponse maximale de 13 sur 255 (0 candidat) et le carré est trouvé dans 8 % : **le
téléphone ne visait pas le robot** (l'utilisateur lisait les réglages), ce qui explique ce moment et le profil « tout ou rien » (en moyenne 2,4
points sur 8 dans les images incomplètes) : 43 % est donc un minimum. Pendant ces images la réponse des arcs allait jusqu'à 107, au-dessus du seuil
de 80, mais sans la rangée il n'y a pas de fenêtre ni de rattrapage. Les seuils n'ont pas été modifiés par l'utilisateur : rien dans ce rapport
ne demande de les changer (une rangée à 13 est invisible, aucun seuil ne la rattrape ; les arcs à 107 passent le seuil).
Le rapport donne maintenant une **chronologie par tranches de 10 s** : images, part « hors robot » (rien ne répond : réponse maximale des deux
jeux sous 25 : le téléphone vise ailleurs), puis, sur les images où quelque chose répond, la part de rangée trouvée, d'arcs trouvés, des deux,
sauvées par la prédiction, la réponse maximale de chaque jeu et le mouvement du téléphone ; un changement de réglage ouvre une nouvelle ligne.

**Sixième essai** (2026-11-07 13h18, version b80584d, 480 px, 107 s, 1839 images, exposition verrouillée en cours de route) : 1 % hors robot ;
sur les autres : rangée 75 %, arcs 46 %, les deux 46 %, 39 % sauvées par la prédiction. La chronologie raconte trois périodes.
**0 à 20 s** : rangée 2 à 12 %, arcs 0 à 10 %, alors que les deux jeux répondent (réponses maximales 88–109, au-dessus des seuils 50 et 80).
**20 à 67 s** (seuils 50 / 80, exposition automatique puis, vers 53–60 s, verrouillée) : rangée 82 à 98 %, les deux 71 à 98 %, dont 37 à 98 %
**sauvées par la prédiction** : la prédiction croisée marche sur le téléphone ; les arcs ont une réponse maximale de 161–214 (puis 138 vers 60 s).
**À partir de 67 s** : le seuil des arcs est à **155** (le réglage change dans la chronologie : le curseur a été touché par erreur, probablement en
faisant défiler la page vers le bouton d'exposition), la rangée reste à 92–100 % mais les deux ne sont plus trouvés que dans 21 à 35 % des
images (arcs à 138–161 de réponse maximale, sous le seuil, rattrapés seulement par la fenêtre). La baisse perçue « après le verrou » est donc
au moins en grande partie l'effet du seuil à 155 ; un effet du verrou sur la réponse des arcs (210 → 140) n'est pas exclu : « Verrouiller »
passait en mode manuel **sans fixer la durée du moment**, et la caméra a pris 199,9 (20 ms), peut-être une valeur par défaut plus longue que celle
choisie par l'exposition automatique. Mesure : 13,5 images analysées par seconde (5,4 par période), lecture 38,9 ms, recherche 10,6 ms ; l'échelle
vue va de 6 px (dernière image) à 11–27 px entre deux LED d'un groupe : la distance a beaucoup varié.
Changements : réglages avancés **repliés** (les curseurs sont sous le pouce quand on fait défiler), un bandeau et une ligne du rapport quand un
réglage n'est pas à sa valeur par défaut, un bouton « Remettre les valeurs par défaut » ; « Verrouiller l'exposition » garde la durée du moment ;
un bouton « Exposition courte (4 ms) » (à essayer : les LED ressortent mieux sur un corps plus sombre ; pas démontré) ; l'état de l'exposition et
l'écart entre LED (px) dans la chronologie ; **taille d'analyse automatique** (480 → 640 → 960 quand deux LED d'un groupe sont à moins de
11 px, retour quand elles dépassent 42 px, avec un délai de 6 s ; si rien n'est trouvé alors que quelque chose répond, une taille plus grande est
essayée). Test synthétique : sans flou, la détection tient jusqu'à 6 px entre deux LED (100 %), tombe à 5 px ; le flou et la réduction d'une vraie
caméra la font tomber plus tôt, d'où la taille automatique.

**Septième essai** (2026-11-07 13h40, version 7e113e6 : réglages par défaut, taille automatique, 142 s, 1576 images, aucune exposition changée) :
rangée 80 %, arcs 48 %, les deux 48 %, 43 % sauvées par la prédiction (essai précédent : 46 %). Chronologie : 0–10 s rien (la taille passe de 480 à 640 puis
960 : la page cherchait une échelle) ; 10–20 s rangée 1 %, LED à 7 px à 960 (très loin) ; **dès 20 s** rangée 91 à 100 % et les deux entre 45 et 90 %
(79, 90, 64, 56, 50, 50, 46, 45, **0** [arcs à 60 de réponse seulement], 70, 84, 83, 23). Selon l'angle : 57 % d'images complètes à 75–90°, 52 % à 60–75°,
**31 % à 45–60°** ; immobile 46 %, lent 48 %, rapide 36 %. La taille est restée à **960** pendant deux minutes (écart de 15 à 33 px à 960, soit 10 à 22 px à
480) : 11,9 images analysées par seconde, 4,7 par période (sous le minimum de 5), recherche 37 ms, parce que la règle ne redescendait qu'au-delà de 42 px.
L'utilisateur a vu, sur l'écran, que **la zone de recherche des arcs, centrée sur les 4 LED de la rangée, exclut parfois un arc**. Mesure en simulation :
quand le téléphone croit viser plus haut que la réalité (l'axe de la caméra n'est pas la direction vers le robot, qui est plus bas quand il est en haut
de l'image : 25 à 40° d'écart), l'ancienne zone laissait un arc dehors dans 1 % (erreur 25°) à 8 % (erreur 40°, caméra le long de la rangée, comme sur la
capture) des cas ; avec une marge de 30° sur l'inclinaison, 60 mm de chaque côté du milieu de la rangée et un facteur 1,2, aucun. La zone couvre alors
24 à 34 % d'une image portrait à partir de 50° de hauteur et près de 70 % en dessous de 50° (là, elle ne filtre presque plus, mais la géométrie ne
contraint pas davantage). Sur la capture, 4 candidats ambre faisaient un quadrilatère rejeté (côtés 31 et 65 px, rapport 2,1 > 2) pendant que l'arc en
bas à gauche, bien allumé, manquait : c'est le cas où **3 arcs sur 4 sont trouvés**. Nouveau : le **4ᵉ arc est prédit** à A + C − B d'après trois coins
consécutifs (on ne sait pas lequel des trois est le coin du milieu : chaque hypothèse est essayée), et cherché **là seulement**, dans un disque, avec un
seuil plus bas ; le carré à 3 arcs est compté 3 sur 4 et le 4ᵉ attendu est dessiné en pointillés (`&arcdim=3&dimgain=0.3` dans la simulation). La règle de
taille automatique redescend maintenant quand l'écart resterait d'au moins 15 px à la taille inférieure.

**Huitième essai** (2026-11-07 13h58, version 021c987, 193 s, 1361 images, réglages par défaut) : rangée 93 %, arcs 73 %, les deux 73 % (7ᵉ : 48 %),
61 % sauvées par la prédiction ; images complètes 73 % à 75–90°, 59 % à 60–75°, 49 % à 45–60° ; immobile 63 %, lent 59 %. **La taille automatique a
oscillé 480 → 640 → 960 → 640 → 960 → 640 → 480 → 640** (chaque changement vide la mémoire du détecteur) et c'est à **960 que c'est le pire** :
31 %, 56 %, 48 % d'images complètes contre 88 à 99 % à 480 et 640 (et seulement 12 à 15 images analysées par seconde, sous le minimum de 5 par période) :
l'échelle automatique est maintenant plafonnée à 640 (960 reste au menu). Sur la capture de dessus, **la zone de recherche des arcs était tracée comme un nœud
papillon** : les deux demi-cercles des extrémités du stade creusaient vers l'intérieur au lieu de déborder. Pire, **le rectangle de recherche** (`bbox`),
calculé à partir de ce polygone, n'était que la bande entre les deux extrémités de la rangée, sans la marge de D le long d'elle : la recherche à seuil
bas ne regardait pas là, alors que le test d'appartenance (`inside`) était juste. En vue de dessus, l'arc du haut était juste au bord de cette bande.
Corrigé (le contour est un vrai stade convexe à distance D du segment, le rectangle est celui du stade) avec des tests qui auraient attrapé le défaut :
contour convexe et à distance D, tout point intérieur est dans le rectangle, pour les trois fenêtres.

**Neuvième étape** (2026-11-07, version après d609000 : suivi d'une carte du plan ; **pas encore essayée sur le téléphone**). Mesures sur scène synthétique (les
cartes P et N dessinées d'après la géométrie du robot et un modèle de caméra, avec les fantômes de la vraie sortie) : main qui balance : 100 % d'images complètes
(8 réponses), les places prédites à 0,2 px près (médiane), 4 px (90 %), 7 px au plus ; 12 images par seconde : 97 % ; 3 arcs visibles : suivi dans 99 % des images et
le 4ᵉ arc, invisible, prédit à moins de 8 px ; arcs à moitié de lumière (50 sur 255) : 96 % complètes, à un tiers (36) : suivi mais carte moins exacte (75 % complètes) ;
zoom de 150 à 450 mm : ≥ 93 % des images avec 7 réponses ; taches parasites deux fois plus fortes que les LED (6 par carte) : 91 % ; main une fois et demie plus vite :
≥ 97 % suivies ; **deux fois plus vite** (50 °/s en continu) : la carte dérive pendant que la rangée est allumée (translation seule) et se perd si l'initialisation n'est pas
refaite ; la reprise par `locate` l'assure dans la page. Dans le volet (`?demo&blink&extra&sway=20&elev=60`) : 618 images, **1 acquisition, 0 perte, 100 % suivies,
8 réponses sur 8 à chaque image** (alors que la même scène avait 28 acquisitions en 45 s avant la correction « P d'abord ») ; initialisé depuis 3 arcs avec un arc presque
éteint (`&arcdim=3&dimgain=0.1`) : 1 acquisition, 0 perte, 7 réponses sur 8. Ce qui reste : la prédiction par le **gyroscope du téléphone** (pour suivre les mouvements
rapides pendant que la rangée est allumée), l'IMU du robot, la pose (inclinaison et distance) tirée de H avec une focale approchée.

**Premier essai sur un téléphone** (Android, Chrome, 2026-11-06) : 0 point. 5,9 images analysées par seconde (analyse en
720×1280 : 125 ms par image, quatre fois plus de pixels que mesuré), un clignotement à 7,46 Hz (sous-échantillonné), le script
du robot arrêté au moment du rapport. Remarques de l'utilisateur : fréquence trop haute et pas synchronisée avec l'image ; les
LED ne se distinguent pas les unes des autres. D'où : 2,5 Hz, analyse par le côté long, 4 LED écartées à la fois.

**Deuxième essai** (2026-11-06, 21h15) : l'utilisateur confirme que les 4 LED allumées sont bien écartées. Rapport : 0 point,
25 images reçues et 10 analysées par seconde (taille choisie : 540×960, 85 ms par image, 4 images par période), réponse
maximale 10 sur 255 avec le seuil réglé à 118 ; 8 images sur 115 avaient trouvé les 4 LED à 75–90°, puis plus rien à 60–75°
pendant que le téléphone était incliné. **Explication retenue** (par simulation, pas encore confirmée sur le téléphone) : le
détecteur sur 1 s suppose que chaque LED reste sur son pixel pendant une seconde, ce que ne fait aucun téléphone tenu à la main
(il s'effondre dès 2 diamètres de LED par seconde, soit environ 13 px/s en 480 px). D'où : la **différence de deux images**
par défaut, et le **filtre d'alignement** (idée de l'utilisateur) avec 4 LED alignées. **Pas encore réessayé sur le téléphone.**

**Troisième essai** (2026-11-06, 21h34, version 487fb51 : différence de deux images, 4 LED alignées « avant A », 2,5 Hz,
480 px, téléphone tenu à la main et incliné de 15° à 90°) : **les 4 LED sont retrouvées dans environ 94 % des 1571 images
(une minute)**. Par angle de vue : 75–90° 100 % (17 images), 60–75° 95 % (657), 45–60° 90 % (616), 30–45° 98 % (275), 15–30°
100 % (6), 0–15° pas essayé. Au dernier instant : 8 points trouvés, 4 retenus par le filtre d'alignement (droite à −48°,
intervalles 26/23/22 px). Cadence : 30 images reçues, 24,3 analysées par seconde (9,7 par période de clignotement) ; réponse
maximale 159 sur 255 (seuil 50). Temps par image : lecture 31,6 ms, recherche 5,3 ms : **la lecture de l'image de la caméra
(le même 31 ms qu'à 720×1280 : indépendant de la taille analysée) plafonne la cadence à environ 27 images par seconde**.
Ce que ce rapport ne dit pas : si les 4 points retenus sont bien les 4 LED allumées et non 4 parasites alignés (seul l'écran
le montre) ; où sont les 6 % d'images perdues ; ce qui se passe de côté (0–15°).

Mesuré sur des **vidéos synthétiques** (pas sur un robot) :
- par luminosité : sur la première photo (tout allumé), le nombre de points verts va de 12 à 22 selon le contraste et la
  résolution : **pas robuste**, d'autant que les photos propres donnent de nombreux points parasites (reflets, lueurs) ;
- par clignotement : les 16 LED sont retrouvées parmi un corps blanc fixe, des lumières fixes bleue, rouge et ambre, du bruit,
  des images en retard ou manquantes, une caméra à 6, 10, 24 ou 60 images/s, une phase quelconque, un écart de quelques % entre les
  horloges, une dérive lente ; avec un tremblement de ±2 px par image, le signal *couleur* garde les 16 sans point parasite
  notable, le signal *toute variation* en ajoute beaucoup. Limite connue : un clignotant **bleu ou rouge** passe aussi dans le
  signal couleur ; rien de tel n'existe sur le robot une fois les comportements coupés ;
- à 2,5 Hz, avec la fenêtre de 1 s : les LED sont retrouvées même à 6 ou 10 images analysées par seconde ; un clignotant à 0,5 ou 1 Hz
  est refusé, à 2 ou 3 Hz il passe (la fenêtre ne sépare que des fréquences distantes de 0,5 Hz) ; un bord qui glisse de 2 à 16 px/s
  donne une réponse d'environ 55 sur 255 dans le signal *toute variation* et 0 dans le signal *couleur* ;
- 16 LED à 480 px de côté long en vue de 45° (scène simulée) : de 12 à 16 points, car elles se touchent ; 4 LED alignées : 4 sur 4 ;
- image qui balance à la main (pic de 2 à 16 diamètres de LED par seconde, 6 à 25 images/s) : le détecteur sur 1 s trouve les 4 LED
  dans 45 % des images à 2 diamètres/s et dans presque aucune au-delà ; la différence de deux images les trouve dans 94 à 100 %
  jusqu'à 4 diamètres/s (85 % à 8 pour 10 images/s). Dans le volet, avec `&sway=20` (environ 6 diamètres/s) : 4 sur 4 avec le filtre
  d'alignement, de 4 à 7 points sans lui ;
- coût : 9 ms (Node) par image de 640×360, 37 ms à 1280×720 ; dans le volet, 8 ms par image à 480×270 (les sommes ne sont faites que
  toutes les 90 ms, toutes les images sont gardées).
- scène simulée par luminosité (géométrie seule, 380 mm) : 16 points sur 16 jusqu'à 30°, dans 8 % des images à 20°, aucun à 10°.

**Jamais essayé** : la prédiction croisée et le seuil propre aux arcs sur le téléphone ; le parallélisme du carré et de la rangée (écart non lu : le carré était trop rarement trouvé) ; le mouvement mesuré par le gyroscope du téléphone ; les angles de 0 à 15° ; une tablette ; l'autre rangée et l'autre groupe ; l'ordre des LED dans la rangée (je suppose qu'il est linéaire : confirmé seulement par « les 4 LED du quart sont bien écartées ») ; le script (modes `blink`, `on`, `off`) sur un vrai robot (ses
appels sont ceux de `thymio3-cards/src/py/lights.py`, qui ont tourné sur un vrai robot) ; la régularité réelle du clignotement
(`time.sleep_ms` en MicroPython) ; l'effet de l'exposition automatique et de l'obturateur à balayage sur des LED qui clignotent ;
la détection par clignotement sur une vraie photo ou vidéo (il faut une paire éteintes/allumées, ou la page sur téléphone).
