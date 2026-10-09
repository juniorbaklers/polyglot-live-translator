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
3. Lancez **DEMARRER.cmd** et gardez la fenêtre ouverte. La connexion est automatique, sans code.
4. Compilez l’extension avec `pnpm install --frozen-lockfile`, puis `pnpm build:extension`.
   Dans `chrome://extensions`, activez **Mode développeur**, puis chargez
   `apps/extension/dist` avec **Charger l’extension non empaquetée**.
5. Rechargez la page de votre vidéo. Dans le menu de l’extension, choisissez les langues et le mode, puis lancez la capture.

L’application Windows Tauri historique n’est plus nécessaire pour l’extension.
Une ancienne application Windows déjà installée n’est pas modifiée par ce code source.
L’extension ne se connecte pas à son ancien port et refuse les services qui ne
présentent pas l’identifiant du moteur local gratuit.

## Fonctions disponibles

- Transcription et traduction réelles pour anglais, français, espagnol et chinois simplifié (mandarin pour l’audio).
- Détection automatique de ces langues, ou langue source explicitement choisie.
- Sous-titres, voix locale, ou les deux ; choix modifiable pendant la capture.
- Fenêtre sombre, déplaçable, redimensionnable et historique visible des 150 dernières phrases et transcription complète de la session.
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
Les appels de résumés/quiz payants du pipeline Windows historique sont désactivés. L’extension propose désormais ses propres outils extractifs gratuits et locaux, sans résultat simulé.

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

## Extension 1.7.0 et DevOps

Le [guide d’installation](docs/INSTALLATION_EXTENSION.txt) décrit la mise à jour, les sous-titres accessibles, les glossaires par domaine, les corrections locales, les repères d’incertitude et les exports TXT/SRT. Le [guide DevOps](docs/DEVOPS.md) explique les tests Windows/Linux, la génération du ZIP dans GitHub Actions, les benchmarks réels et le retour à une version précédente. Les deux parties doivent être mises à jour ensemble (protocole local v10).

La version 1.7.0 rend Démarrer et Afficher la fenêtre visibles avant les options avancées. Le code est enregistré au démarrage ; le bouton d’affichage réouvre le panneau sans perdre l’historique. Le contenu est ajouté à la page si nécessaire et les pages non compatibles sont signalées.

La fenêtre utilise une présentation plus soignée, des états de phrase lisibles et un bouton Copier. Le moteur conserve le contexte des phrases sans ponctuation lors de courtes pauses, regroupe les fragments des pistes accessibles et réutilise les traductions identiques en session. Les modèles restent inchangés : aucun gain de qualité chiffré n’est établi sans benchmark réel. Le regroupement peut retarder la voix, qui attend la finalisation.

La version 1.7.0 conserve toutes les phrases de la session pour les exports. Le bouton Transcription complète et export donne accès aux textes original et traduit, modifiables après arrêt, avec exports TXT original/traduction/bilingue. Les retouches globales concernent les TXT ; les corrections par phrase alimentent aussi le SRT. Les textes restent en mémoire dans la page : exporter avant nouvelle session, actualisation ou fermeture. Aucun correcteur automatique n’est simulé.

La version 1.7.0 ajoute un résumé extractif et un quiz à trous dans le document complet. Le résumé sélectionne jusqu’à six phrases, classées par termes et restituées dans leur ordre ; il ne reformule pas le contenu. Le quiz masque un terme dans jusqu’à cinq extraits, vérifie la réponse et affiche le passage d’origine. Les fiches utilisent le texte relu (original ou traduction), sont exportables en TXT avec corrigé et sont invalidées après modification. Aucun réseau ni modèle supplémentaire n’est utilisé. Ces outils dépendent de la transcription, peuvent omettre des notions et ne remplacent pas une évaluation de compréhension.

