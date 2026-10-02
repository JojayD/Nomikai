import { ImageResponse } from "next/og";
import { apiServer } from "@/lib/api-server";
import { type Recap, weekLabel } from "@/lib/recap";

export const dynamic = "force-dynamic";

/**
 * F8: the shareable card, rendered server-side from the viewer's current-week
 * recap. Satori supports flexbox only, hence the display:flex everywhere.
 */
export async function GET() {
  const recap = await apiServer<Recap>("/recap");
  if (!recap?.username) return new Response("Sign in required", { status: 401 });

  const stats: [number, string][] = [
    [recap.nights_out, "nights out"],
    [recap.unique_drinks, "unique drinks"],
    [recap.total_entries, "drinks logged"],
  ];

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#faf7f2",
          color: "#181511",
          padding: 72,
          fontFamily: "sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
            borderBottom: "6px solid #181511",
            paddingBottom: 28,
          }}
        >
          <div style={{ fontSize: 54, fontWeight: 800, letterSpacing: -2 }}>
            NOMIKAI
          </div>
          <div style={{ fontSize: 32, opacity: 0.7 }}>
            week of {weekLabel(recap)}
          </div>
        </div>

        <div style={{ display: "flex", fontSize: 40, marginTop: 44 }}>
          @{recap.username}
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 24 }}>
          {stats.map(([n, label]) => (
            <div
              key={label}
              style={{
                display: "flex",
                alignItems: "baseline",
                gap: 24,
                borderBottom: "2px solid #d8d2c7",
                padding: "20px 0",
              }}
            >
              <div style={{ fontSize: 96, fontWeight: 800, letterSpacing: -4 }}>
                {n}
              </div>
              <div style={{ fontSize: 40, opacity: 0.75 }}>{label}</div>
            </div>
          ))}
        </div>

        <div style={{ display: "flex", marginTop: "auto", fontSize: 34 }}>
          {recap.most_reacted
            ? `most loved: ${recap.most_reacted.drink_name} · ${recap.most_reacted.reactions} ♥`
            : "ranking variety, not volume"}
        </div>
      </div>
    ),
    { width: 1080, height: 1080 }
  );
}
