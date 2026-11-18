"""Load and run the experimental Mendeley crop classifier."""

from functools import lru_cache
from pathlib import Path

import joblib
import pandas as pd

FEATURES = [
    "SOIL", "SEASON", "WATER_SOURCE", "SOIL_PH", "TEMP",
    "RELATIVE_HUMIDITY", "N", "P", "K",
]
MODEL_PATH = Path(__file__).resolve().parents[2] / "artifacts" / "crop_recommendation.joblib"
LIMITATION = (
    "Experimental ranking trained on a CTGAN-augmented Tamil Nadu dataset. "
    "Model vote shares are not calibrated suitability probabilities or field-validated advice."
)


def canonical_soil(value: object) -> str:
    soil = str(value or "").replace("\u00a0", " ").strip().casefold()
    if "sandy" in soil and ("loam" in soil or "loamy" in soil):
        return "sandy loam"
    if "clay" in soil and ("loam" in soil or "loamy" in soil):
        return "clay loam"
    if "alluvial" in soil:
        return "alluvial"
    if "black" in soil:
        return "black soil"
    if "red" in soil:
        return "red soil"
    if "silt" in soil:
        return "silt"
    if "loam" in soil or "loamy" in soil:
        return "loam"
    if "clay" in soil:
        return "clay"
    if "sandy" in soil or "sand" in soil:
        return "sandy"
    return "other"


@lru_cache(maxsize=1)
def load_model() -> dict:
    if not MODEL_PATH.is_file():
        raise FileNotFoundError("Trained crop model artifact is missing")
    return joblib.load(MODEL_PATH)


def predict_top_crops(context: dict, limit: int = 3) -> dict:
    bundle = load_model()
    row = {
        "SOIL": canonical_soil(context["soilType"]) if context.get("soilType") else None,
        "SEASON": context["season"].strip().casefold() if context.get("season") else None,
        "WATER_SOURCE": context["waterSource"].strip().casefold() if context.get("waterSource") else None,
        "SOIL_PH": context.get("ph"),
        "TEMP": context.get("temperature"),
        "RELATIVE_HUMIDITY": context.get("humidity"),
        "N": context.get("N"),
        "P": context.get("P"),
        "K": context.get("K"),
    }
    missing = [key for key, value in row.items() if value is None]
    probabilities = bundle["model"].predict_proba(pd.DataFrame([row], columns=FEATURES))[0]
    classes = bundle["classes"]
    ranked = sorted(zip(classes, probabilities), key=lambda item: float(item[1]), reverse=True)[:limit]
    results = [
        {
            "crop": str(crop).strip().title(),
            "score": round(float(vote) * 100, 1),
            "suitability": f"Model rank {rank}",
            "reason": "Relative tree-vote ranking only; not a calibrated suitability probability.",
            "waterRequirement": "Not assessed by this model",
            "season": "Farm season input" if row["SEASON"] else "Not provided",
        }
        for rank, (crop, vote) in enumerate(ranked, start=1)
    ]
    return {
        "recommendations": results,
        "missingInputs": missing,
        "limitation": LIMITATION,
        "featureSource": "saved farmer-provided farm profile and, when coordinates are available, current Open-Meteo weather-model conditions; absent fields are median/mode-imputed by the fitted training pipeline",
        "currentWeatherUsed": row["TEMP"] is not None and row["RELATIVE_HUMIDITY"] is not None,
    }