Version 1.7.0 : rendu incrémental des 150 lignes visibles, conservation des brouillons de correction pendant les nouvelles traductions, clarification de Finalisée · à relire. Le moteur évite les inférences sur les fichiers strictement nuls, sans exclure les sons faibles non nuls ni une fenêtre encore non reconnue. Collecte audio inchangée (3 s) ; performance réelle et précision doivent être mesurées sur le PC de l’utilisateur. Mise à jour moteur + extension nécessaire pour bénéficier des deux optimisations.

Version 1.7.0 : démarrage Windows facultatif via ACTIVER_DEMARRAGE_AUTO.cmd (ou variante précision). Un raccourci par utilisateur lance pythonw.exe et launcher.py sans console au login ; le code d’association est persistant et le verrou évite les instances concurrentes dans le même dossier. Désactivation et affichage du code disponibles. Journal rotatif limité à 1 Mo plus une sauvegarde, sans code d’association. Conserver le chemin du moteur ; réactiver après déplacement. Une capture vidéo exige toujours une action utilisateur dans Chrome. La fermeture de la session arrête le moteur. Les appels payants restent désactivés.

Version 1.8.0 : profil de reconnaissance choisi au démarrage selon les cœurs accessibles et la mémoire disponible. tiny/base/small locaux, limites prudentes pour précision, repli sur modèle installé plus léger si mémoire insuffisante au chargement. Installation tiny et base, small automatique sur les configurations supérieures. Pas de téléchargement en fonctionnement, pas de changement du traducteur Argos, pas de promesse de compatibilité universelle ou de temps réel sur tout CPU. Voir INSTALLATION_EXTENSION.txt pour seuils et mise à jour.

Version 1.9.0 : connexion automatique sans code ni bouton Enregistrer. Le moteur et l’extension ne lisent plus les anciens codes. Origine chrome-extension exigée et vérifiée contre l’identifiant déclaré ; pages web et origine absente refusées, jeton aléatoire lié à chaque connexion, une seule session à la fois. Protocole v5 : mettre à jour les deux parties et redémarrer l’ancien moteur. Les anciennes descriptions du code concernent les versions historiques.

Version 1.10.0 : commandes Lignes précédentes et Revenir au direct visibles au-dessus de l’historique. Relecture sans déplacement par les nouveaux sous-titres, pages de 150 lignes avec chevauchement et retour explicite au suivi en direct. Défilement manuel met en relecture. Mise à jour extension seulement depuis 1.9.0 ; moteur et protocole v5 inchangés.

Version 1.11.0 : boutons −/+ pour redimensionner la fenêtre sans modifier les caractères, dimensions enregistrées localement et bornées à la taille de l’écran, repositionnement après agrandissement ou changement de viewport. Mise à jour extension uniquement depuis 1.9.0.

### Traduction progressive et contexte (1.12.0)

La première proposition reste traduite avec le chemin Argos habituel. À la finalisation,
une reprise locale utilise au maximum les deux derniers passages terminés de la même
paire de langues. Leurs traductions servent de préfixe imposé au décodeur CTranslate2 ;
seule la continuation correspondant au nouveau passage est affichée. Aucun découpage
approximatif du texte traduit ni substitution de phrases d'exemple n'est utilisé.
Les fragments forcés et passages avec reconnaissance incertaine effacent ce contexte.
Une nouvelle session, un changement de langue ou un déplacement dans la piste le réinitialisent.

Cette reprise concerne les paires Argos directes avec modèle déjà chargé. Une paire via
langue pivot, un contexte trop long, une sortie vide ou tronquée, une erreur ou le dépassement
du budget de 0,8 s conserve la traduction normale. Le budget est contrôlé pendant le décodage
et après le calcul ; il ne peut pas interrompre l'encodage, donc ce n'est pas une garantie
de latence maximale. Les modèles restent les modèles de phrases Argos : le gain de qualité
et la vitesse doivent être mesurés sur des vidéos réelles, et ne sont pas encore validés.
Aucun service en ligne ni abonnement n'a été ajouté.

