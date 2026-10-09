"""Préférences locales bornées : vocabulaire indicatif et corrections exactes."""
import re
from languages import LANGUAGES

DOMAINS = {
    "general": "",
    "informatique": "Python, JavaScript, GitHub, DevOps, API, SQL, Docker, Kubernetes",
    "geographie": "GIS, SIG, FME, ETL, QGIS, raster, vecteur, projection, Sentinel, Landsat, géoréférencement",
    "commerce": "invoice, tax, VAT, revenue, balance sheet, cash flow, profit, facture, TVA, bilan, trésorerie, marge",
    "sondages": "survey, data, raw data, information, organized, unorganized, election, political party, vote, win, lose, BJP, Congress",
    "sante": "patient, diagnosis, treatment, symptoms, blood pressure, prescription, hospital, médecin, diagnostic, traitement, symptômes, santé",
    "droit": "law, court, judge, contract, evidence, liability, appeal, legislation, tribunal, juge, contrat, preuve, responsabilité, recours",
    "education": "lesson, teacher, student, learning, assessment, curriculum, classroom, pédagogie, enseignement, élève, apprentissage, évaluation",
    "sciences": "experiment, hypothesis, molecule, cell, energy, force, chemistry, biology, physics, expérience, hypothèse, cellule, énergie, physique",
    "mathematiques": "equation, variable, probability, statistics, mean, median, variance, sample, correlation, chi-square, équation, probabilité, médiane, échantillon",
    "finance": "investment, interest rate, inflation, stock, bond, portfolio, dividend, exchange rate, investissement, taux, action, obligation, dividende",
    "tourisme": "reservation, itinerary, hotel, flight, airport, transfer, visa, check-in, destination, réservation, itinéraire, vol, aéroport, séjour",
    "musique": "melody, rhythm, harmony, chord, chorus, verse, pitch, tempo, rehearsal, mélodie, rythme, accord, refrain, couplet, répétition",
    "religion": "faith, prayer, worship, scripture, gospel, sermon, church, congregation, foi, prière, louange, évangile, prédication, église",
    "sport": "team, match, score, goal, coach, training, referee, championship, équipe, but, entraîneur, entraînement, arbitre, championnat",
    "ingenierie": "engineering, voltage, current, circuit, torque, pressure, material, structure, construction, tension, courant, couple, matériau, bâtiment",
    "agriculture": "crop, soil, irrigation, harvest, seed, fertilizer, livestock, rainfall, culture, sol, récolte, semence, engrais, élevage",
    "actualites": "journalist, report, interview, headline, broadcast, source, editor, presse, reportage, entretien, titre, diffusion, rédaction",
}


def validate_preferences(options):
    if not isinstance(options, dict):
        raise ValueError("Réglages invalides")
    domain = options.get("domain", "general")
    glossary = options.get("glossary", "")
    corrections = options.get("corrections", [])
    quality = options.get("recognitionQuality", "balanced")
    if quality not in ("balanced", "precise"):
        raise ValueError("Qualité de reconnaissance invalide")
    if domain not in DOMAINS or not isinstance(glossary, str) or len(glossary) > 1500:
        raise ValueError("Domaine invalide ou glossaire trop long (1500 caractères)")
    if not isinstance(corrections, list) or len(corrections) > 100:
        raise ValueError("Au maximum 100 corrections locales")
    clean = []
    for item in corrections:
        if not isinstance(item, dict):
            raise ValueError("Correction invalide")
        values = [item.get(key) for key in ("original", "translation", "source", "target")]
        original, translation, source, target = values
        if not all(isinstance(value, str) for value in values) or not 0 < len(original) <= 2000 or not 0 < len(translation) <= 2000:
            raise ValueError("Correction vide ou trop longue")
        if source not in LANGUAGES or target not in LANGUAGES:
            raise ValueError("Langue de correction invalide")
        clean.append(dict(zip(("original", "translation", "source", "target"), values)))
    return {"domain": domain, "glossary": glossary.strip(), "corrections": clean, "recognitionQuality": quality}


def normalized(text):
    return re.sub(r"\s+", " ", text.strip()).casefold()
