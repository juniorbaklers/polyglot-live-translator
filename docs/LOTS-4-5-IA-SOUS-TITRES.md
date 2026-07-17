# Lots 4 et 5 — IA et sous-titres

## Lot 4

- pipeline interchangeable côté application Windows ;
- transcription des segments audio ;
- détection automatique ou langue source imposée ;
- traduction vers la langue choisie ;
- glossaire prioritaire modifiable ;
- clé API conservée uniquement dans `OPENAI_API_KEY` côté Windows ;
- modèles configurables avec `OPENAI_TRANSCRIPTION_MODEL` et `OPENAI_TRANSLATION_MODEL`.

## Lot 5

- sous-titres original + traduction au-dessus des pages ;
- bloc déplaçable et redimensionnable ;
- bouton de masquage ;
- fenêtre Windows flottante, transparente et toujours au premier plan ;
- affichage progressif du dernier texte reçu.

## Configuration prévue pour le test

La clé ne doit jamais être placée dans l'extension ou dans GitHub. Elle sera
fournie à l'application Windows par variable d'environnement pendant les tests.