### Chinois simplifié (1.13.0)

Le chinois (`zh`) est proposé comme langue source et cible. INSTALLER.cmd ajoute les
modèles Argos anglais → chinois et chinois → anglais, puis vérifie les routes entre
les quatre langues. Les routes français ↔ chinois et espagnol ↔ chinois passent par
l’anglais : deux traductions successives, gain de qualité non garanti et reprise
contextuelle directe V17 non appliquée aux routes via pivot. Whisper conserve ses
modèles multilingues existants ; la qualité de reconnaissance du mandarin dépend
notamment du modèle chargé, du son et du locuteur. Le chinois traditionnel (`zt`) et
la reconnaissance fiable de tous les dialectes chinois ne sont pas annoncés.

Ponctuation 。！？ prise en charge pour segmenter et finaliser les phrases ; comparaison
stable des préfixes et repérage d’incertitude adaptés aux caractères han sans espaces.
Pistes zh-Hans/zh-CN reconnues, correction locale autorisée pour zh, segmentation en
mots du quiz chinois avec Intl.Segmenter. Les sorties exportées conservent Unicode.
Sans modèles chinois installés, le moteur conserve les autres langues et explique de
relancer INSTALLER.cmd si le chinois est demandé. Aucun abonnement ni API ajouté.
Les tests utilisent des doubles du moteur : modèles chinois réels et latence restent
à mesurer après installation, sans promesse de précision chiffrée.

### Essai du moteur léger — réduction des dépendances à valider

Diagnostic sur l’installation Windows utilisateur : torch 506,1 Mo, spaCy 99,3 Mo,
sympy 71,7 Mo. Le backend local_translate exécute les modèles Argos avec CTranslate2
et les tokeniseurs Argos, sans importer translate/sbd ni torch/spaCy/Stanza. Modèles,
segmentation, paramètres de décodage et pivots conservés ; même Whisper. Backend normal
inchangé par défaut ; activation expérimentale par POLYGLOT_TRANSLATION_BACKEND=light.

INSTALLER_LEGER.cmd crée .venv-leger et compare les sorties aux textes de contrôle
traduits par l’ancien environnement. Il installe les dépendances minimales, puis Argos
1.11.0 avec --no-deps pour package/tokenizer seulement. Les dépendances standard Argos
restent déclarées dans les métadonnées et pip check les signale manquantes : profil
sélectif Polyglot, pas installation complète standard. En cas de différence, l’essai
échoue et DEMARRER_LEGER.cmd reste bloqué. Pas de suppression de .venv, de migration du
raccourci Windows ou de gain disque réalisé pendant cette phase : double installation
temporaire. Après comparaison, validation audio réelle et mesure de .venv-leger sont
nécessaires avant promotion et retrait de l’ancien environnement. Guide :
docs/ESSAI_MOTEUR_LEGER.txt. Modèles natifs et Windows non exécutés ici.

### Lecture stable (extension 1.14.0)

La fenêtre affiche par défaut uniquement les phrases finalisées. Paramètres → Lecture permet de retrouver le texte provisoire puis finalisé ; le choix est mémorisé et appliqué immédiatement. Le moteur continue de traiter les brouillons, sans délai fixe ajouté. Afficher une phrase finalisée implique d’attendre sa finalisation et ne garantit ni son exactitude ni sa complétude : les extraits interrompus restent signalés à relire. L’historique, l’export et les corrections sont conservés. Mise à jour de l’extension uniquement, puis rechargement et actualisation de la page vidéo. Validation : compilation/typecheck et 41 tests extension réussis ; vitesse sur vidéo réelle non mesurée.

### Passages audio plus courts (mise à jour moteur V20)

