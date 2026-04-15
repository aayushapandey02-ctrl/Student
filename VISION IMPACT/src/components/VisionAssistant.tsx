import React, { useRef, useEffect, useCallback, useState } from 'react';
import Webcam from 'react-webcam';
import { analyzeImage, Detection } from '../services/visionService';

const VIDEO_WIDTH = 640;
const VIDEO_HEIGHT = 480;

const VisionAssistant: React.FC = () => {
  const webcamRef = useRef<Webcam>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [lastResult, setLastResult] = useState<string>("Tap anywhere to scan.");
  const [detections, setDetections] = useState<Detection[]>([]);
  const [autoScan, setAutoScan] = useState<boolean>(false);

  // Keep a small window of recent detection results so we can report only stable, confident objects.
  const detectionHistory = useRef<Detection[][]>([]);
  const HISTORY_LENGTH = 5; // Last 5 scans (~12.5s when auto scanning every 2.5s)

  const addDetectionsToHistory = (newDetections: Detection[]) => {
    detectionHistory.current = [newDetections, ...detectionHistory.current].slice(0, HISTORY_LENGTH);
  };

  const getStableDetections = (): Detection[] => {
    const history = detectionHistory.current;
    if (!history.length) return [];

    type Agg = { count: number; confSum: number; best: Detection };
    const agg: Record<string, Agg> = {};

    for (const frame of history) {
      for (const det of frame) {
        const key = det.class_name;
        const existing = agg[key];
        if (!existing) {
          agg[key] = { count: 1, confSum: det.confidence, best: det };
        } else {
          existing.count += 1;
          existing.confSum += det.confidence;
          if (det.confidence > existing.best.confidence) {
            existing.best = det;
          }
        }
      }
    }

    const minFrames = Math.max(1, Math.ceil(history.length * 0.6));
    return Object.values(agg)
      .filter((a) => a.count >= minFrames)
      .map((a) => ({ ...a.best, confidence: a.confSum / a.count }));
  };

  const speak = (text: string) => {
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    window.speechSynthesis.speak(utterance);
  };

  const drawDetections = useCallback((detectionsToDraw: Detection[]) => {
    const canvas = canvasRef.current;
    const video = webcamRef.current?.video;
    if (!canvas || !video) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Use a fixed resolution that matches the screenshot size.
    // This prevents mismatch between detection coordinates and the displayed video.
    canvas.width = VIDEO_WIDTH;
    canvas.height = VIDEO_HEIGHT;

    // Clear previous drawings
    ctx.clearRect(0, 0, VIDEO_WIDTH, VIDEO_HEIGHT);

    if (!detectionsToDraw.length) {
      return;
    }

    ctx.lineWidth = 3;
    ctx.font = '18px sans-serif';
    ctx.textBaseline = 'top';

    for (const det of detectionsToDraw) {
      const [x1, y1, x2, y2] = det.box;
      const width = x2 - x1;
      const height = y2 - y1;

      ctx.strokeStyle = 'rgba(255, 220, 0, 0.9)';
      ctx.fillStyle = 'rgba(0, 0, 0, 0.5)';
      ctx.fillRect(x1, y1 - 24, ctx.measureText(`${det.class_name} ${det.confidence.toFixed(2)}`).width + 10, 22);
      ctx.fillStyle = 'white';
      ctx.fillText(`${det.class_name} (${det.confidence.toFixed(2)})`, x1 + 5, y1 - 22);
      ctx.strokeRect(x1, y1, width, height);
    }
  }, []);

  useEffect(() => {
    speak("Vision Assistant Active. Tap anywhere to scan.");
  }, []);

  const horizontalPosition = (box: [number, number, number, number], mirrored: boolean) => {
    const [x1, , x2] = box;
    const center = (x1 + x2) / 2;
    const ratio = center / VIDEO_WIDTH;
    const position = ratio < 0.33 ? "left" : ratio > 0.66 ? "right" : "center";
    // If the video is mirrored, swap left/right to match what the user sees.
    if (mirrored) {
      if (position === "left") return "right";
      if (position === "right") return "left";
    }
    return position;
  };

  const buildMessage = (detections: Detection[], mirrored: boolean) => {
    const top = [...detections]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 3);

    const descriptions = top.map(d => {
      const position = horizontalPosition(d.box, mirrored);
      return `${d.class_name} on the ${position}`;
    });

    return descriptions.length ? `Detected ${descriptions.join(", ")}.` : "No confident objects detected.";
  };

  const handleScan = useCallback(async () => {
    console.log("Button Clicked!"); // Console mein check karna
    if (webcamRef.current) {
      const imageSrc = webcamRef.current.getScreenshot();
      if (imageSrc) {
        speak("Scanning...");
        const result = await analyzeImage(imageSrc);

        if (typeof result === "string") {
          setLastResult(result);
          speak(result);
          setDetections([]);
          detectionHistory.current = [];
        } else {
          console.debug("Detection response:", result);

          // Always draw the latest detections so the overlay feels responsive.
          setDetections(result.detections);

          // Keep recent results so we can report only objects that are stable across frames.
          addDetectionsToHistory(result.detections);
          const stable = getStableDetections();

          const message = buildMessage(stable.length ? stable : result.detections, false);
          setLastResult(message);
          speak(message);
        }
      }
    }
  }, []);

  useEffect(() => {
    if (!autoScan) return;

    const interval = window.setInterval(() => {
      handleScan();
    }, 2500);

    return () => window.clearInterval(interval);
  }, [autoScan, handleScan]);

  useEffect(() => {
    drawDetections(detections);
  }, [detections, drawDetections]);

  return (
    <div className="relative h-screen w-full bg-black">
      <Webcam
        audio={false}
        ref={webcamRef}
        mirrored={false}
        screenshotFormat="image/jpeg"
        videoConstraints={{ width: VIDEO_WIDTH, height: VIDEO_HEIGHT }}
        className="absolute inset-0 h-full w-full object-cover"
      />

      {/* Canvas overlay to show detected boxes and labels */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 z-40 h-full w-full pointer-events-none"
      />

      {/* Invisible layer on top of everything for clicks */}
      <div 
        className="absolute inset-0 z-50 flex items-center justify-center cursor-pointer"
        onClick={handleScan}
      >
        <div className="p-4 bg-black/40 border-2 border-yellow-500 text-yellow-500 font-bold rounded-lg pointer-events-none">
          TAP ANYWHERE TO SCAN
        </div>
      </div>

      {/* Auto scan toggle */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-black/60 px-3 py-2 text-white">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoScan}
            onChange={(e) => setAutoScan(e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm">Auto scan</span>
        </label>
        <span className="text-xs text-gray-200">(every 2.5s)</span>
      </div>

      {/* Display last scan result on screen for judges */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-lg rounded-lg bg-black/60 p-3 text-center text-white">
        {lastResult}
      </div>
    </div>
  );
};

export default VisionAssistant;
