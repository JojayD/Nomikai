"use client";

import { useEffect, useRef, useState } from "react";

export default function CameraDialog({
  onPhoto,
  onClose,
}: {
  onPhoto: (file: File) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const active = useRef(true);
  const encoding = useRef(false);
  const [ready, setReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const modal = dialog.current!;
    const overflow = document.body.style.overflow;
    let cancelled = false;
    active.current = true;
    modal.showModal();
    document.body.style.overflow = "hidden";
    const ended = () => {
      setReady(false);
      setError(
        "Camera disconnected — close this window and try again or pick a file.",
      );
    };
    async function open() {
      try {
        const media = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (cancelled || !active.current) {
          media.getTracks().forEach((track) => track.stop());
          return;
        }
        stream.current = media;
        media
          .getTracks()
          .forEach((track) => track.addEventListener("ended", ended));
        if (video.current) video.current.srcObject = media;
      } catch {
        if (!cancelled && active.current)
          setError(
            "Camera unavailable — allow camera access or pick a file instead.",
          );
      }
    }
    void open();
    return () => {
      cancelled = true;
      active.current = false;
      stream.current?.getTracks().forEach((track) => {
        track.removeEventListener("ended", ended);
        track.stop();
      });
      stream.current = null;
      modal.close();
      document.body.style.overflow = overflow;
    };
  }, []);

  function close() {
    // Invalidate pending encodes immediately, before React unmounts the dialog.
    active.current = false;
    stream.current?.getTracks().forEach((track) => track.stop());
    onClose();
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
      context.drawImage(v, 0, 0);
      canvas.toBlob(
        (blob) => {
          if (!active.current) return;
          if (!blob) {
            failed();
            return;
          }
          onPhoto(new File([blob], "camera.jpg", { type: "image/jpeg" }));
          close();
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
      className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-[430px] overflow-y-auto border border-[var(--color-divider)] bg-[var(--color-bg)] p-4 text-[var(--color-text)] backdrop:bg-black/70"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id="camera-title" className="text-xl">
        Take photo
      </h2>
      <video
        ref={video}
        className="mt-3 max-h-[60dvh] w-full bg-black object-contain"
        autoPlay
        playsInline
        muted
        onLoadedData={() => setReady(true)}
        onError={() => {
          setReady(false);
          setError("Could not start camera preview — pick a file instead.");
        }}
      />
      {!ready && !error && (
        <p role="status" className="mt-3 text-sm">
          Starting camera… Allow camera access if prompted.
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 text-sm font-semibold text-[var(--color-accent)]"
        >
          {error}
        </p>
      )}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn btn-primary flex-1"
          disabled={!ready || capturing}
          onClick={capture}
        >
          {capturing ? "Capturing…" : "Capture"}
        </button>
        <button
          type="button"
          className="btn btn-secondary flex-1"
          onClick={close}
        >
          Cancel
        </button>
      </div>
    </dialog>
  );
}