La reconnaissance conserve deux observations et publie le premier préfixe stable. En anglais/français/espagnol, une virgule ou un point-virgule répété peut aussi terminer un passage de 6 à 24 mots, avec une suite reconnue d’au moins 3 mots et des probabilités de reconnaissance suffisantes. Les introductions subordonnées courantes et les fins manifestement incomplètes sont exclues. Le reste de l’audio, ses temps et le contexte sont conservés. Le chinois et les pistes de sous-titres gardent leurs frontières actuelles. Ce sont des heuristiques : pas de garantie sémantique ou de délai, ni accélération des modèles. Compatible avec l’affichage final seul de l’extension 1.14.0 ; remplacer seulement engine.py, moteur arrêté, puis relancer. Guide : docs/MISE_A_JOUR_PASSAGES_STABLES.txt. Validation : 76 tests Python, dont 75 réussis et un test Windows ignoré sous Linux. Mesures sur vidéo et modèles réels encore nécessaires.

### Interface compacte (extension 1.15.0, V21)

Poignée visible au coin inférieur droit : glisser pour redimensionner avec taille mémorisée et bornes de fenêtre. Mode compact sous 540 px de largeur ou 380 px de hauteur : commandes resserrées, indicateurs secondaires masqués, lecture et historique conservés. Hauteur minimale 240 px (limitée par le viewport). La molette vers le haut passe immédiatement en relecture, même pour un petit déplacement ; les nouvelles lignes restent en attente jusqu’au retour au direct. Mise à jour de l’extension uniquement ; moteur V20 inchangé. Tests du comportement sur le script compilé, typecheck et compilation ; rendu visuel Chrome/Edge Windows à vérifier sur la machine utilisateur.

### Lecture et sources automatiques (extension 1.16.0, protocole v6)

- Le nouveau choix Automatique utilise une piste `textTracks` activée, accessible et dans une langue prise en charge ; sinon il capture le son de l’onglet. Les choix manuels restent disponibles. Il ne s’agit pas d’un adaptateur universel pour YouTube, Zoom ou tous les lecteurs. La source choisie reste fixe pendant la session.
- Le mode final uniquement conserve les reconnaissances intermédiaires pour stabiliser le texte, mais n’effectue plus leur traduction. Le mode progressif réactive la traduction des prochains brouillons, y compris pendant une capture. La reconnaissance audio reste par blocs de trois secondes.
- Une piste sans ponctuation est finalisée après sa fin plus 0,75 seconde de lecture sans nouveau sous-titre, ou à la fin de la vidéo. Les temps du passage sont conservés ; le fragment reste signalé comme fin de phrase non confirmée. Une pause du lecteur ne déclenche pas de coupure sur un délai mural. Un retour dans la vidéo permet de retraduire les mêmes sous-titres.
- À l’arrêt ou en cas d’erreur, la dernière transcription est sauvegardée dans le stockage local de l’extension. Le bouton Dernière session la rouvre après arrêt ; les retouches réalisées après arrêt sont sauvegardées aussi. Une nouvelle sauvegarde remplace la précédente. Exportez les sessions à conserver durablement. Une fermeture avant l’arrêt ne garantit pas de sauvegarde ; une erreur de stockage demande un export.
- Le champ Vocabulaire de reconnaissance indique explicitement son rôle : guider Whisper, sans imposer une traduction à Argos. Les prompts conversationnels d’Immersive Translate ne sont pas ajoutés à Argos et aucun moteur distant n’est activé.

Mise à jour obligatoire des deux parties : fermer le moteur, remplacer ses fichiers Python (conserver les environnements et modèles existants), remplacer le dossier extension compilé, recharger l’extension et actualiser la vidéo, puis relancer le moteur. Le protocole v6 refuse un ancien moteur v5 avec une instruction de mise à jour. Aucun modèle supplémentaire n’est requis.

Validation : compilation TypeScript/Vite, tests de l’extension compilée et tests Python incluant le transport WebSocket réel avec moteur simulé. Modèles réels, vitesse et rendu Chrome/Edge Windows restent à vérifier sur la machine utilisateur ; aucune réduction chiffrée de latence n’est annoncée.


### Version 1.17 : voix originale et reconnaissance

