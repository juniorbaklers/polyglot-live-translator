# Lot 2 — Audio Windows

## Fonctions ajoutées

- capture du son système avec WASAPI Loopback ;
- capture du microphone Windows par défaut ;
- démarrage et arrêt depuis React ;
- jauge RMS et valeur de crête ;
- détection de l'absence de signal après trois secondes ;
- libération propre des interfaces WASAPI ;
- messages d'erreur en français.

## Vérification sous Windows

1. Installer Rust stable et les prérequis Tauri 2.
2. Exécuter `pnpm install` à la racine.
3. Exécuter `pnpm dev:desktop`.
4. Sélectionner « Son de l'ordinateur » et lancer une vidéo.
5. Cliquer sur « Tester le son » et vérifier la jauge.
6. Refaire le test avec le microphone.

La capture ne démarre jamais automatiquement. Elle s'arrête avec le bouton
« Arrêter » ou à la fermeture de l'application.

## Limite actuelle

Cette version utilise les périphériques Windows par défaut. L'énumération et la
sélection de tous les périphériques seront ajoutées pendant la stabilisation de
l'installateur Windows, après validation sur une machine Windows physique.
