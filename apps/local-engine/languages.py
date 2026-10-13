"""Langues exposées et modèles directs nécessaires au réseau de traduction."""
AUDIO_LANGUAGES = {"en", "fr", "es", "zh"}
AFRICAN_LANGUAGES = {"dyu", "bci", "wol"}
LANGUAGES = AUDIO_LANGUAGES | AFRICAN_LANGUAGES
BASE_PAIRS = [("en", "fr"), ("fr", "en"), ("en", "es"), ("es", "en")]
MODEL_PAIRS = BASE_PAIRS + [("en", "zh"), ("zh", "en")]
SAMPLE_TEXTS = {"en": "Hello, welcome.", "fr": "Bonjour, bienvenue.",
                "es": "Hola, bienvenido.", "zh": "你好，欢迎。"}
