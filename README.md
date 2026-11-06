# Thymio 3 — Test RA

Première question d'une vue en réalité augmentée du Thymio 3 : **une tablette retrouve-t-elle les 16 LED du dessus du
robot dans l'image de sa caméra, assez vite, et sous quels angles ?** Cette page ne calcule pas encore de pose : elle
compte les points lumineux, les dessine sur l'image et mesure ce que ça coûte.

Même base que les autres projets (Vite, API [`Mobsya/thymio3-ts-api`](https://github.com/Mobsya/thymio3-ts-api) prise sur
GitHub, Web Bluetooth). Textes en français seulement.

```bash
npm install
npm run dev        # http://localhost:5180 (Chrome : la caméra et le Bluetooth marchent sur localhost)
npm test           # 26 tests JavaScript + 4 tests Python (le vrai script du robot, sur un robot virtuel)
npm run build
```

## Ce que fait la page

- **Caméra** (arrière par défaut) ou **scène simulée** (`?demo`, `?demo&elev=30` pour fixer l'angle) : un robot dessiné en
  perspective, qui montre la *géométrie* seulement (quand les LED se touchent dans l'image), pas la lumière réelle.
- **Points lumineux** : plus clairs que le seuil *et* que leurs voisins (le corps blanc du robot n'est pas un point), de
  forme ronde, avec leur couleur (les 16 LED sont vertes ; l'anneau autour du pavé est ambre, les 4 LED du corps ont la
  couleur qu'on leur donne). Réglages : largeur analysée, seuil, contraste local, couleur comptée, masque.
- **Vu de côté ?** : l'angle entre l'axe de la caméra et la table (capteur d'orientation de la tablette) et un tableau
  « combien de points vus à chaque angle », par tranches de 15°.
- **Vitesse** : images reçues et analysées par seconde, retard caméra → page, durée de lecture de l'image et de recherche.
- **Robot** : *Connecter le robot et allumer les 16 LED* envoie au robot `src/py/leds_on.py`, qui coupe les comportements du
  firmware et met les 16 LED au niveau 16. Il faut un script **sur le robot** : le comportement par défaut (gyroscope), le
  mode leçons et le mode cartes dessinent déjà sur ces LED, et une commande Bluetooth serait écrasée (elle ne monte d'ailleurs
  qu'à 15 : 15/16 de PWM à 50 Hz scintille, 16 non).
- **Rapport** : tout ce qui précède en texte, à copier.

## Essayer sur un téléphone ou une tablette

La caméra et le Bluetooth exigent https (ou localhost). `.github/workflows/deploy.yml` publie la page sur GitHub Pages à chaque
push sur `main`, comme les autres projets : <https://francescomondada.github.io/thymio3-ar/>. Android : Chrome. iPad : Bluefy.
Sans Web Bluetooth, la caméra se teste quand même, LED allumées autrement (`?demo` : scène simulée, sans caméra ni robot).

## Outil : tester sur une photo

```bash
node scripts/detect-photo.mjs photos/robot.jpg --width 1280 --color vert --out annotee.png --mask masque.png
```

(macOS : lit la photo avec `sips`.) Met les mêmes réglages et le même détecteur que la page, et dessine les points trouvés.
Le dossier `photos/` est ignoré par git : ce sont des photos de test personnelles, elles restent sur l'ordinateur.

## Ce qu'on sait, ce qu'on ne sait pas

- Vu sur une photo (Samsung, environ 45°) : les 16 LED sont une **grille 2 × 8, pas 8 mm**, sous des tenons qui s'allument
  chacun ; vertes ; bien séparées à cet angle.
- Pas encore vu : une photo avec **seulement** les 16 LED allumées ; d'autres angles ; la tablette ; le robot piloté par cette page
  (le script n'a tourné que sur un robot virtuel ; ses appels sont ceux de `thymio3-cards/src/py/lights.py`).
- Le détecteur n'est **pas robuste** : sur la photo, le nombre de points verts va de 12 à 22 selon le contraste et la
  résolution (16 pour un contraste de 40 à 1280 px, 3 au-dessus de 50). La fenêtre du contraste local est plus petite qu'une
  LED vue de près. À refaire sur des photos propres avant de s'y fier.
- Dans la scène simulée (géométrie seule, 380 mm) : 16 points sur 16 jusqu'à 30°, 16 dans 8 % des images à 20°, aucun à 10°.
