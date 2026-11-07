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
arcs (`PairDiff` avec la mesure *ambre* `R ≥ G ? max(0, G − B) : 0` : sur la photo où 6 des 8 arcs sont allumés, elle trouve
exactement ces 6, et ni le bois de la table, ni les lueurs du corps, ni la lueur rouge, ni les LED vertes).
Filtre de forme : de tous les points ambre, la page garde 4 points qui font un quadrilatère convexe pas trop plat (côtés
opposés et diagonales dans des rapports plausibles pour un carré vu en perspective). **Parallélisme** : le point de fuite de
deux côtés opposés doit se trouver sur la droite de la rangée ; l'écart est mesuré et affiché (≈ 0,02 si les côtés sont
parallèles à la rangée, 0,3 à 0,7 pour le carré tourné de 45°), pas imposé (option `preferParallel`, désactivée tant qu'on n'a pas
vu sur le robot que le nord du cercle pointe vers le nez).

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

**Jamais essayé** : les arcs du cercle avec le téléphone et le robot (l'ordre et la direction des indices du cercle, le nord vers le nez, l'alternance avec la rangée) ; le mouvement mesuré par le gyroscope du téléphone ; les angles de 0 à 15° ; une tablette ; l'autre rangée et l'autre groupe ; l'ordre des LED dans la rangée (je suppose qu'il est linéaire : confirmé seulement par « les 4 LED du quart sont bien écartées ») ; le script (modes `blink`, `on`, `off`) sur un vrai robot (ses
appels sont ceux de `thymio3-cards/src/py/lights.py`, qui ont tourné sur un vrai robot) ; la régularité réelle du clignotement
(`time.sleep_ms` en MicroPython) ; l'effet de l'exposition automatique et de l'obturateur à balayage sur des LED qui clignotent ;
la détection par clignotement sur une vraie photo ou vidéo (il faut une paire éteintes/allumées, ou la page sur téléphone).
