"""Transparent crop suitability scoring over curated crop agronomy ranges.

This is a rule-based baseline, not a trained ML model or a yield predictor.
Only explicitly supplied measurements affect a score; missing values are never
filled with assumed weather or soil measurements.
"""

CROPS = [
    {"crop": "Millet", "soils": ["sandy", "sandy loam", "red soil", "loam"], "seasons": ["kharif", "year-round"], "water": "Low", "family": "cereal", "ph": (5, 8.5), "rain": (250, 800)},
    {"crop": "Groundnut", "soils": ["sandy", "sandy loam", "red soil", "loam"], "seasons": ["kharif", "rabi"], "water": "Moderate", "family": "legume", "ph": (5.5, 7.5), "rain": (500, 1000)},
    {"crop": "Chickpea", "soils": ["loam", "clay loam", "black soil", "sandy loam"], "seasons": ["rabi"], "water": "Low", "family": "legume", "ph": (6, 8), "rain": (300, 600)},
    {"crop": "Pigeon pea", "soils": ["loam", "red soil", "sandy loam", "black soil"], "seasons": ["kharif"], "water": "Low", "family": "legume", "ph": (5, 7.5), "rain": (600, 1000)},
    {"crop": "Maize", "soils": ["loam", "clay loam", "alluvial", "red soil"], "seasons": ["kharif", "rabi"], "water": "Moderate", "family": "cereal", "ph": (5.5, 7.5), "rain": (500, 800)},
    {"crop": "Sorghum", "soils": ["black soil", "loam", "red soil", "clay loam"], "seasons": ["kharif", "rabi"], "water": "Low", "family": "cereal", "ph": (5.5, 8), "rain": (400, 800)},
    {"crop": "Rice", "soils": ["clay", "clay loam", "alluvial", "loam"], "seasons": ["kharif", "rabi"], "water": "High", "family": "cereal", "ph": (5, 7), "rain": (1000, 2500)},
    {"crop": "Green gram", "soils": ["sandy loam", "loam", "red soil", "alluvial"], "seasons": ["kharif", "rabi", "zaid"], "water": "Low", "family": "legume", "ph": (6, 7.5), "rain": (350, 700)},
    {"crop": "Cotton", "soils": ["black soil", "clay loam", "loam"], "seasons": ["kharif"], "water": "Moderate", "family": "fiber", "ph": (5.5, 8), "rain": (500, 1200)},
    {"crop": "Mustard", "soils": ["loam", "sandy loam", "alluvial"], "seasons": ["rabi"], "water": "Low", "family": "oilseed", "ph": (6, 8), "rain": (300, 600)},
]


def generate_crop_recommendation(context: dict) -> list:
    soil = context.get("soilType") or context.get("soil_type")
    season = (context.get("season") or "").lower()
    previous = (context.get("previousCrop") or "").lower()
    ph = context.get("ph")
    rainfall = context.get("rainfall")
    results = []
    for profile in CROPS:
        score, reasons = 45, []
        if soil:
            if soil.lower() in profile["soils"]:
                score += 25; reasons.append(f"Compatible with {soil} soil")
            else:
                score -= 12; reasons.append(f"Soil compatibility is uncertain for {soil} soil")
        if season:
            score += 12 if season in profile["seasons"] else -12
        if ph is not None:
            if profile["ph"][0] <= ph <= profile["ph"][1]:
                score += 10; reasons.append("Provided soil pH is within a suitable range")
            else:
                score -= 10
        if rainfall is not None:
            if profile["rain"][0] <= rainfall <= profile["rain"][1]:
                score += 8; reasons.append("Provided rainfall is within the crop's broad range")
            else:
                score -= 8
        previous_profile = next((item for item in CROPS if item["crop"].lower() == previous), None)
        if previous_profile:
            score += 8 if previous_profile["family"] != profile["family"] else -10
            if previous_profile["family"] != profile["family"]:
                reasons.append("Different crop family supports rotation diversity")
        score = max(25, min(96, score))
        results.append({"crop": profile["crop"], "score": score,
                        "suitability": "High" if score >= 75 else "Good" if score >= 60 else "Moderate",
                        "reason": "; ".join(reasons) + "." if reasons else "General crop profile only; provide farm details for more specific guidance.",
                        "waterRequirement": profile["water"], "season": " / ".join(profile["seasons"])})
    return sorted(results, key=lambda item: item["score"], reverse=True)[:3]
