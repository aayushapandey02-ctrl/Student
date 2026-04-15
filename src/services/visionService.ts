const VITE_API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.trim();

// Prefer explicit ENV URL in deploy, otherwise use Vite proxy path for dev.
// Keep this robust even if someone sets VITE_API_URL=":8001/analyze" by accident.
const API_ENDPOINT = (() => {
  if (!VITE_API_URL) return "/analyze";
  if (VITE_API_URL.startsWith("http://") || VITE_API_URL.startsWith("https://")) {
    return VITE_API_URL;
  }
  if (VITE_API_URL.startsWith(":")) {
    return `http://127.0.0.1${VITE_API_URL}`;
  }
  return VITE_API_URL;
})();

const VIDEO_WIDTH = 640;

const normalizeLabel = (name: string) =>
  ({
    "cell phone": "phone",
    "wine glass": "glass",
    tv: "TV",
    remote: "remote",
  } as Record<string, string>)[name] ?? name;

const horizontalPosition = (box: [number, number, number, number]) => {
  const [x1, , x2] = box;
  const center = (x1 + x2) / 2;
  const ratio = center / VIDEO_WIDTH;
  if (ratio < 0.33) return "left";
  if (ratio > 0.66) return "right";
  return "center";
};

export type Detection = {
  class_name: string;
  confidence: number;
  box: [number, number, number, number];
};

export type AnalyzeResult = {
  message: string;
  detections: Detection[];
};

export const analyzeImage = async (base64Image: string): Promise<AnalyzeResult | string> => {
  try {
    // Convert base64 to blob
    const base64Data = base64Image.split(",")[1];
    const blob = await fetch(`data:image/jpeg;base64,${base64Data}`).then(r => r.blob());

    const formData = new FormData();
    formData.append("file", blob, "image.jpg");

    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      body: formData,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(`API request failed (status ${response.status}): ${text}`);
    }

    const data = await response.json();

    const detections: Detection[] = data.objects ?? [];

    // Filter out low-confidence detections to avoid false positives
    const confidentDetections = detections.filter(d => d.confidence > 0.4);

    // Prefer reporting only meaningful objects, to avoid confusing output.
    // const highPriority = detections.filter(d => IMPORTANT_CLASSES.has(d.class_name));
    // const reported = highPriority.length ? highPriority : detections;
    const reported = confidentDetections;

    const top = reported
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    const descriptions = top.map(d => {
      const label = normalizeLabel(d.class_name);
      const position = horizontalPosition(d.box);
      return `${label} on the ${position}`;
    });

    const message = descriptions.length
      ? `Detected ${descriptions.join(", ")}.`
      : "No confident objects detected.";

    return { message, detections };
  } catch (error) {
    console.error("Vision service error:", error, "endpoint=", API_ENDPOINT);
    const message = error instanceof Error ? error.message : String(error);
    return `Local model error: ${message} (endpoint: ${API_ENDPOINT})`;
  }
};