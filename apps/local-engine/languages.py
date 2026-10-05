"""Langues exposées et modèles directs nécessaires au réseau de traduction."""
LANGUAGES = {"en", "fr", "es", "zh"}
BASE_PAIRS = [("en", "fr"), ("fr", "en"), ("en", "es"), ("es", "en")]
MODEL_PAIRS = BASE_PAIRS + [("en", "zh"), ("zh", "en")]
SAMPLE_TEXTS = {"en": "Hello, welcome.", "fr": "Bonjour, bienvenue.",
                "es": "Hola, bienvenido.", "zh": "你好，欢迎。"}
