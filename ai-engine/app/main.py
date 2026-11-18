from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional
import os
from pathlib import Path
from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parents[2].parent
load_dotenv(dotenv_path=PROJECT_ROOT / ".env")

from app.services.recommendation_service import generate_crop_recommendation
from app.services.llm_service import process_chat_message
from app.services.crop_model import MODEL_PATH, predict_top_crops

app = FastAPI(title="AgroSense AI Engine", version="1.0.0")

class Location(BaseModel):
    latitude: float
    longitude: float

class CropRecommendationRequest(BaseModel):
    soilType: Optional[str] = None
    previousCrop: Optional[str] = None
    waterSource: Optional[str] = None
    N: Optional[float] = None
    P: Optional[float] = None
    K: Optional[float] = None
    temperature: Optional[float] = None
    humidity: Optional[float] = None
    ph: Optional[float] = None
    rainfall: Optional[float] = None
    season: Optional[str] = None
    location: Optional[Location] = None

class TrainedCropRecommendationRequest(BaseModel):
    soilType: Optional[str] = None
    season: Optional[str] = None
    waterSource: Optional[str] = None
    ph: Optional[float] = Field(default=None, ge=0, le=14)
    N: Optional[float] = Field(default=None, ge=0)
    P: Optional[float] = Field(default=None, ge=0)
    K: Optional[float] = Field(default=None, ge=0)
    temperature: Optional[float] = None
    humidity: Optional[float] = Field(default=None, ge=0, le=100)

class ChatMessageRequest(BaseModel):
    message: str
    context: dict
    intent: str

@app.get("/health")
def health_check():
    return {"status": "healthy", "service": "AgroSense AI Engine", "version": "1.0.0", "trainedCropModel": MODEL_PATH.is_file()}

@app.post("/predict/crop")
def predict_crop(request: CropRecommendationRequest):
    try:
        recommendations = generate_crop_recommendation(request.dict())
        return {"success": True, "data": {"recommendations": recommendations}}
    except Exception:
        raise HTTPException(status_code=500, detail="Recommendation service failed")

@app.post("/predict/crop/trained")
def predict_crop_trained(request: TrainedCropRecommendationRequest):
    try:
        data = predict_top_crops(request.model_dump())
        return {"success": True, "source": "ml_model", "data": data}
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail="Trained crop model is not installed")
    except Exception:
        raise HTTPException(status_code=503, detail="Trained crop model is temporarily unavailable")

@app.post("/chat/process")
def process_chat(request: ChatMessageRequest):
    try:
        response = process_chat_message(request.message, request.context, request.intent)
        return {"success": True, "data": response}
    except Exception:
        raise HTTPException(status_code=500, detail="Chat service failed")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
