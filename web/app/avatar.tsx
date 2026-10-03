// Square avatar at a fixed Tailwind size; a user without one gets their
// initial in the same box so lists stay aligned. Classes are listed in full
// because Tailwind only emits literal class names.
const SIZES = {
  5: "h-5 w-5 text-[10px]",
  7: "h-7 w-7 text-xs",
  14: "h-14 w-14 text-2xl",
} as const;

export default function Avatar({
  src,
  username,
  size,
}: {
  src: string | null | undefined; // signed URL from the API
  username: string;
  size: keyof typeof SIZES;
}) {
  const box = `${SIZES[size]} shrink-0 object-cover`;
  if (src) {
    // eslint-disable-next-line @next/next/no-img-element -- signed URL, remote patterns don't apply
    return <img src={src} alt="" className={box} />;
  }
  return (
    <span
      aria-hidden="true"
      className={`${box} inline-flex items-center justify-center bg-[var(--color-divider)] font-extrabold uppercase`}
    >
      {username[0]}
    </span>
  );
}
