"""Optional Gemini conversational adapter; never fabricates local measurements."""
import os
import requests

SYSTEM_INSTRUCTION = (
    "You are AgroSense, a concise agricultural information assistant. "
    "Use only supplied farmer details as facts. Never invent local weather, soil readings, "
    "crop yields, diagnoses, or regulations. Give practical general guidance, ask one "
    "focused follow-up when needed, and recommend local extension support for uncertain "
    "disease or pesticide questions. Crop suitability scores are computed by a separate "
    "deterministic service and must not be guessed."
)


def _text_from_response(payload: dict) -> str:
    direct = payload.get("output_text")
    if isinstance(direct, str):
        return direct.strip()
    parts = []
    for item in payload.get("steps", payload.get("output", [])):
        if isinstance(item, dict):
            if isinstance(item.get("text"), str):
                parts.append(item["text"])
            for child in item.get("content", item.get("parts", [])):
                if isinstance(child, dict) and isinstance(child.get("text"), str):
                    parts.append(child["text"])
    return "\n".join(parts).strip()


def process_chat_message(message: str, context: dict, intent: str) -> dict:
    api_key = os.getenv("AI_API_KEY")
    if not api_key:
        return {
            "text": "Open-ended AI advice is not configured yet. Crop, rotation, and weather features remain available through the AgroSense advisory engine.",
            "source": "fallback",
        }

    prompt = (
        f"Detected topic: {intent}\n"
        f"Farmer context (provided data only): {context}\n"
        f"Farmer message: {message}"
    )
    try:
        headers = {"x-goog-api-key": api_key, "content-type": "application/json"}
        model = os.getenv("AI_MODEL", "gemini-3.8-flash")
        fallback = os.getenv("AI_FALLBACK_MODEL", "gemini-3.6-flash")
        body = {
            "model": model,
            "input": prompt,
            "system_instruction": SYSTEM_INSTRUCTION,
            "store": False,
            "generation_config": {"thinking_level": "low", "max_output_tokens": 500},
        }
        response = requests.post("https://generativelanguage.googleapis.com/v1beta/interactions", headers=headers, json=body, timeout=12)
        if response.status_code in (429, 503) and fallback != model:
            body["model"] = fallback
            response = requests.post("https://generativelanguage.googleapis.com/v1beta/interactions", headers=headers, json=body, timeout=12)
        response.raise_for_status()
        text = _text_from_response(response.json())
        if text:
            return {"text": text[:4000], "source": "gemini"}
    except requests.RequestException:
        pass
    return {
        "text": "The AI service is temporarily unavailable. Please try again, or ask about crop recommendations, rotation, soil, or weather.",
        "source": "fallback",
    }
