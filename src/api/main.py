"""
FastAPI application entry point.

Run with:
    uvicorn src.api.main:app --reload --host 0.0.0.0 --port 8000

The lifespan context manager loads all models once at startup —
not on every request. This is critical for performance since the
k-NN index and latent factors are in-memory structures.
"""

from contextlib import asynccontextmanager
import pandas as pd
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from src.config import (
    TRACKS_CLEAN_PATH, CONTENT_MODEL_PATH, COLLAB_MODEL_PATH,
    CORS_ORIGINS, API_HOST, API_PORT,
)
from src.models.content_model import ContentModel
from src.models.collab_model import CollabModel
from src.models.hybrid_model import HybridModel
from src.api.routes import router, init_routes
from src.pipeline import ensure_artifacts
from src.catalog import load_catalog


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load models once when the server starts up."""
    print("Loading models...")
    ensure_artifacts()

    df = pd.read_csv(TRACKS_CLEAN_PATH)

    content_model = ContentModel.load(CONTENT_MODEL_PATH)
    collab_model = CollabModel.load(COLLAB_MODEL_PATH)
    hybrid_model = HybridModel(content_model, collab_model)
    catalog_df = load_catalog()

    init_routes(df, hybrid_model, content_model, catalog_df)

    print(f"Models loaded. Serving {len(catalog_df):,} real catalogue tracks.")
    yield
    print("Shutting down.")


app = FastAPI(
    title="Music Recommendation API",
    description="Hybrid music recommendation system — audio + lyrics + collaborative filtering",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router, prefix="/api")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("src.api.main:app", host=API_HOST, port=API_PORT, reload=True)
