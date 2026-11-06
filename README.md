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

## Deux façons de trouver les LED

- **Par clignotement** (par défaut). Le robot fait clignoter **un quart des 16 LED** (4 LED écartées d'au moins 18 mm : côte
  à côte, à 8 mm, elles se confondent dans l'image d'un téléphone) à **2,5 Hz** (200 ms allumées, 200 ms éteintes ; réglable
  de 1,25 à 7,5 Hz) : `src/py/leds_lego.py`, mode `blink`. La page cherche, pour chaque pixel, ce qui varie à ce rythme dans
  les 2,5 dernières périodes (1 s à 2,5 Hz ; un détecteur à verrouillage, `src/lockin.js`). Tout ce qui est fixe est ignoré,
  même très brillant : le corps blanc, l'anneau ambre autour du pavé, la LED bleue, la lueur rouge sous le robot, les
  reflets. Pas besoin de connaître la phase ni de synchroniser la caméra et le robot : les temps réels des images servent de
  référence, et à cette vitesse une demi-période dure environ 6 images de caméra. Deux signaux : *couleur* (le clignotement de
  G − (R+B)/2, par défaut : un contour qui bouge avec la main change la luminosité mais pas la couleur, une LED verte change
  les deux) et *toute variation* (plus sensible, mais les contours qui bougent y répondent).
  Les quatre quarts : la LED `i` de la rangée avant est dans le quart `i % 4`, la LED `i` de la rangée arrière dans le quart
  `(i + 2) % 4` ; **cela suppose que l'indice court dans le même sens sur les deux rangées** (pas vérifié sur le robot : si
  les 4 LED allumées ne sont pas bien écartées, le dire).
- **Par luminosité** (LED fixes) : plus clair que le seuil *et* que les voisins, de forme ronde, avec la couleur du point.

## Ce que fait la page

- **Caméra** (arrière par défaut) ou **scène simulée** : `?demo`, avec `&blink` (LED clignotantes), `&extra` (lumières fixes
  d'autres couleurs), `&shake=2` (la main qui tremble), `&elev=30` (angle fixé). Elle ne montre que la *géométrie* (quand les
  LED se touchent dans l'image), pas la vraie lumière des LED vues de côté.
- **Vu de côté ?** : l'angle entre l'axe de la caméra et la table (capteur d'orientation) et un tableau « combien de
  points vus à chaque angle », par tranches de 15°.
- **Vitesse** : images reçues et analysées par seconde, retard caméra → page, durée de lecture et de recherche, et **images
  analysées par période de clignotement** (il en faut au moins 5). La taille analysée se règle par le **côté long** (480 px par
  défaut) : un téléphone tenu droit donne du 720×1280.
- **Robot** : *Connecter le robot et lancer* envoie `leds_lego.py` au robot, avec le mode choisi (LED clignotantes,
  allumées en continu, éteintes), le groupe (un des 4 quarts, ou les 16) et la vitesse ; changer l'un d'eux renvoie le script. Il faut un script **sur le robot** : le comportement par défaut (gyroscope), le mode
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

**Premier essai sur un téléphone** (Android, Chrome, 2026-11-06) : 0 point. Le rapport montre 5,9 images analysées par seconde
(analyse en 720×1280 : 125 ms par image, quatre fois plus de pixels que ce qui avait été mesuré), un clignotement à 7,46 Hz
(donc sous-échantillonné, et pas calé sur les images), le script du robot arrêté au moment du rapport, un seuil réglé à 126
pour une réponse maximale de 62 : rien de concluant sur les LED elles-mêmes. Remarques de l'utilisateur : la fréquence est
trop haute et pas synchronisée avec l'image ; les LED ne se distinguent pas les unes des autres. D'où : 2,5 Hz par défaut,
analyse par le côté long, un quart des LED écartées. **Pas encore réessayé sur le téléphone.**

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
- 16 LED à 480 px de côté long en vue de 45° (scène simulée) : de 12 à 16 points, car elles se touchent ; un quart : 4 sur 4, stable ;
- coût : 9 ms (Node) par image de 640×360, 37 ms à 1280×720 ; dans le volet, 8 ms par image à 480×270 (les sommes ne sont faites que
  toutes les 90 ms, toutes les images sont gardées).
- scène simulée par luminosité (géométrie seule, 380 mm) : 16 points sur 16 jusqu'à 30°, dans 8 % des images à 20°, aucun à 10°.

**Jamais essayé** : la nouvelle version sur un téléphone ou une tablette ; le script (modes `blink`, `on`, `off`) sur un vrai robot (ses
appels sont ceux de `thymio3-cards/src/py/lights.py`, qui ont tourné sur un vrai robot) ; la régularité réelle du clignotement
(`time.sleep_ms` en MicroPython) ; l'effet de l'exposition automatique et de l'obturateur à balayage sur des LED qui clignotent ;
la détection par clignotement sur une vraie photo ou vidéo (il faut une paire éteintes/allumées, ou la page sur téléphone).
