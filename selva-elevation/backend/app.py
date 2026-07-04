"""FastAPI backend — upload a plan, get all views + spec back."""
from __future__ import annotations
import os
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

import llm_providers
from spec_schema import SELVA_EXAMPLE, BuildingSpec
from view_generator import generate_all
import plan_analyzer

app = FastAPI(title="SELVA Elevation Studio", version="0.1.0")
app.add_middleware(
    CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"],
)

MAX_MB = 25


def _payload(result: dict) -> dict:
    spec: BuildingSpec = result["spec"]
    return {
        "source": result["source"],
        "provider": result.get("provider"),
        "note": result.get("note"),
        "spec": spec.model_dump(),
        "views": generate_all(spec),          # {name: svg-string}
    }


@app.get("/api/health")
def health():
    return {"ok": True, "llm": llm_providers.available()}


@app.get("/api/example")
def example():
    return _payload({"spec": SELVA_EXAMPLE, "source": "example",
                     "provider": None, "note": "Built-in SELVA G+2 sample."})


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)):
    data = await file.read()
    if len(data) > MAX_MB * 1024 * 1024:
        return JSONResponse(status_code=413,
                            content={"error": f"file too large (>{MAX_MB} MB)"})
    result = plan_analyzer.analyze(data, file.filename or "upload")
    return _payload(result)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "8000")))
