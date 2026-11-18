"""Train and evaluate an experimental crop classifier on the Mendeley CSV.

This is an offline research workflow. It does not change the live rule engine.
The source dataset includes CTGAN-generated rows, so the held-out split is only
a within-dataset benchmark and must not be presented as field validation.
"""

from __future__ import annotations

import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import joblib
import pandas as pd
import sklearn
from sklearn.compose import ColumnTransformer
from sklearn.impute import SimpleImputer
from sklearn.metrics import accuracy_score, classification_report, top_k_accuracy_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.ensemble import RandomForestClassifier
from sklearn.dummy import DummyClassifier
from app.services.crop_model import canonical_soil


ROOT = Path(__file__).resolve().parent
DATA_PATH = ROOT / "data" / "Crop recommendation dataset.csv"
ARTIFACT_DIR = ROOT / "artifacts"
MODEL_PATH = ARTIFACT_DIR / "crop_recommendation.joblib"
REPORT_PATH = ARTIFACT_DIR / "training_report.json"
SEED = 42
LABEL = "CROPS"

# These fields are available in farm profiles or as measured inputs. Exclude
# crop category, sow/harvest month, and *_MAX reference ceilings to reduce
# label leakage and keep the first experiment closer to usable farm inputs.
CATEGORICAL = ["SOIL", "SEASON", "WATER_SOURCE"]
NUMERIC = ["SOIL_PH", "TEMP", "RELATIVE_HUMIDITY", "N", "P", "K"]
FEATURES = CATEGORICAL + NUMERIC


def main() -> None:
    if not DATA_PATH.exists():
        raise SystemExit(f"Dataset not found: {DATA_PATH}")

    frame = pd.read_csv(DATA_PATH)
    missing_columns = sorted(set([LABEL, *FEATURES]) - set(frame.columns))
    if missing_columns:
        raise SystemExit(f"Dataset is missing expected columns: {missing_columns}")

    frame = frame[[LABEL, *FEATURES]].copy()
    frame[LABEL] = frame[LABEL].astype("string").str.strip()
    frame = frame.dropna(subset=[LABEL])
    for column in CATEGORICAL:
        frame[column] = frame[column].astype("string").str.strip().replace("", pd.NA)
    frame["SOIL"] = frame["SOIL"].map(canonical_soil)
    frame["SEASON"] = frame["SEASON"].str.casefold()
    frame["WATER_SOURCE"] = frame["WATER_SOURCE"].str.casefold()
    for column in NUMERIC:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")

    X = frame[FEATURES]
    y = frame[LABEL].astype(str)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.20, random_state=SEED, stratify=y
    )

    preprocessing = ColumnTransformer(
        transformers=[
            ("categorical", Pipeline([
                ("impute", SimpleImputer(strategy="most_frequent")),
                ("onehot", OneHotEncoder(handle_unknown="ignore")),
            ]), CATEGORICAL),
            ("numeric", Pipeline([
                ("impute", SimpleImputer(strategy="median")),
                ("scale", StandardScaler()),
            ]), NUMERIC),
        ],
        remainder="drop",
    )

    # A balanced-label dummy baseline helps catch an evaluation/setup error.
    baseline = DummyClassifier(strategy="most_frequent")
    baseline.fit(X_train, y_train)
    baseline_accuracy = accuracy_score(y_test, baseline.predict(X_test))

    model = Pipeline([
        ("preprocessing", preprocessing),
        ("classifier", RandomForestClassifier(
            n_estimators=120,
            max_depth=18,
            min_samples_leaf=5,
            class_weight="balanced_subsample",
            max_features="sqrt",
            random_state=SEED,
            n_jobs=-1,
        )),
    ])
    model.fit(X_train, y_train)
    predicted = model.predict(X_test)
    probabilities = model.predict_proba(X_test)
    classes = model.named_steps["classifier"].classes_

    report = {
        "dataset": {
            "name": "Crop recommendation",
            "citation": "Thangatamilan, S. (2025). Mendeley Data, V1. https://doi.org/10.17632/vynxnppr7j.1",
            "license": "CC BY 4.0",
            "known_limitation": "Source description says data was expanded using CTGAN; this is not independent field validation.",
            "path": "data/Crop recommendation dataset.csv",
            "rows_used": int(len(frame)),
            "duplicate_rows": int(frame.duplicated().sum()),
            "class_count": int(y.nunique()),
            "class_counts": {str(k): int(v) for k, v in y.value_counts().sort_index().items()},
            "missing_fraction_by_feature": {c: float(X[c].isna().mean()) for c in FEATURES},
        },
        "evaluation": {
            "method": "stratified random 80/20 holdout; same dataset distribution",
            "random_seed": SEED,
            "train_rows": int(len(X_train)),
            "test_rows": int(len(X_test)),
            "baseline_accuracy": float(baseline_accuracy),
            "accuracy": float(accuracy_score(y_test, predicted)),
            "top_3_accuracy": float(top_k_accuracy_score(y_test, probabilities, k=3, labels=classes)),
            "per_class": classification_report(y_test, predicted, output_dict=True, zero_division=0),
            "warning": "Metrics describe only a random split of this CTGAN-augmented dataset, not performance on real farms.",
        },
        "features": FEATURES,
        "runtime": {
            "python": sys.version.split()[0],
            "pandas": pd.__version__,
            "scikit_learn": sklearn.__version__,
            "joblib": joblib.__version__,
        },
        "model_config": {
            "estimator": "RandomForestClassifier",
            "n_estimators": 120,
            "max_depth": 18,
            "min_samples_leaf": 5,
            "class_weight": "balanced_subsample",
            "random_seed": SEED,
        },
        "excluded_columns": ["TYPE_OF_CROP", "SOWN", "HARVESTED", "*_MAX"],
        "created_at_utc": datetime.now(timezone.utc).isoformat(),
    }

    ARTIFACT_DIR.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "features": FEATURES, "classes": list(classes)}, MODEL_PATH)
    REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps({
        "rows": len(frame),
        "classes": int(y.nunique()),
        "baseline_accuracy": round(baseline_accuracy, 4),
        "accuracy": round(report["evaluation"]["accuracy"], 4),
        "top_3_accuracy": round(report["evaluation"]["top_3_accuracy"], 4),
        "model": str(MODEL_PATH),
        "report": str(REPORT_PATH),
        "warning": report["evaluation"]["warning"],
    }, indent=2))


if __name__ == "__main__":
    main()
