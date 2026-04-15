from fastapi import FastAPI, File, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from ultralytics import YOLO
from PIL import Image
import io
import numpy as np
import os

app = FastAPI()

# Allow the frontend (vite dev server) to call this backend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:5174"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Load a YOLOv8 model for object detection (runs on CPU by default)
# Ensure the model file is resolved relative to this script, so it works even if started from another CWD.
import pathlib
MODEL_PATH = pathlib.Path(__file__).resolve().parent / "yolov8s.pt"
model = YOLO(str(MODEL_PATH))  # small model; downloads on first run

# Confidence threshold for reporting detections (higher -> fewer false positives).
# Lower this a bit to detect smaller/less-certain objects (e.g., "phone" or "person" at an angle).
# Set via environment variable YOLO_MIN_CONF (e.g., 0.25).
#
# NOTE: Increasing this value makes outputs more stable/accurate, but can miss hard-to-see objects.
MIN_CONFIDENCE = float(os.getenv("YOLO_MIN_CONF", "0.4"))

# Only speak about these object types (keeps output focused for blind user).
# The model may detect many things; focusing on a short list avoids “random object” outputs.
IMPORTANT_CLASSES = {
    "person",
    "cell phone",
    "bottle",
    "chair",
    "cup",
    "book",
    "backpack",
    "laptop",
    "remote",
    "tv",
}

@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    # Decode incoming image bytes
    contents = await file.read()
    image = Image.open(io.BytesIO(contents)).convert("RGB")

    # Run YOLO detection (CPU, small model).
    # Use a higher confidence threshold so the model reports fewer but more reliable objects.
    results = model(np.array(image), conf=MIN_CONFIDENCE, iou=0.45, max_det=100)[0]

    def build_detections(result):
        if result.boxes is None or len(result.boxes) == 0:
            return []

        detections = []
        for box, cls, conf in zip(result.boxes.xyxy.tolist(), result.boxes.cls.tolist(), result.boxes.conf.tolist()):
            # Skip any low-confidence detections (this is extra safety)
            if float(conf) < MIN_CONFIDENCE:
                continue
            detections.append({
                "class_id": int(cls),
                "class_name": model.names[int(cls)],
                "confidence": float(conf),
                "box": [float(box[0]), float(box[1]), float(box[2]), float(box[3])],
            })
        return detections

    detections = build_detections(results)

    # If we still have no detections, be explicit so the frontend doesn't display a wrong label
    if not detections:
        return {"objects": [], "message": "No confident objects detected."}

    # Build a human-readable phrasing describing only the most useful detections.
    # Only speak about objects we think are meaningful for a blind user (avoid random detections).
    def normalize_label(name: str) -> str:
        return {
            "cell phone": "phone",
            "wine glass": "glass",
            "tv": "TV",
            "remote": "remote",
        }.get(name, name)

    def horizontal_position(box: list[float], width: int) -> str:
        x1, _, x2, _ = box
        center = (x1 + x2) / 2
        ratio = center / width
        if ratio < 0.33:
            return "left"
        if ratio > 0.66:
            return "right"
        return "center"

    # IMPORTANT: Only report objects that are in our focus list.
    # This prevents random false positives (like "cake" when there's no cake) from being spoken.
    important_detections = [d for d in detections if d["class_name"] in IMPORTANT_CLASSES]

    # Prefer reporting phone even if its confidence is slightly lower than the top detection.
    # This helps avoid cases where a phone is present but the model is slightly less confident about it.
    phone_detections = [d for d in important_detections if d["class_name"] == "cell phone" and d["confidence"] > 0.15]
    other_detections = [d for d in important_detections if d["class_name"] != "cell phone" and d["confidence"] > 0.3]
    reported = phone_detections + other_detections

    # Speak about a small number of the most confident detections so the output stays clear.
    # Increase the limit if you want more objects to be announced (may become noisy).
    top_dets = sorted(reported, key=lambda d: d["confidence"], reverse=True)[:5]

    descriptions = []
    for det in top_dets:
        label = normalize_label(det["class_name"])
        position = horizontal_position(det["box"], image.width)
        descriptions.append(f"{label} on the {position}")

    message = (
        f"Detected {', '.join(descriptions)}."
        if descriptions
        else "No confident objects detected."
    )

    return {"objects": detections, "message": message}
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8001)