"use client";

// Real, working camera capture. Props-only: every dependency is React/DOM — no Convex,
// no app state, no monolith imports. The owner's rule is "no maqueta": this actually opens
// the device camera, draws a live preview, captures a real frame to a canvas and hands the
// caller a real JPEG File. When the camera is unavailable (no getUserMedia, permission denied,
// http, or no hardware) it degrades to a real <input type=file capture=environment> so the
// user can still take/pick a photo. Nothing here is decorative.

import { Camera, RotateCcw, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useT } from "@/lib/i18n";

type Phase = "starting" | "live" | "captured" | "fallback";

export function CameraCapture({ onCapture, onCancel }: { onCapture: (file: File) => void; onCancel?: () => void }) {
  const { t } = useT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const previewUrlRef = useRef<string | null>(null);

  const [phase, setPhase] = useState<Phase>("starting");
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [capturedBlob, setCapturedBlob] = useState<Blob | null>(null);

  // Stop and release every track so the camera LED turns off when we leave.
  const stopStream = useCallback(() => {
    const stream = streamRef.current;
    if (stream) {
      stream.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  }, []);

  const revokePreview = useCallback(() => {
    if (previewUrlRef.current) {
      URL.revokeObjectURL(previewUrlRef.current);
      previewUrlRef.current = null;
    }
  }, []);

  // Opens the device camera and drives phase/error from the RESOLVED getUserMedia promise.
  // It deliberately does NOT setState synchronously at the top: the initial render is already
  // "starting", and on retake the caller resets state first. The first await boundary below means
  // every setState here runs as a reaction to the external camera system, not as a cascading render
  // inside the mount effect (satisfies react-hooks/set-state-in-effect).
  const startCamera = useCallback(async () => {
    const hasGetUserMedia = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
    if (!hasGetUserMedia) {
      // Yield once so this setState is not synchronous within the mount effect body.
      await Promise.resolve();
      setPhase("fallback");
      setError(
        t(
          "Tu navegador o conexión no permite la cámara en vivo. Usa una foto desde tu galería o cámara.",
          "Your browser or connection doesn't support the live camera. Take or pick a photo from your gallery instead.",
        ),
      );
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        // play() can reject if the element unmounts mid-await; ignore that race.
        try {
          await video.play();
        } catch {
          /* autoplay race on unmount; harmless */
        }
      }
      setPhase("live");
    } catch (err) {
      stopStream();
      setPhase("fallback");
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setError(
          t(
            "No diste permiso para la cámara. Puedes tomar o subir una foto del recibo.",
            "Camera access wasn't granted. You can still take or upload a photo of the receipt.",
          ),
        );
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        setError(
          t(
            "No se encontró una cámara disponible. Sube una foto del recibo.",
            "No camera was found. Upload a photo of the receipt instead.",
          ),
        );
      } else {
        setError(
          t(
            "No se pudo abrir la cámara. Sube una foto del recibo.",
            "Couldn't open the camera. Upload a photo of the receipt instead.",
          ),
        );
      }
    }
  }, [stopStream]);

  useEffect(() => {
    // Legitimate external-system synchronization (same pattern as convex-sync.tsx): on mount we
    // open the device camera and drive phase/error from the resolved getUserMedia promise. The
    // setState calls inside startCamera happen after an await (a reaction to the camera system),
    // not as a cascading synchronous render — the lint rule can't see across the async boundary.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void startCamera();
    return () => {
      stopStream();
      revokePreview();
    };
    // startCamera/stopStream/revokePreview are stable (useCallback); run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function capture() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
      setError(
        t("La cámara aún no está lista. Inténtalo de nuevo en un segundo.", "The camera isn't ready yet. Try again in a second."),
      );
      return;
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setError(
        t("No se pudo capturar el cuadro. Sube una foto del recibo.", "Couldn't capture the frame. Upload a photo of the receipt instead."),
      );
      return;
    }
    ctx.drawImage(video, 0, 0, width, height);
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          setError(t("No se pudo generar la imagen. Inténtalo de nuevo.", "Couldn't generate the image. Please try again."));
          return;
        }
        revokePreview();
        const url = URL.createObjectURL(blob);
        previewUrlRef.current = url;
        setPreviewUrl(url);
        setCapturedBlob(blob);
        setPhase("captured");
        // Freeze the camera once we have the shot; we restart it if the user retakes.
        stopStream();
      },
      "image/jpeg",
      0.85,
    );
  }

  function confirmCapture() {
    if (!capturedBlob) return;
    const file = new File([capturedBlob], `recibo-${Date.now()}.jpg`, { type: "image/jpeg" });
    onCapture(file);
  }

  function retake() {
    revokePreview();
    setPreviewUrl(null);
    setCapturedBlob(null);
    // User event (not an effect): safe to reset synchronously before re-opening the camera.
    setError(null);
    setPhase("starting");
    void startCamera();
  }

  function handleFallbackFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onCapture(file);
  }

  return (
    <div className="grid gap-4">
      <canvas ref={canvasRef} className="hidden" />

      <div className="relative overflow-hidden rounded-3xl border border-[rgba(80,102,0,0.16)] bg-black/90 shadow-[0_22px_48px_-32px_rgba(18,20,20,0.5)]">
        {phase !== "fallback" && (
          <>
            {/* Hidden while showing the captured still, but kept mounted so the ref survives a retake. */}
            <video
              ref={videoRef}
              playsInline
              muted
              className={`aspect-[3/4] w-full bg-black object-cover sm:aspect-video ${phase === "captured" ? "hidden" : ""}`}
            />
            {phase === "captured" && previewUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt={t("Recibo capturado", "Captured receipt")} className="aspect-[3/4] w-full bg-black object-contain sm:aspect-video" />
            )}
            {phase === "starting" && (
              <div className="absolute inset-0 grid place-items-center text-sm font-semibold text-white/80">
                {t("Abriendo cámara…", "Opening camera…")}
              </div>
            )}
            {/* Framing guide so the user knows to fill the frame with the receipt. */}
            {phase === "live" && (
              <div className="pointer-events-none absolute inset-5 rounded-2xl border-2 border-dashed border-[var(--lime)]/70" />
            )}
          </>
        )}

        {phase === "fallback" && (
          <div className="grid place-items-center gap-4 px-6 py-12 text-center">
            <div className="grid h-14 w-14 place-items-center rounded-full bg-white/10 text-white">
              <Camera className="h-6 w-6" />
            </div>
            <p className="max-w-sm text-sm leading-relaxed text-white/85">{error ?? t("Toma o sube una foto del recibo.", "Take or upload a photo of the receipt.")}</p>
            <label className="cursor-pointer rounded-2xl bg-[var(--lime)] px-6 py-3 text-sm font-bold text-black transition hover:-translate-y-0.5">
              {t("Tomar o subir foto", "Take or upload photo")}
              <input className="hidden" type="file" accept="image/*" capture="environment" onChange={handleFallbackFile} />
            </label>
          </div>
        )}
      </div>

      {phase !== "fallback" && error && (
        <p className="rounded-2xl border border-[rgba(186,26,26,0.3)] bg-[rgba(186,26,26,0.06)] px-4 py-3 text-sm text-[var(--danger)]">{error}</p>
      )}

      <div className="flex flex-wrap items-center justify-center gap-3">
        {phase === "live" && (
          <button
            className="inline-flex items-center gap-2 rounded-2xl bg-[var(--lime)] px-7 py-3.5 text-base font-bold text-black shadow-lg shadow-lime-300/30 transition hover:-translate-y-0.5"
            onClick={capture}
            type="button"
          >
            <Camera className="h-5 w-5" /> {t("Capturar", "Capture")}
          </button>
        )}
        {phase === "captured" && (
          <>
            <button
              className="inline-flex items-center gap-2 rounded-2xl bg-[var(--lime)] px-7 py-3.5 text-base font-bold text-black shadow-lg shadow-lime-300/30 transition hover:-translate-y-0.5"
              onClick={confirmCapture}
              type="button"
            >
              {t("Usar esta foto", "Use this photo")}
            </button>
            <button
              className="inline-flex items-center gap-2 rounded-2xl border divider-strong bg-white px-6 py-3.5 text-base font-bold text-[var(--primary)] transition hover:-translate-y-0.5"
              onClick={retake}
              type="button"
            >
              <RotateCcw className="h-4 w-4" /> {t("Repetir", "Retake")}
            </button>
          </>
        )}
        {onCancel && (
          <button
            className="inline-flex items-center gap-2 rounded-2xl border divider-strong bg-white/70 px-6 py-3.5 text-base font-semibold text-[var(--text-muted)] transition hover:bg-white"
            onClick={() => {
              stopStream();
              onCancel();
            }}
            type="button"
          >
            <X className="h-4 w-4" /> {t("Cancelar", "Cancel")}
          </button>
        )}
      </div>
    </div>
  );
}
