# Plan de tests final

## Compilation

- `pnpm install --frozen-lockfile`
- `pnpm typecheck`
- `pnpm build:extension`
- `pnpm build:desktop`

## Audio Windows

- microphone par défaut ;
- WASAPI Loopback avec une vidéo ;
- silence de plus de trois secondes ;
- démarrage, arrêt et fermeture inattendue.

## Extension

- association correcte et code incorrect ;
- badge REC ;
- capture YouTube/Udemy ;
- plein écran ;
- arrêt et suppression de la couche.

## Données

- sauvegarde après chaque segment ;
- fermeture puis réouverture ;
- exports TXT, SRT, VTT, CSV, JSON, DOCX et PDF ;
- suppression de la clé du coffre.

## Sécurité

- vérifier que le port écoute uniquement sur 127.0.0.1 ;
- vérifier l'absence de secret dans le dépôt ;
- refuser les jetons inconnus ;
- vérifier qu'aucune capture ne démarre automatiquement.
