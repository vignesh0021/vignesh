"""Provider-agnostic text-to-image (photoreal) rendering. Free-first.

IMAGE_PROVIDER = pollinations | local_sd | huggingface | replicate | none
  pollinations  zero-key, always-works cloud fallback (prompt only, no ControlNet).
                So the user is never left with nothing.
  local_sd      Automatic1111 / Forge WebUI at :7860 with the ControlNet extension.
                Uses the front line-art as the ControlNet image -> geometry stays locked.
                Fully free & local, highest quality. THE recommended route.
  huggingface   HF Inference API (free tier), SDXL text-to-image (prompt only).
  replicate     Replicate SDXL / ControlNet (needs token).

Every provider returns a base64 PNG string.
"""
from __future__ import annotations
import os, base64, io, time, requests

TIMEOUT = 300


def _provider() -> str:
    return os.getenv("IMAGE_PROVIDER", "pollinations").strip().lower()


def status() -> dict:
    p = _provider()
    configured = {
        "pollinations": True,
        "local_sd": True,   # checked at call time
        "huggingface": bool(os.getenv("HF_API_KEY")),
        "replicate": bool(os.getenv("REPLICATE_API_TOKEN")),
        "none": False,
    }.get(p, False)
    return {"provider": p, "configured": configured,
            "controlnet": p == "local_sd"}


def render(prompts: dict, control_png_b64: str | None = None,
           width: int = 1024, height: int = 768) -> dict:
    p = _provider()
    if p == "none":
        raise RuntimeError("IMAGE_PROVIDER=none")
    if p == "local_sd":
        img = _local_sd(prompts, control_png_b64, width, height)
    elif p == "huggingface":
        img = _huggingface(prompts, width, height)
    elif p == "replicate":
        img = _replicate(prompts, control_png_b64, width, height)
    else:
        img = _pollinations(prompts, width, height)
    return {"image_b64": img, "provider": p, "controlnet_used": p == "local_sd"}


# --------------------------------------------------------------------------
def _local_sd(prompts, control_png_b64, w, h):
    base = os.getenv("SD_WEBUI_URL", "http://localhost:7860")
    payload = {
        "prompt": prompts["positive"],
        "negative_prompt": prompts["negative"],
        "steps": int(os.getenv("SD_STEPS", "28")),
        "cfg_scale": 6.5, "width": w, "height": h,
        "sampler_name": os.getenv("SD_SAMPLER", "DPM++ 2M Karras"),
    }
    if control_png_b64:
        module = os.getenv("SD_CONTROL_MODULE", "canny")
        model = os.getenv("SD_CONTROL_MODEL", "control_v11p_sd15_canny")
        payload["alwayson_scripts"] = {"controlnet": {"args": [{
            "input_image": control_png_b64, "module": module, "model": model,
            "weight": 1.0, "guidance_start": 0.0, "guidance_end": 1.0,
            "control_mode": "ControlNet is more important", "pixel_perfect": True,
        }]}}
    r = requests.post(f"{base}/sdapi/v1/txt2img", json=payload, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()["images"][0]


def _pollinations(prompts, w, h):
    import urllib.parse
    prompt = urllib.parse.quote(prompts["positive"][:1400])
    url = (f"https://image.pollinations.ai/prompt/{prompt}"
           f"?width={w}&height={h}&nologo=true&model=flux")
    r = requests.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    return base64.b64encode(r.content).decode()


def _huggingface(prompts, w, h):
    key = os.environ["HF_API_KEY"]
    model = os.getenv("HF_IMAGE_MODEL", "stabilityai/stable-diffusion-xl-base-1.0")
    r = requests.post(f"https://api-inference.huggingface.co/models/{model}",
                      headers={"Authorization": f"Bearer {key}"},
                      json={"inputs": prompts["positive"],
                            "parameters": {"negative_prompt": prompts["negative"],
                                           "width": w, "height": h}},
                      timeout=TIMEOUT)
    r.raise_for_status()
    return base64.b64encode(r.content).decode()


def _replicate(prompts, control_png_b64, w, h):
    key = os.environ["REPLICATE_API_TOKEN"]
    version = os.getenv("REPLICATE_MODEL_VERSION",
                        "stability-ai/sdxl:39ed52f2a78e934b3ba6e2a89f5b1c712de7dfea535525255b1aa35c5565e08b")
    body = {"version": version.split(":")[-1],
            "input": {"prompt": prompts["positive"],
                      "negative_prompt": prompts["negative"],
                      "width": w, "height": h}}
    if control_png_b64:
        body["input"]["image"] = f"data:image/png;base64,{control_png_b64}"
    r = requests.post("https://api.replicate.com/v1/predictions",
                      headers={"Authorization": f"Token {key}",
                               "Content-Type": "application/json"},
                      json=body, timeout=TIMEOUT)
    r.raise_for_status()
    pred = r.json()
    get_url = pred["urls"]["get"]
    for _ in range(120):
        time.sleep(2)
        s = requests.get(get_url, headers={"Authorization": f"Token {key}"},
                         timeout=30).json()
        if s["status"] == "succeeded":
            out = s["output"][0] if isinstance(s["output"], list) else s["output"]
            img = requests.get(out, timeout=TIMEOUT).content
            return base64.b64encode(img).decode()
        if s["status"] in ("failed", "canceled"):
            raise RuntimeError(f"replicate {s['status']}")
    raise TimeoutError("replicate timed out")