La case « Couper la voix originale » fonctionne pendant la traduction vocale, en capture audio comme en sous-titres natifs. Le flux transmis au moteur n’est pas coupé. Le son original revient à l’arrêt ; l’état muet initial de l’onglet est conservé pour les sous-titres.

« Précision renforcée » élargit la recherche Whisper à 5 hypothèses de décodage, sans changer les modèles installés ; le calcul peut prendre plus de temps. Le domaine facultatif Sondages guide la reconnaissance et explicite le sens politique de party pour la traduction anglaise, sans modifier la transcription affichée. Ce réglage est spécifique à ce domaine. La justesse de traduction n’est pas garantie.

Voir `docs/MISE_A_JOUR_1_17.txt` pour mettre à jour les deux composants et configurer un cours anglais.


### Version 1.18 : 18 sujets disponibles

Les réglages avancés proposent 18 choix, dont Général : santé, droit, éducation, sciences, mathématiques/statistiques, finance, tourisme, musique, religion, sport, ingénierie, agriculture et médias rejoignent les domaines existants. Chaque sujet ajoute un vocabulaire anglais/français à la reconnaissance. Ce ne sont pas des modèles de traduction spécialisés et la justesse n’est pas garantie. Les préférences existantes restent valides. Voir `docs/MISE_A_JOUR_1_18.txt` ; mettre à jour moteur et extension ensemble.


### Version 1.19 : IA, ML, deep learning et développement

Quatre sujets distincts portent la liste à 22 choix (dont Général) : IA générative, machine learning, deep learning et développement logiciel. Ils fournissent du vocabulaire de reconnaissance, sans activer un modèle à instructions. À cette version, les experts à prompts et le glossaire source/cible n’étaient pas encore intégrés ; voir la version 1.20 ci-dessous. Voir `docs/MISE_A_JOUR_1_19.txt`.

### Version 1.20 : experts locaux, terminologie multilingue et voix naturelles

Les stratégies Général, Technique, Cours, Oral et Personnalisé utilisent Ollama local pour les passages finalisés, le sujet sélectionné, deux passages de contexte et les termes applicables. En cas d’absence, d’erreur ou de lenteur (8 secondes), la session revient sur Argos avec une notification. Le choix automatique respecte un budget prudent de RAM parmi les modèles déjà installés ; Ollama gère CPU/GPU. Aucun téléchargement implicite ni modèle cloud, vérifié avec `/api/show`. Les stratégies sont originales, inspirées du principe des experts d’[Immersive Translate](https://immersivetranslate.com/en/docs/prompts/).

Le glossaire versionné fonctionne aussi avec Argos, dans toutes les directions actives. Les codes de langue restent extensibles indépendamment des modèles installés. Import/export JSON, formulaire d’ajout et 72 entrées IA optionnelles couvrant les 12 directions entre en/fr/es/zh. Un domaine spécifique prime sur une entrée générale. Les marqueurs sont vérifiés ; si Argos les modifie, une traduction par fragments conserve les termes au prix du naturel. Les corrections exactes restent prioritaires.

Piper est facultatif : `INSTALLER_VOIX.cmd` installe une voix pour la langue choisie. Les WAV sont joués hors de l’onglet capturé, avec repli sur une voix système locale. Une seule voix est chargée en mémoire ; lecture successive, vitesse réglable, dédoublonnage et file bornée avec alerte de retard. Les phrases non lues lors d’un débordement restent dans l’historique. L’arrêt annule la voix et rétablit l’audio original.

Voir [mise à jour et activation](docs/MISE_A_JOUR_1_20.txt). Un WAV Piper français a été généré réellement sur CPU ; le routage Ollama et ses erreurs sont testés avec des doubles. Il reste à mesurer un modèle IA réel et à valider la lecture complète dans Chrome/Edge sur Windows. Cette version ne promet pas la qualité ni la synchronisation d’un doublage YouTube préparé.
