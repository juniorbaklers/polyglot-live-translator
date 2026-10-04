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
La console affiche la durée de traitement de chaque extrait de trois secondes.
Si une traduction est vide, la fenêtre conserve le texte reconnu et indique son
absence au lieu de laisser une ligne vide. Cela ne reconstitue pas les mots qui
n'ont pas été reconnus dans l'audio.

## Fonctionnement gratuit

Il n’y a aucun abonnement ni consommation d’API pour cette version.
Le téléchargement initial des modèles utilise Internet ; la transcription et la
traduction fonctionnent ensuite en local. Le moteur bloque les connexions sortantes
vers Internet pendant son utilisation. La vidéo en ligne peut toujours nécessiter Internet.
Les résumés/quiz du pipeline Windows historique sont désactivés, sans résultat simulé.

Le son est capturé par fichiers WebM indépendants de trois secondes. Dès le premier
extrait reconnu, le moteur émet un sous-titre provisoire marqué « En cours ».
Il réévalue ensuite la même fenêtre audio avec les nouveaux sons, puis remplace
la même ligne grâce à un identifiant de phrase et à un numéro de révision.
Les révisions anciennes et celles arrivant après une finalisation sont ignorées.

Une pause d'au moins 0,7 seconde après le dernier mot reconnu, ou une phrase ponctuée
stable dans deux reconnaissances successives, permet de stabiliser la ligne.
Sans pause ni phrase stable, la fenêtre est limitée à douze secondes pour borner
le calcul et la mémoire ; « Fin de phrase non confirmée » signale ce cas. La suite
continue sur une nouvelle ligne. La stabilité ne garantit pas l'exactitude du texte.

La voix ne lit que les résultats stabilisés. Le bouton Arrêter interrompt la
collecte, transmet le dernier fragment puis attend la stabilisation pendant au
maximum quinze secondes. Le dernier sous-titre est livré avant la fermeture,
et aucune nouvelle voix n'est lancée pendant cet arrêt. Si le moteur ne répond
pas à temps, le texte provisoire déjà visible est conservé comme extrait.

Le premier résultat peut apparaître après environ trois secondes plus le calcul,
sans garantie de délai sur un ordinateur donné. La réévaluation d'une fenêtre
qui s'allonge augmente le travail du processeur ; si six extraits restent en
attente, la capture s'arrête avec une explication. Le mode normal utilise base
et une hypothèse, le mode précision small et trois hypothèses. Les performances,
les horodatages, la détection des pauses et la qualité restent à mesurer sur une
vidéo réelle sous Windows. Ces changements n'utilisent aucune API payante.

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

## Extension 1.3.1 et DevOps

Le [guide d’installation](docs/INSTALLATION_EXTENSION.txt) décrit la mise à jour, les sous-titres accessibles, les glossaires par domaine, les corrections locales, les repères d’incertitude et les exports TXT/SRT. Le [guide DevOps](docs/DEVOPS.md) explique les tests Windows/Linux, la génération du ZIP dans GitHub Actions, les benchmarks réels et le retour à une version précédente. Les deux parties doivent être mises à jour ensemble (protocole local v3).

La version 1.3.1 rend Démarrer et Afficher la fenêtre visibles avant les options avancées. Le code est enregistré au démarrage ; le bouton d’affichage réouvre le panneau sans perdre l’historique. Le contenu est ajouté à la page si nécessaire et les pages non compatibles sont signalées.
