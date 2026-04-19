"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Camera, CheckCircle2, MessageCircle } from "lucide-react";
import MessageSidebar from "@/components/MessageSidebar";

type GuardrailState = "needs_centering" | "hold_still" | "ready";

const SAMPLE_INTERVAL_MS = 140;
const SAMPLE_CANVAS_SIZE = 64;
const HOLD_STILL_THRESHOLD = 18;
const READY_THRESHOLD = 7;
const HISTORY_SIZE = 6;

const PATIENT_ID = "patient-001";
const CLINIC_USER_ID = "clinic-default";
const SCAN_COMPLETE_STORAGE_KEY = "dentalscan.scanComplete";

const GUARDRAIL_CONFIG: Record<
  GuardrailState,
  { color: string; label: string; helper: string }
> = {
  needs_centering: {
    color: "#f59e0b",
    label: "Center your mouth",
    helper: "Line up your smile inside the guide.",
  },
  hold_still: {
    color: "#ef4444",
    label: "Hold still",
    helper: "Keep your face steady for a clearer scan.",
  },
  ready: {
    color: "#22c55e",
    label: "Ready",
    helper: "Great position. Capture when ready.",
  },
};

const VIEWS = [
  {
    label: "Front View",
    instruction: "Smile and look straight at the camera.",
  },
  { label: "Left View", instruction: "Turn your head to the left." },
  { label: "Right View", instruction: "Turn your head to the right." },
  { label: "Upper Teeth", instruction: "Tilt your head back and open wide." },
  { label: "Lower Teeth", instruction: "Tilt your head down and open wide." },
];

function classifyGuardrail(score: number, sampleCount: number): GuardrailState {
  if (sampleCount < 2) return "needs_centering";
  if (score > HOLD_STILL_THRESHOLD) return "hold_still";
  if (score > READY_THRESHOLD) return "needs_centering";
  return "ready";
}

interface MouthGuideOverlayProps {
  guardrail: GuardrailState;
}

