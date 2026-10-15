import Link from "next/link";

export default function Header({
  kicker,
  right,
}: {
  kicker?: string;
  right?: React.ReactNode;
}) {
  return (
    <div
      className="page-header flex flex-wrap items-baseline gap-2.5 border-b-2 px-4 pt-3.5 pb-3"
      style={{ borderColor: "var(--color-divider)" }}
    >
      <h1 className="mr-auto text-[20px] tracking-[-0.02em]">
        <Link href="/" className="!text-[inherit] no-underline">
          NOMIKAI
        </Link>
      </h1>
      {right ?? <span className="kicker">{kicker}</span>}
    </div>
  );
}
