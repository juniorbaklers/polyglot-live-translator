# Polyglot Live Translator — extension réelle en mode local gratuit

Cette version de l’extension capture le son d’un onglet Chrome/Edge, transcrit
les paroles avec Faster Whisper et les traduit avec Argos Translate sur votre
ordinateur. Aucun texte de démonstration n’est produit. Les appels à l’API payante
ont été supprimés du pipeline Rust historique ; l’extension utilise exclusivement
le nouveau moteur local sur `127.0.0.1:47833`.

## Installation Windows

1. Installez Python **3.11 64 bits**, avec le lanceur `py`.
2. Dans `apps/local-engine`, lancez **INSTALLER.cmd** une seule fois avec Internet.
   Il installe les bibliothèques et télécharge les modèles libres. Ces téléchargements
   peuvent être volumineux et prendre plusieurs minutes ; aucune clé API n’est demandée.
3. Lancez **DEMARRER.cmd** et gardez la fenêtre ouverte. Copiez le code à six chiffres
   affiché lorsque le moteur est prêt.
4. Compilez l’extension avec `pnpm install --frozen-lockfile`, puis `pnpm build:extension`.
   Dans `chrome://extensions`, activez **Mode développeur**, puis chargez
   `apps/extension/dist` avec **Charger l’extension non empaquetée**.
5. Rechargez la page de votre vidéo. Dans le menu de l’extension, enregistrez le code,
   choisissez les langues et le mode, puis lancez la capture.

L’application Windows Tauri historique n’est plus nécessaire pour l’extension.
Une ancienne application Windows déjà installée n’est pas modifiée par ce code source.
L’extension ne se connecte pas à son ancien port et refuse les services qui ne
présentent pas l’identifiant du moteur local gratuit.

## Fonctions disponibles

- Transcription et traduction réelles pour anglais, français et espagnol.
- Détection automatique de ces langues, ou langue source explicitement choisie.
- Sous-titres, voix locale, ou les deux ; choix modifiable pendant la capture.
- Fenêtre sombre, déplaçable, redimensionnable et historique des 150 dernières phrases.
- Traduction seule ou texte bilingue, réglage de la taille du texte.
- Arrêt de la capture avec conservation du texte visible.

Les voix distantes et les moteurs vocaux d’autres extensions sont refusés. Installez
une voix Windows dans la langue cible si aucune voix locale compatible n’est disponible.
Le son original reste audible ; la lecture vocale n’est pas un doublage synchronisé.

## Réglages de précision

Le mode normal utilise une hypothèse de reconnaissance et les 160 derniers caractères
reconnus comme contexte ; le mode précision utilise trois hypothèses et 700 caractères.
La détection de parole utilise un seuil de 0,35 pour moins écarter les paroles faibles.
Ce contexte est remis à zéro à chaque
nouvelle capture et changement de langue source. La traduction calcule un seul
résultat final au lieu de quatre. Un extrait détecté dans une langue non installée
est ignoré ; une détection automatique fiable est conservée pour la session.
Choisir la langue source reste préférable pour une vidéo dans une langue connue.

Le fichier facultatif `apps/local-engine/VOCABULAIRE.txt` peut contenir les noms et
sigles réellement utilisés dans le cours. Ces termes guident la reconnaissance ;
ils ne remplacent pas automatiquement des mots dans les transcriptions.

Pour essayer un modèle de reconnaissance plus puissant, fermez le moteur, lancez
`INSTALLER_PRECISION.cmd` une fois avec Internet, puis `DEMARRER_PRECISION.cmd`.
Ce mode utilise Whisper small en local, au lieu de base, et peut être sensiblement
plus lent sur CPU. `DEMARRER.cmd` conserve le modèle base avec les nouveaux réglages.
La précision sur une vidéo particulière et la vitesse sur Windows restent à mesurer.
La console affiche la durée de traitement de chaque extrait de cinq secondes.
Si une traduction est vide, la fenêtre conserve le texte reconnu et indique son
absence au lieu de laisser une ligne vide. Cela ne reconstitue pas les mots qui
n'ont pas été reconnus dans l'audio.

## Fonctionnement gratuit

Il n’y a aucun abonnement ni consommation d’API pour cette version.
Le téléchargement initial des modèles utilise Internet ; la transcription et la
traduction fonctionnent ensuite en local. Le moteur bloque les connexions sortantes
vers Internet pendant son utilisation. La vidéo en ligne peut toujours nécessiter Internet.
Les résumés/quiz du pipeline Windows historique sont désactivés, sans résultat simulé.

Le son est traité par fichiers WebM indépendants de cinq secondes. Un petit délai est
normal. Si le processeur ne suit pas la vidéo, l’extension arrête la capture et affiche
une explication plutôt que d’accumuler une file audio sans limite. Les performances et
la qualité de traduction dépendent du matériel, de la langue et de la clarté du son.

## Vérification

```sh
pnpm typecheck
pnpm build:extension
node --test apps/extension/tests/*.test.mjs
python -m unittest discover -s apps/local-engine/tests -v
```

Les tests de protocole utilisent un double de test pour valider le transport et
l’association ; le moteur livré utilise toujours les modèles réels.
La traduction complète sur Windows et les installateurs Tauri n’ont pas été testés
ni compilés dans cet environnement Linux sans Rust.

## Architecture et licence

`apps/extension` : extension Manifest V3. `apps/local-engine` : service Python local.
`apps/desktop` : application Tauri historique avec appels payants désactivés.
Les documents académiques existants décrivent des versions précédentes ; ce README
définit le fonctionnement de cette version de l’extension.

Projet BAKELE, licence MIT. Faster Whisper : MIT. Argos Translate : MIT ou CC0.
Références : https://github.com/SYSTRAN/faster-whisper et
https://github.com/argosopentech/argos-translate.
