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

- **Par clignotement** (par défaut). Le robot fait clignoter les 16 LED à 7,46 Hz (`src/py/leds_lego.py`, mode `blink`).
  La page cherche, pour chaque pixel, ce qui varie à ce rythme sur les 12 dernières images (un détecteur à verrouillage,
  `src/lockin.js`). Tout ce qui est fixe est ignoré, même très brillant : le corps blanc, l'anneau ambre autour du pavé, la
  LED bleue, la lueur rouge sous le robot, les reflets. Pas besoin de connaître la phase ni de synchroniser la caméra et
  le robot : les temps réels des images servent de référence. Deux signaux : *couleur* (le clignotement de G − (R+B)/2,
  par défaut : un contour qui bouge avec la main change la luminosité mais pas la couleur, une LED verte change les
  deux) et *toute variation* (plus sensible, mais les contours qui tremblent y répondent).
- **Par luminosité** (LED fixes) : plus clair que le seuil *et* que les voisins, de forme ronde, avec la couleur du point.

## Ce que fait la page

- **Caméra** (arrière par défaut) ou **scène simulée** : `?demo`, avec `&blink` (LED clignotantes), `&extra` (lumières fixes
  d'autres couleurs), `&shake=2` (la main qui tremble), `&elev=30` (angle fixé). Elle ne montre que la *géométrie* (quand les
  LED se touchent dans l'image), pas la vraie lumière des LED vues de côté.
- **Vu de côté ?** : l'angle entre l'axe de la caméra et la table (capteur d'orientation) et un tableau « combien de
  points vus à chaque angle », par tranches de 15°.
- **Vitesse** : images reçues et analysées par seconde, retard caméra → page, durée de lecture et de recherche.
- **Robot** : *Connecter le robot et lancer* envoie `leds_lego.py` au robot, avec le mode choisi : LED clignotantes,
  allumées en continu, éteintes. Il faut un script **sur le robot** : le comportement par défaut (gyroscope), le mode
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

Mesuré sur des **vidéos synthétiques** (pas sur un robot) :
- par luminosité : sur la première photo (tout allumé), le nombre de points verts va de 12 à 22 selon le contraste et la
  résolution : **pas robuste**, d'autant que les photos propres donnent de nombreux points parasites (reflets, lueurs) ;
- par clignotement : les 16 LED sont retrouvées parmi un corps blanc fixe, des lumières fixes bleue, rouge et ambre, du bruit,
  des images en retard ou manquantes, une caméra à 24 ou 60 images/s, une phase quelconque, un écart de quelques % entre les
  horloges, une dérive lente ; avec un tremblement de ±2 px par image, le signal *couleur* garde les 16 sans point parasite
  notable, le signal *toute variation* en ajoute beaucoup. Limites connues : un clignotant à **3 Hz** passe aussi (la fenêtre
  de 12 images ne le rejette pas), un clignotant **bleu ou rouge** aussi dans le signal couleur ; rien de tel n'existe sur
  le robot une fois les comportements coupés ;
- coût : 10 ms (Node) à 16 ms (Chrome du volet) par image de 640×360, 40 ms à 1280×720 ; 1,5 ms de lecture de l'image.
- scène simulée par luminosité (géométrie seule, 380 mm) : 16 points sur 16 jusqu'à 30°, dans 8 % des images à 20°, aucun à 10°.

**Jamais essayé** : la page sur une tablette ou un téléphone ; le script (modes `blink`, `on`, `off`) sur un vrai robot (ses
appels sont ceux de `thymio3-cards/src/py/lights.py`, qui ont tourné sur un vrai robot) ; la régularité réelle du clignotement
(`time.sleep_ms` en MicroPython) ; l'effet de l'exposition automatique et de l'obturateur à balayage sur des LED qui clignotent ;
la détection par clignotement sur une vraie photo ou vidéo (il faut une paire éteintes/allumées, ou la page sur téléphone).
