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

**Dixième étape** (2026-11-07, après le **neuvième essai sur le téléphone**, version fcba687 : le suivi, essayé pour la première fois). Rapport (≈ 220 s, 2653 images, réglages
par défaut, 70 cm environ : 0,64 px/mm, deux LED d'un groupe à 10 px) : carte « suivie » 91 %, mais **28 acquisitions et 25 pertes** ; rangée trouvée 88 %, arcs 79 %,
les deux 71 % (huitième essai : 73 %) ; images avec les 8 points : 54 / 40 / 41 % à 75–90° / 60–75° / 45–60° (huitième essai : 73 / 59 / 49 %). Dans certaines tranches de
10 s la carte est « suivie » à 95–97 % alors que les arcs ne répondent que dans 36–38 % des images (alors que l'ancienne détection les voit dans 100 %). Mouvement du téléphone
mesuré au gyroscope : de 2 à 16 °/s en moyenne par tranche, soit (avec 9 à 10 px par degré à 640 px, pour un champ de 65–70°) **20 à 160 px/s : de l'ordre d'un écart entre deux
LED par image** (10 px) à 12 images par seconde.
*Reproduit* sans téléphone : le volet dans Chrome sans écran (`Emulation.setCPUThrottlingRate` 5×, 16 images/s), scène simulée à 70 cm (`?demo&blink&extra&elev=60&sway=80&dist=700&rowgain=0.5`,
les deux paramètres `dist` et `rowgain` sont nouveaux) : **17 acquisitions, 16 pertes, 81 % suivies en 45 s** ; la même scène à 38 cm ou sans mouvement : 1 ou 2 acquisitions. Les causes
trouvées (pas de modèle de mouvement, mes essais précédents étaient à 30–38 cm avec une main lente) :
1. **Aucune prédiction du mouvement.** La carte n'était corrigée qu'une image sur deux et les places cherchées dans un rayon de 7 px ; une main à 100 px/s déplace l'image de 7 à 15 px
   entre deux corrections : la première correction manquée entraînait la perte (8 images sans correction). Le rayon « en mm × échelle » avait été réglé à courte distance.
2. **Carte « zombie ».** Les décalages de la rangée gardaient la carte en vie sans que l'anneau réponde (rien ne disait comment elle est tournée ou à quelle distance).
3. **Un ajustement faux gardé pour toujours** : la correction de la carte ajustait aussi des réponses fraîches de la rangée (une tache parasite près d'une LED éteinte), et 4 points
   s'ajustent toujours exactement ; avec 3 arcs seule une correction affine était faite, qui ne répare pas la forme de la carte.
4. **Acquisition à partir de taches périmées** : les taches trouvées pour le jeu éteint viennent de la carte N (0,1 à 0,3 s) : à 100 px/s, 10 à 30 px d'écart.
Ce qui a été fait (`src/tracker.js` ; `TUNE` : β = 0,7, portée = 0,8 × vitesse × temps) : (a) la carte garde une **vitesse** (px/s, filtre alpha-bêta) et se déplace de vitesse × dt
avant chaque image ; (b) **recalage par motif** (`slide`) : le motif des places du jeu allumé (4 LED, ou 4 arcs) glisse sur sa carte P fraîche et on prend le décalage où le plus de
places répondent, plutôt que « la tache la plus proche de chaque place » (les 4 LED sont identiques et à 10 px : la plus proche est souvent la voisine) ; (c) **acquisition par l'anneau
seul, vu dans cette image** (les quatre coins doivent avoir une réponse fraîche dans P) : la carte est « en attente », seuls les 4 arcs sont demandés, et la rangée, quand elle est allumée,
dit lequel des quatre quarts de tour et lequel des deux sens (`mirror`) est le bon ; (d) l'ajustement de la carte ne se fait que sur les arcs frais (4 : homographie ; 3 : affine) ; (e) une
carte qui n'a eu que 3 arcs pendant 1 s repart d'un carré complet frais ; sans correction de l'anneau pendant 2 s, elle est perdue ; (f) un changement de taille d'analyse **garde la carte**
(mise à l'échelle) ; (g) un point est « **confirmé** » s'il a répondu frais dans les 0,45 dernières secondes (les jeux clignotent à tour de rôle : l'un répond maintenant, l'autre a répondu
il y a un instant ; la carte N le garde en traînée, trop floue pour compter) : « 8 sur 8 » veut dire cela, et la page dessine en trait plein les points confirmés. Le rapport donne en plus
les pertes par cause (inertie, anneau, attente de la rangée, taille), les reprises depuis l'anneau, la vitesse de la carte, et les 40 dernières images du suivi (état, rangée, arcs).
*Mesuré* : (i) scène synthétique à l'échelle du téléphone (70 cm, 16 images/s, taches de l'ancien jeu, traînées dans N) : de 40 à 160 px de balancement (pointes de 75 à 300 px/s) :
1 acquisition, 0 perte, places à moins de 6 px dans 97 % des images (balancement 80) ; avant : 17 acquisitions, 16 pertes ; (ii) **la vraie page dans Chrome sans écran**, 70 cm, 16 images/s :
balancement 80 et 120 (pointes d'environ 150 et 230 px/s) : **1 acquisition, 0 perte, 100 % suivies, les deux jeux dans 99 % des images** (avant : 81 %) ; à 38 cm : 100 % ; changement de
taille 640 → 480 → 640 : carte gardée ; trois arcs dont un presque éteint : 7 points sur 8, 1 acquisition. 151 tests JS et 21 tests Python passent.
*Limites, à ne pas oublier* : tout cela est en simulation (pas de bruit de capteur, pas d'exposition automatique, des cartes N dessinées d'après un modèle de traînée) ; **pas encore essayé
sur le téléphone** ; un début de carte demande une image où l'anneau est allumé et frais ; le sens de la rangée (`mirror`) est choisi par le plus petit décalage (les deux sens diffèrent de
8 mm, soit 5 px à 70 cm : fragile) ; l'arc caché dérive jusqu'à 10 px pendant que seule la rangée corrige ; au-delà de 300 px/s la carte se perd. Reste : le **gyroscope du téléphone** comme
vitesse a priori, l'IMU du robot, la pose tirée de H.

**Onzième étape** (2026-11-07, après le **dixième essai**, version 8d8b506 : vitesse, recalage par motif, départ par l'anneau). Rapport (≈ 126 s, 1849 images, réglages par défaut, plus près :
1,05–1,15 px/mm, deux LED d'un groupe à 17–21 px) : **l'anneau est suivi** (arcs trouvés 79–100 % selon les tranches, 4 confirmés sur 4 dans les dernières images), mais **la rangée
n'est confirmée que par 2 LED sur 4** (rangée confirmée à 3 ou plus dans 37 % des images, « t24 » presque partout dans les dernières images, beaucoup d'« x » = réponses écartées),
40 acquisitions dont 22 reprises depuis l'anneau, 16 pertes (15 par inertie, 1 par attente de la rangée), carte suivie 85 %, images avec les 8 points : 8 à 16 %. Rien ne répond avant
10 s (réponse maximale 23–39 pour la rangée, 92 pour l'anneau : exposition qui s'installe ou téléphone pas encore pointé). La rangée est pourtant là : l'ancienne détection voit 4 points
alignés (écarts 20/21 px) et la réponse maximale de la rangée va de 93 à 160 sur 255.
*Hypothèses écartées par simulation* : un décalage du sens de la rangée (`mirror`, jusqu'à 8 mm = un demi-écart de groupe), une hauteur des LED de la rangée au-dessus du plan de l'anneau (8 mm,
parallaxe) : le suivi les supporte à 1,5 px/mm (99 % complètes), la carte choisit le sens la plus proche. *Reproduit* : **deux LED de la rangée beaucoup plus faibles que les deux autres**
(gains 1, 0,25, 1, 0,25) : 14 acquisitions, 13 pertes, rangée confirmée à 3 ou plus dans 6 % des images, c'est-à-dire les symptômes du rapport. Cause : le seuil d'une réponse (30 % de la force
« usuelle » du jeu, apprise sur les LED qui répondent) laissait les deux LED faibles hors du jeu, et le recalage par motif comme la correction par décalage exigeaient 3 places sur 4.
Ce qui a été fait : seuil d'une réponse = 20 % de la force usuelle (plancher 20 sur 255, `TAU_SHARE`) ; le recalage de la rangée et sa correction par décalage se contentent de **2 LED** (3 pour
l'anneau) ; le sens de la rangée se décide aussi sur 2 LED ; une carte reprise d'un carré complet (reprise depuis l'anneau) **garde son quart de tour** au lieu d'attendre de nouveau la
rangée. *Mesuré* (scène de 30 cm, 12 images/s, taches périmées, traînées) : deux LED à 25–30 % : **1 acquisition, 0 perte, 100 % suivies, anneau confirmé 100 %**, rangée confirmée à 3 ou
plus 73 % (les LED à 22 sur 255 sont à la limite du plancher de 20 : la page ne peut pas les voir) ; LED à 30 % : 99 % ; la vraie page dans Chrome sans écran, 30 cm et 70 cm : 1 acquisition,
0 perte, 99–100 % ; 154 tests JS et 21 tests Python passent.
*Nouveau dans le rapport* (pour la prochaine fois) : une ligne par place (« places, quand leur jeu est allumé ») : part des images où la place répond frais, force moyenne de la plus forte
réponse proche (répondu ou non), écart moyen des réponses aux places prédites en px, et la force usuelle de chaque jeu ; elle dira si deux LED sont faibles, si une place est décalée
(sens de la rangée, hauteur), ou si c'est autre chose. *Pas encore essayé sur le téléphone.* Pas traité : les 10 premières secondes sans réponse.

**Douzième étape** (2026-11-08, après le **rapport de la version 7100134** ; le rapport précédent, sans la ligne « places », venait d'une page chargée avant la mise à jour : la page a maintenant un
**numéro de version**, sur l'écran de départ et dans le rapport). Rapport (≈ 95 s, 1435 images, 0,6–0,9 px/mm, 16,5 images/s) : **carte suivie 95 %, rangée 89 %, arcs 94 %, les deux 87 %** (rapport précédent, 8d8b506 : 83 % ;
dixième : 34 %) ; images avec les 8 points : **79 / 85 / 89 %** à 75–90° / 60–75° / 45–60° (dixième : 16 / 16 / 8 %), 78 / 79 / 77 % à l'arrêt / lent / rapide ; 15 acquisitions dont 6 reprises, 9 pertes (taille 1, inertie 8).
Ligne « places » : arcs et LED de la rangée répondent frais dans **94 à 98 %** des images où leur jeu est allumé, force moyenne 78–90 (arcs) et 90–93 (rangée), force usuelle 77/45 (le plancher est 20) : les LED ne sont donc pas faibles ici.
Écarts moyens aux places prédites : arcs −1,4 / −0,7 px tous les quatre (un décalage commun : le retard de la vitesse), **rangée −1,5 / −0,6 / +0,4 / +1,2 px de la LED 0 à la LED 6** : une pente de 0,056 px/mm, soit environ 9 % de plus d'écart entre les
LED que ne le dit la carte tirée de l'anneau (hauteur des LED, perspective, ou pas de 16 mm un peu grand : à surveiller, 1,5 px au plus). Mauvaise tranche : **30–45° : 148 images, 3,1 points en moyenne, 18 % complètes** (robot vu de face, très bas : la position de la photo envoyée).
*Deux choses de l'utilisateur.* (1) **Gel de Chrome** (première fois), « à un certain point plus rien n'était possible », « l'affichage semblait faire des liens avec des points hors de l'image ». **Non reproduit** (fuzz du suivi : 6000 images pleines de taches parasites à 255, de gros blobs entre deux arcs, des carrés trouvés aberrants : aucune
carte absurde, 7 ms au plus par image). Hypothèses : une carte absurde (une portée de recalage énorme boucle sur des millions de décalages ; des places dessinées loin hors de l'image ; la vitesse du suivi plafonnée à 12 largeurs d'image par seconde), un traitement de 46 ms par image
pour 33 ms entre deux images (le fil principal du téléphone est saturé). Protections ajoutées : `validMap` (une carte qui n'est pas celle d'une table vue d'en haut n'est jamais gardée : valeurs finies, devant la caméra, places à moins de 0,6 image du bord, échelle plausible et peu variable) ; `slide` borné (portée au plus 80 px ou 20 % de l'image,
pas de 2 puis affinage : 3 à 4 fois moins de calcul) ; vitesse plafonnée à 1,2 image par seconde, non mise à jour si deux images sont à moins de 20 ms ; une carte dont l'anneau est resté 6 images hors de l'image est lâchée (« hors image ») ; deux places ne partagent jamais une même tache ; le dessin
ignore les points hors de l'image ; une exception dans une image n'arrête plus la boucle (comptée et affichée dans le rapport) ; une image où le suivi dépasse 120 ms le remet à zéro. Le rapport donne la charge (temps moyen et maximal par image, images de plus de 200 ms), les remises à zéro, les cartes absurdes écartées et les erreurs.
(2) **LED parasites** (photo : les 4 LED RGB des coins magenta et cyan, la LED du dessous bleue, des lueurs rouges et jaune sous le robot) : dans le firmware (`ref/`), `LEDS_RGB(0..3)` sont les coins, **`LEDS_RGB(4)` « bottom » est la LED qui montre la couleur du sol** (`SetColorSensorLed` du comportement
colour), `LEDS_RGB(5)` la petite LED du dessus à l'arrière, `LED_COLOR` la LED blanche qui éclaire le sol pour le capteur de couleur, plus les 4 LED des boutons, le récepteur et le microphone ; `disable_behaviors()` ne les éteint pas, elles gardent l'état laissé par le script précédent (le lanceur des cartes met les coins en
magenta devant et cyan derrière : le motif de la photo). Le script du robot (`leds_lego.py`) **éteint maintenant toutes ces LED** après avoir coupé les comportements (23 tests Python). Les émetteurs infrarouges des capteurs ne peuvent pas être éteints (la caméra les voit en violet, mais ils sont fixes). Pas encore essayé sur le téléphone.

**Treizième étape** (2026-11-08, après le **rapport de la version 22fdb7d** : première fois avec le numéro de version, les LED parasites éteintes et la ligne « charge »). Rapport (≈ 140 s, 2094 images, 0,6–0,9 px/mm) : carte suivie 93 %, rangée 86 %, arcs 90 %, **les deux 77 %**
(le douzième : 87 %) ; images avec les 8 points 68 / 46 / 56 / 68 % à 75–90 / 60–75 / 45–60 / 30–45° ; 27 acquisitions dont 12 reprises depuis l'anneau, 14 pertes (inertie 12, attente de la rangée 2), 4 cartes absurdes écartées ; charge : 61 ms par image en moyenne (max 152), aucune image de plus de 200 ms,
suivi seul 12 ms au plus (la lecture de l'image 29 ms et la recherche des points 22 ms font l'essentiel). Ligne « places » : 85 à 96 % de réponses fraîches, écarts moyens aux places prédites de 0,1 à 0,8 px (la pente de la rangée du rapport précédent a disparu). Pas de gel, pas d'erreur.
*Remarque de l'utilisateur* : « de temps en temps le système détectait un **trou latéral du robot** comme LED : le clignotement sortait par ce trou » (capture : un cercle orange sur le côté, près d'un trou de capteur, et un trait vert de la rangée vers lui) ; « du moment où on sait à peu près où sont les LED, il ne faut pas aller chercher si loin ».
*Reproduit* sans téléphone : des trous dans la scène de test (`holes` : un point de la paroi, sous le plan du dessus, qui clignote avec son jeu ; un par jeu), plus fort que les LED, avec un carré « trouvé » qui le prend pour un coin 60 % du temps. Mécanismes vus : (1) **`blobNear` prenait la tache la plus forte du rayon**, pas la plus proche de la place prédite : à certains angles
le trou, vu en perspective, tombe à moins d'un rayon d'un arc (la paroi est plus basse que le plan de l'anneau) et l'emporte ; (2) la rangée vue de 5 LED alignées (la 5ᵉ étant le trou, à peu près un pas plus loin) donne un recalage par motif aussi bon décalé d'un pas (3 LED + le trou) que bien placé : la carte entière était décalée de 9 px par la rangée, puis rattrapée par l'anneau ;
(3) la « force usuelle » des arcs était tombée à 32 (le rapport) : des réponses faibles acceptées baissent la force usuelle, qui fait accepter d'autres réponses faibles ; (4) la reprise depuis l'anneau acceptait tout carré trouvé, dans toute l'image.
*Fait* : (a) pour les réponses **fraîches**, la tache la plus **proche** de la place prédite (au plus 5 par fenêtre, un seul balayage), les réponses plus fortes que 2,2 fois la force usuelle de leur jeu sont ignorées (`maxV`) ; (b) la force usuelle est **mesurée** sur les 4 coins vus à l'acquisition (la médiane) puis sur les premières réponses de la rangée, mise à jour seulement par des réponses d'au moins la moitié de sa valeur, et descend de 0,2 % par image ;
(c) une correction de la rangée par 2 LED seulement n'est admise que pour un décalage d'au plus 0,4 pas ; (d) la reprise depuis l'anneau n'accepte qu'un carré **proche** de la carte (chaque coin à moins de 0,6 côté d'une place différente) ; (e) un carré trouvé n'est pris pour départ que si la rangée vue par le détecteur est compatible avec la carte : direction à 15° près, écart entre LED à 40 % près, pour un des quatre quarts de tour
(indépendant de l'âge des taches) ; (f) **tant que la carte est connue et en bonne santé, on ne cherche plus de taches dans toute l'image** (`wantsFound` : pas de carte, attente de la rangée, retard de correction, ou plus de 0,4 s sans ajustement complet de l'anneau) : le détecteur de taches ne tourne plus, la réponse maximale est lue sur les cartes ; dans le volet à 5× plus lent, 45 → 34 ms et 35 → 28 ms par image,
15,7 → 18,9 et 19,8 → 25,2 images analysées par seconde. *Mesuré* (scène à trous de 255 contre des arcs de 150, carré « trouvé » avec le trou 60–90 % du temps) : anneau décalé de plus de 15 px dans **0 à 6 %** des images (avant : 18 à 34 %), reprises 4 à 6 (avant : 9 à 19), images complètes 74 à 94 % (avant : 50 à 68 %) ; sans trou : 1 acquisition, 0 perte, 99 % ; 161 tests JS et 23 tests Python passent.
*Non traité* : la fin de l'enregistrement (dernières 35 images perdues, réponse maximale des arcs 44–63 : robot vu presque d'en haut ? pas examiné) ; les « candidats » du rapport ne comptent plus que les images où la recherche sur toute l'image a eu lieu. Pas encore essayé sur le téléphone.

**Quatorzième étape** (2026-11-08) : **le flash double** (idée de l'utilisateur : alterner les deux lignes de LED et les combiner avec des arcs aussi alternés, pour que chaque flash donne à lui seul la position du robot ; le gyroscope n'aurait pas suffi : il ne mesure pas la translation).
*Géométrie* (`scratchpad` : carte du plan ajustée avec les seuls points d'un flash, bruit 0,5 px par centre, vue à 60°, 0,8 px/mm, erreur sur les 24 places : 8 arcs et les 2 rangées de 8 LED ; médiane / 90 % / pire) : anneau seul 1,0 / 1,7 / 3,3 px ; rangée seule : pas de carte ; **rangée + 2 arcs en diagonale 0,8 / 1,4 / 3,7** (l'autre paire, avec la rangée arrière : 0,7 / 1,0 / 2,9) ; rangée + les 2 arcs avant 0,6 / 0,7 / 1,5 mais
sa paire complémentaire (arcs arrière) 1,1 / 1,9 / 5,6 ; **rangée + 1 seul arc : indéterminée (15 à 33 px)** : 7 des 8 degrés de liberté, il faudrait la gravité ; les 2 rangées seules (8 LED à 8 mm) 2,8 / 5,7 / 16 ; **rangée + 4 arcs 0,5 / 0,7 / 1,4**. Choix de l'utilisateur : **rangée + anneau complet par flash**.
*Le motif* (`GROUP 4` avec `CIRCLE 2` dans `leds_lego.py` et `script.js`, les deux vont ensemble ; par défaut) : flash 0 = rangée **avant** (indices pairs) + arcs **N E S W** ; flash 1 = rangée **arrière** (indices pairs) + arcs **NE SE SW NW** ; chaque LED est allumée dans son flash et éteinte dans l'autre (8 LED allumées à chaque flash, 2,5 Hz comme avant). Les autres réglages (une rangée et un jeu d'arcs en alternance) restent dans les réglages avancés.
*Le suivi* (`src/tracker.js`) : 4 jeux de places (16 places, chacune avec son jeu et sa phase) ; la phase de l'image se lit sur les réponses fraîches ; **à chaque image** les 8 points frais (4 LED de la rangée + 4 arcs) ajustent **toute la carte** (un seul ajustement quand ils s'accordent, sinon RANSAC : 4 contraintes de trop, la tache qui ne s'accorde pas est écartée), il n'y a plus d'image « rangée seule = décalage » ni d'attente de la rangée ;
le recalage par motif glisse les 8 places d'une phase ensemble (une rangée décalée d'un pas ne satisfait pas l'anneau) ; **départ sur une seule image** (`acquireDual`) : le carré d'arcs donne la carte à un quart de tour et à un jeu d'arcs près, la rangée vue dans la même image dit lequel (erreur moyenne des taches de la rangée aux LED prédites ≤ 0,35 pas, et nettement meilleure que l'hypothèse suivante), puis ajustement de tous les points ; plus de taches périmées au départ ;
pas de reprise depuis l'anneau ; les comptes (« 8 sur 8 ») sont ceux des 8 places du flash allumé. La page cherche les taches sur la seule carte P (ce qui s'allume maintenant) et sans les fenêtres croisées de `locate` ; le dessin trace une ligne par rangée et un polygone par jeu d'arcs, plus pâles pour le flash éteint.
*Mesuré en simulation* (`tests/dual_scene.js`, scène à N en traînées, taches parasites) : départ depuis une image pour les 4 tours du carré, les 2 flashs et les 2 sens de la rangée, les 16 places à moins de 3,5 px aussitôt ; balancement de 50 px à 48 cm : 1 acquisition, 0 perte, 100 % complètes, 16 places à moins de 4 px dans 100 % des images ; 70 cm, balancement 80 : 1 acquisition, 0 perte, 100 % ;
trous de 255 contre des arcs de 160 et carrés « trouvés » avec un trou pour coin 70–80 % du temps : 1 acquisition, 0 perte, places à moins de 8 px dans 100 % des images (avec le premier motif : 6 reprises, anneau décalé de plus de 15 px dans 5 à 25 %) ; deux LED de la rangée à 30 % : 1 acquisition, 0 perte ; **chaque flash donne un ajustement complet dans plus de 90 % des images** ; dans la page (Chrome sans écran, 5× plus lent) : 1 acquisition, 0 perte, 100 % à 50 et 70 cm,
28–34 ms par image ; 171 tests JS et 29 tests Python passent.
*Limites, à ne pas oublier* : jamais essayé sur le robot ni le téléphone ; le départ suppose que les arcs d'indice impair sont en diagonale et ceux d'indice pair sur les axes (la photo du robot avec le jeu 1 le confirme : arcs en diagonale), que `N` est du côté du nez, et le pas de 8 mm entre les rangées avant et arrière ; la rangée avant et la rangée arrière alternent, donc la rangée vue dans une image est à 8 mm de celle de l'image suivante (connu de la carte) ;
une rangée plus un seul arc ne suffit pas (la variante économe de l'utilisateur, avec la gravité du téléphone en plus, reste possible) ; la mesure de gyroscope proposée avant est abandonnée.

**Quinzième étape** (2026-11-08, après le **quatorzième essai : première fois avec le flash double, sur le vrai robot**, version 1214545). Rapport (≈ 130 s, 2218 images, 0,4–2,4 px/mm, 15,6 images/s) : **le départ sur une image et le suivi marchent sur le robot** (carré tourné de 3 quarts, rangée en miroir) ; les 16 places répondent frais dans **88 à 100 %** des images où leur flash est allumé (arc 4 : 88 %), force 126–158 pour les arcs et 78–89 pour les LED (usuelle 128/70),
écarts moyens aux places prédites de 0,1 à 2,3 px (rangée avant −1,2 à −1,5 px, rangée arrière −0,5 à −0,7 px : la géométrie des deux rangées tient) ; carte suivie 84 %, les deux jeux 96 % ; images avec les 8 points 91 / 82 / 74 / 96 / 67 % à 75–90 / 60–75 / 45–60 / 30–45 / 15–30° ; 72 / 89 / 73 % à l'arrêt / lent / rapide ; 5 acquisitions, 4 pertes (changement de taille 1, inertie 3), 6 cartes absurdes écartées ;
charge 53 ms par image (max 84), recherche sur toute l'image évitée dans 76 % des images. Les creux de suivi (60–70 s : 10 %, 105–110 s : 0 %, 110–120 s : 52 %, 164–170 s : 53 %) sont ceux où le robot était **très loin** (LED d'un groupe à 7–9 px à 640 px, soit 0,44–0,56 px/mm) ou à une distance en transition ; la carte a tenu à 100 % de 0,5 à 2,4 px/mm (ramené à 640 px de côté long) dans les autres tranches, y compris tout près
(1,9 à 2,4 px/mm). Remarque de l'utilisateur : « les tests marchent bien sauf de très loin ou de très près ; dans ces cas on pourrait demander à l'utilisateur de ramener le robot dans une plage correcte ».
*Fait* (`src/range.js`) : un **guide de distance** : l'échelle de la carte (px/mm ramenés à une image de 640 px de côté long, donc indépendante de la taille analysée ; sans carte, ce que le détecteur mesure) classe la distance : **trop loin sous 0,6 px/mm, trop près au-dessus de 2,2** (cela dépend de l'optique autant que de la distance : la page ne dit jamais à quelle distance se placer) ; un bandeau orange sur l'image dit seulement « Trop loin » ou « Trop près »
après 1,2 s hors plage et disparaît après 0,8 s dans la plage (un instant hors plage ne dit rien) ; carte perdue sans rien mesurer : la dernière échelle dit de quel côté (à 0,15 de la limite loin ou à 0,3 de la limite près), pendant 6 s. Le rapport donne la part des images avec carte trop loin / bonne / trop près, l'échelle avant les 8 dernières pertes, et **pourquoi les départs sont refusés** (sans carré, sans rangée,
coins non frais, rangée incompatible avec l'écart mesuré, ambigu avec la marge, carte invalide) : en simulation à 1,1 m (0,42 px/mm) on voit surtout « sans carré 22, sans rangée 9, rangée incompatible 5 » avant le départ, c'est-à-dire que c'est la détection de la rangée et du carré qui échoue de loin, pas l'ajustement. 178 tests JS et 29 tests Python passent. Pas encore essayé sur le téléphone ; les limites 0,6 et 2,2 viennent de ce seul rapport.
*Pas fait* : élargir la plage au loin (la détection du carré et de la rangée à 8 px d'écart entre LED est la limite, pas la carte) ; une plage de proximité mesurée (rien n'a échoué de près dans ce rapport : le seuil 2,2 est celui où le robot, ±60 mm, remplit les 360 px de la largeur).

**Seizième étape** (2026-11-08, après le **quinzième essai**, version 5cfdb7b, premier avec le guide de distance). Rapport (≈ 150 s, 2036 images) : carte suivie 87 %, 6 acquisitions, 4 pertes (taille 1, inertie 3) à des échelles de 0,4 à 0,79 px/mm ; trop loin 10 %, bon 85 %, trop près 5 % des images avec carte ; les 16 places répondent frais à 75–100 % (la LED rowb0 : 57 %, force 59 contre 85–94 pour ses voisines : une LED faible ; arcs 4 et 5 : 82 et 75 %) ;
images avec les 8 points 91 / 58 / 58 / 96 % à 75–90 / 60–75 / 45–60 / 30–45° ; 50 ms par image. **L'utilisateur** : « la carte a mis longtemps à converger, puis plus stable » ; « au début il y avait une lumière sur le fond qui faisait distracteur » ; « ne donnez aucune indication de distance (cela dépend de l'optique), dites seulement trop près ou trop loin ».
Le rapport de départs refusés, pour la première fois : **« rangée incompatible » 300 fois** (dernier : écart de la rangée 0,58 pas, marge 0,60 : la meilleure hypothèse est nettement la bonne, mais la rangée vue ne s'y accorde pas), « sans carré » 255, « sans rangée » 11 : une quarantaine de secondes de départs refusés (les 555 refus).
*Cause trouvée et reproduite* : l'accord de la rangée était jugé par la distance **moyenne de toutes** les taches aux LED prédites ; une lumière sur la ligne de la rangée (un parasite du fond, la lueur d'un trou) est une 4ᵉ tache « alignée » qui ne s'accorde avec aucune hypothèse : à plus d'un pas et demi du bout de la rangée, le départ est refusé à chaque image (simulation : 0 départ sur 40 ; un parasite à 1 pas : 40 sur 40 ; l'écart moyen avec un parasite à 2 pas est 0,5, comme dans le rapport).
*Fait* : (a) l'accord de la rangée est jugé sur les **3 meilleures taches** (moyenne de leurs écarts, en pas) : 40 départs sur 40 avec un ou deux parasites alignés, ou une LED manquante plus un parasite ; la carte est ajustée sur les seules taches qui s'accordent ; (b) le détecteur donne ses **meilleurs candidats** (`pickAligned` et `pickSquare` avec `all` : jusqu'à 6 rangées et 8 quadrilatères, le meilleur d'abord, le résultat sans `all` est inchangé) et `acquireDual` essaie **toutes les paires** (carré, rangée) avec les 16 hypothèses de chaque carré, au lieu de se fier au premier de chacun : avec des lumières très fortes près de l'anneau et sur la ligne de la rangée, 27 départs sur 30 contre 0 avec les premiers choix ;
(c) 20 taches au lieu de 16 sont considérées pour le carré pendant la recherche de départ ; (d) le bandeau dit seulement **« Trop loin » ou « Trop près »** (test : aucun chiffre, aucune distance) ; (e) une ligne « départ » du rapport : après combien de temps le premier clignotement est vu et la première carte obtenue. *Non établi* : la cause des 255 refus « sans carré » : soit rien ne clignotait encore (le script du robot lancé après la caméra), soit un parasite fort a repoussé les arcs hors des 16 meilleures taches ; la ligne « départ » le dira.
182 tests JS et 29 tests Python passent (un test de vitesse du lock-in dépasse sa borne quand la machine est chargée par une autre tâche). Pas encore essayé sur le téléphone.

**Dix-septième étape** (2026-11-08, après le **seizième essai**, version 33fd503). L'utilisateur : « quand il décroche, il reste décroché longtemps ; peut-on détecter le décrochement, faire une action spéciale, même en changeant le clignotement temporairement ? » puis : « si on cherche seulement dans la zone plausible, le fond ne devrait rien faire ». Rapport (≈ 220 s, 1989 images) : carte suivie 86 %, **première carte après 24,5 s**, 15 acquisitions et **15 pertes** (toutes par inertie sauf une),
**départs refusés : « sans carré » 911**, sans rangée 86, rangée incompatible 37, ambigu 14, carte invalide 1 (le 15ᵉ essai en avait 300 « rangée incompatible » : corrigé) ; **72 cartes absurdes écartées** ; suivi seul jusqu'à 174 ms ; **force usuelle des arcs 52** alors que les arcs répondent de 95 à 155 (les arcs du jeu N E S W, plus forts : frais dans 83 à 92 %, ceux du jeu NE SE SW NW : 94 à 97 %) ; dans la fin du rapport, « arcs trouvés » 45 à 75 % de 190 s à 220 s alors que la carte est suivie à 100 %, et de 133 s à 139 s arcs 0 % avec une réponse de 152.
*Le décrochage est déjà détecté* (perte par inertie, anneau, hors image, carte absurde, taille ; départs refusés par raison). Ce qu'il fallait comprendre, c'est pourquoi on ne repart pas. *Causes trouvées* (en simulation, une par une) :
1. **Seuil fixe de recherche du carré.** La recherche du carré d'arcs trouve le carré dans **100 % des images à toute inclinaison de 20° à 75° et à toute distance de 30 à 80 cm, mais 0 % dès que les arcs répondent sous le seuil 80** (arcs à 70 dans la scène) : avec une exposition plus basse, aucune tache d'arc n'est retenue, « sans carré ». Dans la page avec des arcs à 35–50 % : version publiée **première carte jamais** (586 refus).
2. **Un piège de la force usuelle.** La force usuelle d'un jeu était une moyenne qui baisse de 0,2 % par image, avec un plafond à 2,2 fois elle pour refuser une lumière trop forte : les arcs plus forts étaient refusés, ne pouvaient pas la relever, et elle descendait à 52 ; d'où des arcs non retrouvés, des ajustements impossibles, de l'inertie, des pertes.
3. **Un défaut de mon ajustement commun** : avec la rangée (4 LED sur une ligne, 5 des 8 nombres de la carte) et **un seul arc**, l'ajustement s'exécutait et donnait n'importe quoi : c'étaient les 72 cartes absurdes (écartées par `validMap`, mais autant d'images sans correction).
4. **La recherche sur toute l'image** après une perte : tout ce qui change dans le décor est un candidat.
*Fait* : (a) la recherche de départ suit les lumières : seuil de départ = la moitié de la médiane des derniers pics frais (entre un plancher et le seuil demandé : arcs 35–80, LED 25–50), puis une **échelle de seuils décroissants** (×1, ×0,7, ×0,5) jusqu'à ce qu'on trouve ce qu'on cherche (un carré d'arcs ; 3 LED alignées) ; rien n'est cherché si rien ne clignote (médiane des pics sous 28) ; (b) la force usuelle est la **médiane des 80 dernières réponses fraîches** de chaque couleur, que ne remet pas à zéro une nouvelle carte, sans décroissance, et le plafond passe à 4 fois (un test à arcs de 160 et 95, puis lumières à moitié, puis plus fortes : suivi, tous les arcs confirmés) ;
(c) l'ajustement commun n'est fait que si les points **déterminent** la carte : 4 arcs, ou 3 LED et 2 arcs, ou 3 arcs et 2 LED (une rangée avec un arc : décalage seulement ; test : aucune carte absurde) ; (d) après une perte, **le robot est cherché là où il était** (`searchZone`) : un disque centré sur la dernière place du milieu de l'anneau, de la taille du dessus du robot (60 mm de chaque côté) plus une marge, qui grandit avec le temps depuis la perte (0,19 côté long par seconde, la main déplace l'image d'environ 120 px/s à 640) et suit un peu la vitesse qu'avait la carte ; il devient toute l'image après 6 s ou s'il atteint la moitié de l'image ; la recherche de taches (`PairDiff.find` avec fenêtre et `P` seul) et le calcul des seuils n'y regardent que dans le disque ; il est dessiné en pointillés sur l'image ;
le rapport donne la part des images de recherche limitées à la zone et les seuils de la dernière recherche. *Mesuré* : dans la page (Chrome sans écran, 5× plus lent) avec la lampe parasite de la scène et des arcs à 50, 35, 25 % : **première carte à 0,0 s** à chaque fois (publiée : jamais à 50 et 35 %) ; **pertes forcées** (carte effacée à la main trois fois de suite) : retour en **100 à 214 ms** (une fois 669 ms avec des arcs à 30 %), recherche limitée à la zone dans 50 à 78 % des images de recherche ; 188 tests JS et 29 tests Python passent.
*Non fait, et pourquoi* : **pas d'action spéciale sur le robot** (changer le clignotement demande de renvoyer le script, qui coupe les LED quelques secondes : plus lent que ce qu'on a corrigé) ; les causes ci-dessus expliquent les données sans elle. *Non établi* : la cause exacte de « arcs 0 % de 133 s à 139 s » (réponse 152) ; le seuil de départ et la zone ne sont éprouvés qu'en simulation. Pas encore essayé sur le téléphone.

