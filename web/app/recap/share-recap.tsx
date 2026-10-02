"use client";

import { useMutation } from "@tanstack/react-query";

/** Native share sheet with the server-rendered card; falls back to opening the image. */
export default function ShareRecap() {
  const share = useMutation({
    mutationFn: async () => {
      const blob = await (await fetch("/recap/image")).blob();
      const file = new File([blob], "nomikai-recap.png", {
        type: blob.type || "image/png",
      });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "My Nomikai week" });
      } else {
        window.open("/recap/image", "_blank");
      }
    },
  });
  return (
    <button
      className="btn btn-primary btn-block mt-5"
      disabled={share.isPending}
      onClick={() => share.mutate()}
    >
      {share.isPending ? "Preparing…" : "Share this week's card"}
    </button>
  );
}
