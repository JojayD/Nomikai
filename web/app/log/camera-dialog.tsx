"use client";

import { useEffect, useRef, useState } from "react";
import { photoProblem } from "@/lib/photo";

export default function CameraDialog({
  onPhoto,
  onClose,
}: {
  onPhoto: (file: File) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const library = useRef<HTMLInputElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const active = useRef(true);
  const encoding = useRef(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facing, setFacing] = useState<"environment" | "user">("environment");
  const [mirrored, setMirrored] = useState(false);
  const [photo, setPhoto] = useState<{ file: File; url: string } | null>(null);

  useEffect(() => {
    const modal = dialog.current!;
    const overflow = document.body.style.overflow;
    active.current = true;
    modal.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      active.current = false;
      modal.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  useEffect(() => {
    if (photo) return;
    let cancelled = false;
    let media: MediaStream | null = null;
    const ended = () => {
      setReady(false);
      setError("Camera disconnected. Try flipping the camera or choose a photo.");
    };
    async function open() {
      try {
        media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing },
          audio: false,
        });
        if (cancelled || !active.current) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        media.getTracks().forEach((track) => track.addEventListener("ended", ended));
        setMirrored(media.getVideoTracks?.()[0]?.getSettings?.().facingMode === "user");
        if (video.current) video.current.srcObject = media;
      } catch {
        if (!cancelled && active.current)
          setError("Camera unavailable. Allow camera access or choose a photo from your library.");
      }
    }
    void open();
    return () => {
      cancelled = true;
      media?.getTracks().forEach((track) => {
        track.removeEventListener("ended", ended);
        track.stop();
      });
      stream.current = null;
    };
  }, [facing, photo]);

  useEffect(() => () => {
    if (photo) URL.revokeObjectURL(photo.url);
  }, [photo]);

  function close() {
    // Invalidate pending encodes immediately, before React unmounts the dialog.
    active.current = false;
    stream.current?.getTracks().forEach((track) => track.stop());
    onClose();
  }

  function review(file: File) {
    setPhoto({ file, url: URL.createObjectURL(file) });
    setReady(false);
    setError(null);
    encoding.current = false;
    setCapturing(false);
  }

  function capture() {
    const v = video.current;
    if (!active.current || encoding.current) return;
    if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) {
      setError("Camera is still starting — try again.");
      return;
    }
    encoding.current = true;
    setCapturing(true);
    setError(null);
    function failed() {
      encoding.current = false;
      setCapturing(false);
      setError("Could not capture photo — try again.");
    }
    try {
      const canvas = document.createElement("canvas");
      canvas.width = v.videoWidth;
      canvas.height = v.videoHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        failed();
        return;
      }
      // Keep a front-camera photo consistent with its mirrored preview.
      if (mirrored) {
        context.translate(canvas.width, 0);
        context.scale(-1, 1);
      }
      context.drawImage(v, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!active.current) return;
          if (!blob) {
            failed();
            return;
          }
          review(new File([blob], "camera.jpg", { type: "image/jpeg" }));
        },
        "image/jpeg",
        0.9,
      );
    } catch {
      failed();
    }
  }

  return (
    <dialog
      ref={dialog}
      aria-labelledby="camera-title"
      className="camera-dialog"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="camera-layout">
        <header className="camera-header">
          <button type="button" className="camera-icon" aria-label="Cancel" onClick={close}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
          <h2 id="camera-title">{photo ? "Your photo" : "Take photo"}</h2>
          <span className="w-11" aria-hidden="true" />
        </header>
        <div className="camera-viewfinder">
          {photo ? (
            // eslint-disable-next-line @next/next/no-img-element -- local object URL
            <img src={photo.url} alt="Photo preview" className="camera-image" />
          ) : (
            <video
              key={facing}
              ref={video}
              className={`camera-image ${mirrored ? "-scale-x-100" : ""}`}
              autoPlay playsInline muted
              onLoadedData={() => setReady(true)}
              onError={() => {
                setReady(false);
                setError("Could not start camera preview. Choose a photo from your library.");
              }}
            />
          )}
          {!photo && (!ready || error) && (
            <div className="camera-message">
              <p role={error ? "alert" : "status"}>
                {error ?? "Starting camera… Allow camera access if prompted."}
              </p>
            </div>
          )}
        </div>
        <footer className="camera-footer">
          <p className="camera-hint" aria-live="polite">{photo ? "Looks good? Add it to your drink." : capturing ? "Capturing…" : "A little snapshot of the night."}</p>
          {photo ? (
            <div key="review" className="camera-review-actions">
              <button type="button" className="camera-retake" onClick={() => { setError(null); setPhoto(null); }}>Retake</button>
              <button type="button" className="camera-use" autoFocus onClick={() => { onPhoto(photo.file); close(); }}>Use photo</button>
            </div>
          ) : (
            <div key="capture" className="camera-controls">
              <button type="button" className="camera-side" disabled={capturing} onClick={() => library.current?.click()}>
                <span className="camera-icon"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><circle cx="8" cy="8" r="1.5" /><path d="m3 17 5-5 4 4 4-6 5 7" /></svg></span>
                Library
              </button>
              <button type="button" className="camera-shutter" aria-label="Capture" disabled={!ready || capturing} onClick={capture}><span /></button>
              <button type="button" className="camera-side" aria-label="Flip camera" disabled={capturing} onClick={() => { setReady(false); setError(null); setFacing(facing === "environment" ? "user" : "environment"); }}>
                <span className="camera-icon"><svg width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 7h-5V2M4 17h5v5M20 7a9 9 0 0 0-15-2M4 17a9 9 0 0 0 15 2" /></svg></span>
                Flip
              </button>
            </div>
          )}
        </footer>
        <input ref={library} type="file" accept="image/*" className="hidden" aria-label="Choose photo from library" onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          const problem = photoProblem(file);
          if (problem) { setError(problem); return; }
          review(file);
        }} />
      </div>
    </dialog>
  );
}