**Dix-huitième étape** (2026-11-08, après le **dix-septième essai**, version d42d31a). L'utilisateur : « cette fois la détection est complètement chaotique » et « la caméra change de mode de temps en temps (zoom ? paysage / portrait ?) ». Le rapport (98 s, 1616 images) : carte suivie **58 %** (86 % au 16ᵉ essai), 17 acquisitions et 16 pertes (toutes comptées « coast »), première carte après 14,1 s (la rangée ne répond pas du tout pendant les 10 premières secondes : réponse max 24), « trop loin » 51 % des images avec carte, 55 cartes absurdes écartées, départs refusés « sans rangée » 304, « sans carré » 243, rangée incompatible 84 ; **l'échelle de la carte juste avant les pertes : 0,27 0,16 0,91 0,17 0,07 1,13 1,64 0,08**, c'est-à-dire cinq cartes de 0,07 à 0,27 px/mm (le robot ferait 4 à 14 px) ; les 40 dernières images : arcs confirmés 2 à 3 sur 4, rangée 1 à 3, une réponse écartée presque à chaque image. La page n'avait **aucune trace** d'un changement de mode de la caméra.
*Cause trouvée et reproduite* (Node et page, sans le téléphone) : un **saut de zoom** (le robot paraît 1,8 fois plus petit d'une image à la suivante, comme si la caméra changeait de mode) laisse la carte à **la mauvaise échelle**, avec 5 réponses fraîches sur 8 et un ajustement qui oscille entre 0,63 et 0,88 de la vraie échelle, **indéfiniment** (échelle juste dans 49 % des images pendant 25 s) : elle n'est pas perdue (il y a toujours des réponses), donc la recherche sur toute l'image ne se déclenche jamais. Pendant le saut, la carte passe aussi par une échelle trop petite (0,29 pour 0,57 vrai, vu dans la page).
*Fait* : (a) **une carte qui peine est comparée à un départ depuis l'image** : si aucun ajustement commun de 6 points au moins n'a eu lieu depuis 0,5 s, la page cherche carré et rangée sur toute l'image (au plus tous les 0,25 s), et le départ **remplace** la carte seulement s'il explique plus des 8 places allumées (test : 8 sur 8 contre 1 à 4 ; une carte saine n'est jamais remplacée : 0 remplacement sur trois scènes d'essai) ; (b) une carte plus petite que **0,25 px/mm** (pour une image de 640 px) est refusée (`validMap`) ; (c) un changement de **forme** de l'image (portrait ↔ paysage) efface la carte et la zone de recherche, et la perte est comptée « taille » (avant, elle était comptée « coast ») ; (d) **surveillance de la caméra** (`src/camwatch.js`) : taille de l'image reçue, taille et orientation de l'écran, réglages de la piste (zoom, exposition, mise au point...), flux interrompu, page en arrière-plan, avec l'heure de chaque changement ; le rapport les liste (« changements de la caméra et de l'écran », « caméra, capacités », « réglages »), une bannière bleue de 5 s les annonce sur l'image, et la ligne du suivi dit combien de cartes ont été remplacées (et pourquoi les essais ont échoué : « ok », « pas mieux », « ambigu »...) ; (e) la démo accepte `&jump=6,1.8` (toutes les 6 s la distance change d'un facteur 1,8). *Mesuré* : saut ×1,8 : 100 % des images ont les 16 places à moins de 8 px 1,5 s après (49 % avant) ; dans la page (Chrome sans écran, 5× plus lent) avec des sauts toutes les 6 s : bien suivi (carte et 7 places sur 8 confirmées) **94 %** avec la reprise, 1 perte, contre **64 et 66 %** avec l'ancien suivi (5 et 4 pertes). Un défaut de ma comparaison (un rayon non entier qui donnait toujours 0) a été trouvé en la mesurant dans la page. 194 tests JS et 29 tests Python passent.
*Non établi* : que les changements de mode de la caméra expliquent le 17ᵉ essai (le rapport ne le montre pas : le prochain le dira) ; **d'où viennent les cartes de 0,07 à 0,17** (du bruit aléatoire dense ne les produit pas ; les sauts de zoom les approchent sans les atteindre) ; pourquoi la rangée ne répond pas pendant 10 s au départ (LED blanchies par la saturation ? robot hors champ ?). Pas encore essayé sur le téléphone.

**Dix-neuvième étape** (2026-11-08, après le **dix-huitième essai**, version 8b2eeb9, de nuit sous lumière artificielle). L'utilisateur : « chaos de nouveau, le cercle blanc en pointillé part dans des directions bizarres » ; « je n'ai jamais dit que le chaos venait du changement d'image, c'est autre chose » ; « on a clairement régressé » ; « les conditions d'éclairage ont aussi changé ». (J'avais attribué le chaos au changement de mode de la caméra : c'était mon hypothèse, pas la sienne.) Le rapport : carte suivie 62 %, 11 acquisitions, 10 pertes (taille 2, coast 8), première carte après 12,6 s, 74 cartes absurdes, **échelle avant les pertes 1,34 0,3 0,34 0,79 0,26 1,11 0,79 0,62**, force usuelle 52/47 (arcs 128 le jour), exposition automatique de **40 ms** (399,81 × 0,1 ms), 56 essais de reprise dont 7 réussis (rangée incompatible 25, ambigu 21, ok 7, sans rangée 2, pas mieux 1). La surveillance de la caméra ne montre **aucun** changement de zoom, d'orientation ou de forme d'image (720x1280, zoom 1, portrait) : les deux « cartes effacées » sont des passages 270x480 → 360x640. **Les captures** (17:54) montrent les cercles rouges pointillés (places prédites sans réponse) et le triangle orange **sur le lit**, alors que le robot est allumé, en vue, à côté : la carte est posée sur le fond.
*Causes trouvées* : (1) **un vieux défaut** : la garde « le canevas fait plus de 300 px de large » (pour sauter le canevas par défaut) effaçait la carte à chaque passage de 480 à 640 de côté long **en portrait** (270 px de large) : deux fois ici, trois fois dans la page de test avec la version précédente ; (2) **la zone de recherche** (le cercle blanc en pointillé) était portée par la vitesse de la carte perdue, sans borne : 0,6 s à jusqu'à 770 px/s, un disque envolé quand la carte était fausse ; (3) **une carte posée sur un fond reste « suivie »** : reproduit dans la page avec un motif stable de la géométrie du robot placé à 170 mm (`&decoy=170`, plus `&noise=300&glare=6` : bruit de couleur et lampes dans l'image) : sur 8 essais de 10 s, d42d31a est une fois bloquée sur le motif (0 % sur le robot, 100 % « suivi », 0 perte) et deux fois dégradée ; 33fd503 : 3 essais sur 6 bloqués ; (4) de nuit, des départs refusés en grand nombre (sans rangée 242, sans carré 205, ambigu 40, rangée incompatible 50) : la rangée n'est trouvée que dans 55 % des images.
*Fait* : (a) la garde est supprimée : un changement de taille de même forme **garde la carte** (page, portrait, 4 changements 480 ↔ 640 : 0 carte effacée ; avant : 3 pertes « taille ») ; (b) le centre de la zone n'est jamais déplacé de plus de la moitié de son rayon par la vitesse ; (c) **test du fond** : le flash double n'allume qu'**un jeu d'arcs à la fois** ; une vraie carte a le jeu éteint muet, un fond répond dans les deux flashs ; on lit la réponse du plan P ambre au centre des arcs (1 à 3 px : les arcs voisins sont à 45°) ; un départ est refusé si les arcs éteints répondent au moins 0,75 fois les allumés (raison « fond »), une carte est lâchée si la médiane des 8 dernières images dépasse 0,6 (perte « fond ») ; le rapport donne le rapport médian (« arcs éteints / arcs allumés ») ; `?fond=0` coupe ce test pour comparer ; (d) la zone de la dernière carte n'est mémorisée que si la carte était saine ; (e) une carte qui peine **mais répond encore** fait chercher dans un disque (100 mm × échelle + 12 % de l'image) autour d'elle (une carte qui ne répond plus : toute l'image) ; (f) la démo accepte `&noise=`, `&glare=`, `&decoy=` et donne la vraie position (`cam.truth`). 198 tests JS (dont : un fond qui répond dans les deux flashs n'est pas une carte, et une carte qui s'y trouve est lâchée en 21 images ; un vrai robot n'est jamais pris pour un fond, de loin, de près, LED faibles, main qui balance) et 29 tests Python passent. Dans la page, la médiane arcs éteints / allumés du vrai robot est **0**, et aucune carte n'est lâchée comme fond ; le test coupé (`&fond=0`) donne autant de réussites que le test actif sur 3 essais, donc **le test du fond n'est pas démontré nécessaire** dans cette scène : il est là pour la scène réelle, que je n'ai pas.
*Mon premier essai du test du fond était trop large* (rayon de 6 px : la lueur des arcs voisins comptait comme réponse du jeu éteint, et le vrai robot de la démo était pris pour un fond, 15 % seulement sur le robot) : trouvé en mesurant dans la page, resserré avant publication.
*Non établi* : que la nuit explique la baisse (la démo bruitée sans motif parasite est suivie à 100 % par toutes les versions) ; que les arcs éteints soient aussi muets sur le vrai robot que dans la démo (l'exposition de 40 ms peut mélanger les deux flashs sur ~20 % des images ; la médiane sur 8 images le tolère) ; pourquoi la rangée est si peu trouvée de nuit ; l'effet de l'**exposition courte** (bouton « Exposition courte (4 ms) », jamais essayé) sur le flou et les lampes. Pas encore essayé sur le téléphone.

**Vingtième étape** (2026-11-08, après le **dix-neuvième essai**, version 2c3a313). L'utilisateur : « de nouveau chaotique ; depuis plusieurs itérations la qualité baisse ; **la méthode de test ne marche pas** : comment corriger sérieusement ? ». Le rapport : carte suivie 64 %, 19 départs, **18 pertes dont 14 « fond »** : le test du fond que j'avais ajouté à la version précédente **lâchait le vrai robot** (le rapport arcs éteints / allumés du vrai robot n'est pas 0 comme dans ma démo : il atteint 0,6 de temps en temps ; exposition de nuit à 40 ms, éclairage artificiel dont l'éclat total varie de 854 %). Mon hypothèse « le vrai robot a ses arcs éteints muets » n'avait jamais été vérifiée, parce que je n'avais pas de vraies images.
*Le fond du problème, plus grave que ce test* : depuis dix-huit essais, chaque essai donne **un seul rapport en texte**, dans des conditions qui changent (lumière, distance, main, heure) ; je devine une cause, je la reproduis dans une scène **que j'ai dessinée moi-même**, je corrige, et les 198 tests passent, tous synthétiques. Rien ne permet de distinguer une régression d'un changement de lumière, et rien ne dit si ce que je corrige existe dans la vraie scène. Les vérifications « sur la page publique » ne vérifiaient que ma démo.
*Fait* : (a) le test du fond est **coupé par défaut** (`?fond=1` pour le rallumer) ; (b) **enregistrement de la vraie vidéo de la caméra** (section « Enregistrement de la caméra » de la page : `MediaRecorder` sur le flux de la caméra, H.264 matériel si possible, 8 Mbit/s, 45 s au plus ; le téléphone donne la vidéo **et** un fichier `.txt` qui contient le rapport et la trace image par image de ce que la page a décidé en direct ; bouton « Partager » = la feuille de partage du téléphone, ou enregistrement dans les téléchargements) ; (c) **rejouer** : `?replay=/recordings/essai.mp4` joue la vidéo à la place de la caméra, à travers **le même code**, avec l'horloge de la vidéo (le résultat ne dépend pas de la vitesse de l'ordinateur) ; (d) `node scripts/replay.mjs recordings/essai.mp4 --live recordings/essai.txt` donne, pour le direct et pour le rejeu : part des images avec une carte, pertes par raison, première carte, plus long trou, **sauts de la carte > 60 px** (le cercle blanc qui part en tous sens) et sauts d'échelle. Vérifié sur des vidéos de la démo (même bruitée, parasite et lampes) : le rejeu de la vidéo codée redonne 99 % de carte, contre 100 % en direct. 208 tests JS et 29 Python passent.
*À faire avec de vraies vidéos* : (1) vérifier que le rejeu ressemble au direct sur de vraies images (c'est la preuve que la méthode est fidèle) ; (2) rejouer les versions 5cfdb7b, 33fd503, d42d31a, 8b2eeb9, 2c3a313 sur les mêmes images : dire si la qualité a vraiment baissé, et où ; (3) ne garder que les changements qui améliorent les vraies vidéos ; (4) constituer un petit corpus (jour / nuit, près / loin, main immobile / qui bouge) qui sert de test de non-régression avant toute publication.

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
