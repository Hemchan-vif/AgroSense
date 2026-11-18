# AgroSense

Telegram-first farm advisory application with an Angular Mini App, Express/Mongoose API, Telegram bot, and FastAPI crop suitability service.

## What works

- Telegram `/start`, `/help`, `/profile`, `/farm`, `/weather`, `/crop`, and `/rotation` commands, conversational text, callbacks, farm location sharing, soil selection, and skippable name/size onboarding.
- Persistent user, farm, conversation, messages, recommendation, rotation-plan, and weather cache documents in MongoDB.
- Mini App API access validated against Telegram WebApp `initData` on the server. Local browser demo identities are available only outside production; set `DEMO_MODE=false` to disable them.
- Crop recommendations use the trained Random Forest service when `CROP_MODEL_ENABLED=true` and FastAPI is available. The model produces experimental relative vote rankings; the Mini App labels their limits and lists fields imputed from the training data. If the model service is unavailable, the transparent rule-based recommender remains the fallback. Neither model votes nor rule scores are yield forecasts or field-calibrated probabilities.
- Open-ended agricultural questions use Gemini Interactions when `AI_API_KEY` is configured. Requests include the latest question, recent conversation context, and saved farm fields; `store=false` is sent. Crop scores and weather remain deterministic/data-backed.
- Weather comes from Open-Meteo current weather-model conditions and a three-day forecast. The Mini App can use device location for a one-time lookup or saved farm coordinates by default; Telegram uses the saved farm location. Results refresh automatically every 10 minutes and are cached for 10 minutes. Provider time and attribution are shown. “Current” values are model-based, not local sensor observations. Open-Meteo’s free API is intended for non-commercial use; see its [terms](https://open-meteo.com/en/terms).
- Farm profiles can request an ISRIC SoilGrids 2.0 estimate at saved coordinates, including pH, organic carbon, total nitrogen, particle-size fractions, CEC, and bulk density at 0–5 cm and 5–15 cm. The estimates and 5th–95th prediction ranges are cached for 30 days, displayed separately from farmer-entered soil type and laboratory values, and never overwrite measured fields. SoilGrids is modeled gridded data (about 250 m), its point API is beta and has a published fair-use limit; some pixels may return no usable estimate. [API docs](https://rest.isric.org/soilgrids/v2.0/docs) · [layer units, depths, and uncertainty](https://docs.isric.org/globaldata/soilgrids/SoilGrids_faqs_01.html) · [fair-use notice](https://rest.isric.org/).
- Farm and weather screens use OpenStreetMap reverse geocoding to label coordinates with the nearest mapped locality. Place lookups are cached for 30 days and queued to respect the public service limit; manual pin maps include OSM tile attribution. [Nominatim usage policy](https://operations.osmfoundation.org/policies/nominatim/).
- Farm details, soil measurements, crop advice, history, weather, and profile screens use API data; no sample farm measurements are prefilled.

## Local development

1. Copy `.env.example` to `.env`. Configure a Telegram bot token only if you want to use the bot. Keep secrets out of frontend files.
2. Start MongoDB locally, or run `docker compose up -d mongodb`.
3. Start the backend: `cd backend && npm install && npm run dev`.
4. Start the Mini App: `cd frontend && npm install && npm start`. Open `http://localhost:4200` for the isolated development demo. API requests from localhost use a persistent browser demo user.
5. Optional: start FastAPI in another terminal with `cd ai-engine && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`.

The crop model artifact is stored at `ai-engine/artifacts/crop_recommendation.joblib` and is excluded from source control. Train it with the Mendeley CSV using `py -m venv .venv` (from `ai-engine`), then `.venv\\Scripts\\python.exe -m pip install -r requirements.txt` and `.venv\\Scripts\\python.exe train_crop_model.py`. Set `CROP_MODEL_ENABLED=true` to use it; otherwise the API uses the rule baseline. Keep the model service bound to localhost during local Telegram tunneling.

The Mini App inside Telegram requires a public HTTPS URL. Set `TELEGRAM_MINI_APP_URL` or use the existing optional tunnel service. Configure a public webhook URL and `TELEGRAM_WEBHOOK_SECRET` for webhook deployments; otherwise the bot uses polling.

## Docker

`docker compose up --build` starts MongoDB, the API, and the optional AI service. Build the Angular app with `cd frontend && npm install && npm run build` before using the backend to serve the Mini App from `frontend/dist/frontend/browser`, or run Angular separately during development.

## Configuration

See `.env.example` for the supported variables. MongoDB is mandatory; the API does not start if its connection fails. The external weather service is Open-Meteo and does not require a key. All service credentials belong in `.env` or the deployment environment.

Without `AI_API_KEY`, crop recommendations, rotation, soil guidance, and weather remain available; open-ended questions return a clear fallback. Configure a Gemini API key to enable generated answers. Never place the key in frontend code.

## Advice limitations

Crop scores compare a small, documented crop profile against saved inputs. They are not calibrated probabilities, yield estimates, or substitutes for local agronomic guidance. The weather endpoint returns weather-model current conditions and forecasts only for coordinates. Place names alone are not geocoded. Soil fertility advice requires measured lab values; the app never claims sensor measurements it did not receive.
