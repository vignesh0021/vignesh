"""FastAPI backend — upload a plan, get all views + spec back."""
from __future__ import annotations
import os
from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

import llm_providers
import image_providers
from spec_schema import SELVA_EXAMPLE, BuildingSpec
from view_generator import generate_all
from render_prompt import build_prompts
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
    return {"ok": True, "llm": llm_providers.available(),
            "image": image_providers.status()}


class RenderReq(BaseModel):
    spec: dict
    theme_id: str = "white-teak"
    control_png_b64: str | None = None      # front line-art from the client (for ControlNet)
    width: int = 1024
    height: int = 768


@app.post("/api/render3d")
def render3d(req: RenderReq):
    """Route B — AI photoreal render. Uses the front line-art as a ControlNet
    constraint when the provider supports it (local_sd), so geometry stays locked."""
    try:
        spec = BuildingSpec(**req.spec)
    except Exception as e:                      # noqa: BLE001
        return JSONResponse(status_code=400, content={"error": f"bad spec: {e}"})
    prompts = build_prompts(spec, req.theme_id)
    st = image_providers.status()
    if not st["configured"]:
        return JSONResponse(status_code=503, content={
            "error": f"image provider '{st['provider']}' not configured",
            "prompts": prompts, "status": st})
    try:
        out = image_providers.render(prompts, req.control_png_b64, req.width, req.height)
        return {**out, "prompts": prompts,
                "note": ("Rendered with ControlNet — geometry locked to your plan."
                         if out["controlnet_used"] else
                         "Prompt-only render (no ControlNet on this provider); "
                         "use local_sd for exact geometry lock.")}
    except Exception as e:                      # noqa: BLE001
        return JSONResponse(status_code=502, content={
            "error": f"{type(e).__name__}: {e}", "prompts": prompts, "status": st})


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