function MouthGuideOverlay({ guardrail }: MouthGuideOverlayProps) {
  const config = GUARDRAIL_CONFIG[guardrail];

  return (
    <div className="absolute inset-0 pointer-events-none" aria-hidden="true">
      <svg
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 100"
        preserveAspectRatio="xMidYMid meet"
      >
        <defs>
          <mask id="mouth-guide-vignette">
            <rect width="100" height="100" fill="white" />
            <ellipse cx="50" cy="52" rx="33" ry="25" fill="black" />
          </mask>
        </defs>

        <rect
          width="100"
          height="100"
          fill="rgba(0,0,0,0.55)"
          mask="url(#mouth-guide-vignette)"
        />

        <ellipse
          cx="50"
          cy="52"
          rx="33"
          ry="25"
          fill="none"
          stroke={config.color}
          strokeWidth="1"
          strokeDasharray="4 2"
          style={{ transition: "stroke 200ms ease" }}
        />
        <ellipse
          cx="50"
          cy="52"
          rx="28"
          ry="13"
          fill="none"
          stroke="rgba(255,255,255,0.24)"
          strokeWidth="0.6"
        />
        <path
          d="M35 51 Q50 43 65 51"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeLinecap="round"
          strokeWidth="0.7"
        />
        <path
          d="M35 58 Q50 66 65 58"
          fill="none"
          stroke="rgba(255,255,255,0.2)"
          strokeLinecap="round"
          strokeWidth="0.7"
        />

        {[
          "M18 38 L18 28 L31 28",
          "M82 38 L82 28 L69 28",
          "M18 66 L18 76 L31 76",
          "M82 66 L82 76 L69 76",
        ].map((d) => (
          <path
            key={d}
            d={d}
            fill="none"
            stroke="rgba(255,255,255,0.32)"
            strokeLinecap="round"
            strokeWidth="0.6"
          />
        ))}
      </svg>

      <div className="absolute left-0 right-0 top-4 flex justify-center px-4">
        <div className="flex max-w-[calc(100%-2rem)] items-center gap-2 rounded-lg border border-white/10 bg-black/65 px-3 py-2 backdrop-blur">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: config.color }}
          />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase leading-none tracking-wide text-white">
              {config.label}
            </p>
            <p className="mt-1 truncate text-[10px] text-zinc-300">
              {config.helper}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ScanningFlow() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const previousFrameRef = useRef<Uint8ClampedArray | null>(null);
  const scoreHistoryRef = useRef<number[]>([]);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastSampleRef = useRef(0);

  const [camReady, setCamReady] = useState(false);
  const [capturedImages, setCapturedImages] = useState<string[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [uploadStatus, setUploadStatus] = useState("Uploading results...");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [guardrail, setGuardrail] =
    useState<GuardrailState>("needs_centering");
  const [sessionReady, setSessionReady] = useState(false);

  const releaseCamera = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }

    previousFrameRef.current = null;
    scoreHistoryRef.current = [];

    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.pause();
      videoRef.current.srcObject = null;
      videoRef.current.removeAttribute("src");
      videoRef.current.load();
    }
  }, []);

  const stopCamera = useCallback(() => {
    setCamReady(false);
    releaseCamera();
  }, [releaseCamera]);

  useEffect(() => {
    if (window.sessionStorage.getItem(SCAN_COMPLETE_STORAGE_KEY) === "true") {
      setCurrentStep(VIEWS.length);
      setUploadStatus("Scan already completed in this tab.");
    }

    setSessionReady(true);
  }, []);

  useEffect(() => {
    if (!sessionReady) return;

    if (window.sessionStorage.getItem(SCAN_COMPLETE_STORAGE_KEY) === "true") {
      releaseCamera();
      return;
    }

    let cancelled = false;

    async function startCamera() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
            width: { ideal: 1280 },
            height: { ideal: 960 },
          },
        });

        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          setCamReady(true);
        }
      } catch (err) {
        console.error("Camera access denied", err);
      }
    }

    const canvas = document.createElement("canvas");
    canvas.width = SAMPLE_CANVAS_SIZE;
    canvas.height = SAMPLE_CANVAS_SIZE;
    sampleCanvasRef.current = canvas;

    startCamera();

    return () => {
      cancelled = true;
      releaseCamera();
    };
  }, [releaseCamera, sessionReady]);

  useEffect(() => {
    const handlePageExit = () => {
      releaseCamera();
    };

    window.addEventListener("pagehide", handlePageExit);
    window.addEventListener("beforeunload", handlePageExit);

    return () => {
      window.removeEventListener("pagehide", handlePageExit);
      window.removeEventListener("beforeunload", handlePageExit);
    };
  }, [releaseCamera]);

  useEffect(() => {
    if (!camReady) return;

    function tick(timestamp: number) {
      rafRef.current = requestAnimationFrame(tick);

      if (timestamp - lastSampleRef.current < SAMPLE_INTERVAL_MS) return;
      lastSampleRef.current = timestamp;

      const video = videoRef.current;
      const canvas = sampleCanvasRef.current;
      if (!video || !canvas || video.readyState < 2) return;

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;

      ctx.drawImage(video, 0, 0, SAMPLE_CANVAS_SIZE, SAMPLE_CANVAS_SIZE);
      const { data } = ctx.getImageData(
        0,
        0,
        SAMPLE_CANVAS_SIZE,
        SAMPLE_CANVAS_SIZE,
      );

      if (previousFrameRef.current) {
        let totalDiff = 0;
        for (let i = 0; i < data.length; i += 4) {
          const current =
            data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
          const previous =
            previousFrameRef.current[i] * 0.299 +
            previousFrameRef.current[i + 1] * 0.587 +
            previousFrameRef.current[i + 2] * 0.114;
          totalDiff += Math.abs(current - previous);
        }

        const score = totalDiff / (SAMPLE_CANVAS_SIZE * SAMPLE_CANVAS_SIZE);
        scoreHistoryRef.current.push(score);
        if (scoreHistoryRef.current.length > HISTORY_SIZE) {
          scoreHistoryRef.current.shift();
        }

        const smoothedScore =
          scoreHistoryRef.current.reduce((sum, item) => sum + item, 0) /
          scoreHistoryRef.current.length;

        setGuardrail((current) => {
          const next = classifyGuardrail(
            smoothedScore,
            scoreHistoryRef.current.length,
          );
          return current === next ? current : next;
        });
      }

      previousFrameRef.current = new Uint8ClampedArray(data);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [camReady]);

  const handleCapture = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;

    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg");
    const updatedImages = [...capturedImages, dataUrl];
    const nextStep = currentStep + 1;
    const isFinalCapture = nextStep === VIEWS.length;

    if (isFinalCapture) {
      window.sessionStorage.setItem(SCAN_COMPLETE_STORAGE_KEY, "true");
      stopCamera();
    }

    setCapturedImages(updatedImages);
    setCurrentStep(nextStep);

    if (!isFinalCapture) return;

    setUploadStatus("Uploading results...");

    try {
      const scanResponse = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          images: updatedImages,
          patientId: PATIENT_ID,
        }),
      });
      const scanData = await scanResponse.json();

      if (!scanResponse.ok || !scanData.success) {
        throw new Error(scanData.error ?? "Upload failed");
      }

      const scanId = scanData.scan?.id ?? scanData.scanId;
      const notifyResponse = await fetch("/api/notify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scanId,
          status: "completed",
          userId: CLINIC_USER_ID,
        }),
      });
      const notifyData = await notifyResponse.json();

      if (!notifyResponse.ok || !notifyData.ok) {
        throw new Error(notifyData.error ?? "Notification failed");
      }

      setUploadStatus("Upload successful. Your clinic has been notified.");
    } catch (err) {
      console.error("Upload error:", err);
      setUploadStatus("Upload failed. Please try again.");
    }
  }, [capturedImages, currentStep, stopCamera]);

  return (
    <div className="flex min-h-screen flex-col items-center bg-black text-white">
      <div className="flex w-full items-center justify-between border-b border-zinc-800 bg-zinc-900 p-4">
        <h1 className="font-bold tracking-wide text-blue-400">DentalScan AI</h1>
        <span className="text-xs text-zinc-500">
          Step {Math.min(currentStep + 1, VIEWS.length)} / {VIEWS.length}
        </span>
      </div>

      <div className="relative flex aspect-[3/4] w-full max-w-md items-center justify-center overflow-hidden bg-zinc-950">
        {currentStep < VIEWS.length ? (
          <>
            <video
              ref={videoRef}
              autoPlay
              playsInline
              muted
              className="absolute inset-0 h-full w-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />

            <MouthGuideOverlay guardrail={guardrail} />

            <div className="pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/90 via-black/60 to-transparent px-6 py-5 text-center">
              <p className="mb-1 text-[10px] uppercase tracking-[0.15em] text-zinc-400">
                {VIEWS[currentStep].label}
              </p>
              <p className="text-sm font-medium leading-snug text-white">
                {VIEWS[currentStep].instruction}
              </p>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-4 p-10 text-center">
            <CheckCircle2 size={48} className="text-green-500" />
            <h2 className="text-xl font-bold">Scan Complete</h2>
            <p className="text-sm text-zinc-400">{uploadStatus}</p>
            <button
              onClick={() => setSidebarOpen(true)}
              className="mt-2 flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              <MessageCircle size={16} />
              Message your clinic
            </button>
          </div>
        )}
      </div>

      <div className="flex w-full justify-center py-10">
        {currentStep < VIEWS.length && (
          <button
            onClick={handleCapture}
            aria-label="Capture image"
            className="flex h-20 w-20 items-center justify-center rounded-full border-4 border-white transition-transform active:scale-90"
          >
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white">
              <Camera className="text-black" size={24} />
            </div>
          </button>
        )}
      </div>

      <div className="flex w-full gap-2 overflow-x-auto px-4 pb-6">
        {VIEWS.map((view, index) => (
          <div
            key={view.label}
            className={`h-20 w-16 shrink-0 overflow-hidden rounded border-2 transition-colors ${
              index === currentStep
                ? "border-blue-500 bg-blue-500/10"
                : "border-zinc-800"
            }`}
          >
            {capturedImages[index] ? (
              <img
                src={capturedImages[index]}
                className="h-full w-full object-cover"
                alt={view.label}
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-[10px] text-zinc-700">
                {index + 1}
              </div>
            )}
          </div>
        ))}
      </div>

      <MessageSidebar
        patientId={PATIENT_ID}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
    </div>
  );
}
