import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import DesktopNav from "@/app/desktop-nav";
import AccountPanel from "@/app/account-panel";

vi.mock("next/navigation", () => ({
  usePathname: vi.fn(),
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));

beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockResolvedValue({ username: "jo", avatar_src: null });
});

function mount(pathname: string) {
  vi.mocked(usePathname).mockReturnValue(pathname);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <DesktopNav />
    </QueryClientProvider>,
  );
}

test.each(["/login", "/onboarding", "/add/invite", "/missing"])(
  "%s has no desktop navigation or profile request",
  (pathname) => {
    mount(pathname);
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(api).not.toHaveBeenCalled();
  },
);

test.each([
  ["/", "Home"],
  ["/log", "Log a drink"],
  ["/board", "Leaderboard"],
  ["/friends", "Friends"],
  ["/collection", "My collection"],
  ["/recap", "Weekly recap"],
  ["/u/jo", "@jo"],
])("%s marks the current destination", async (pathname, label) => {
  mount(pathname);
  await screen.findByRole("link", { name: "@jo" });
  expect(screen.getByRole("link", { name: label }).getAttribute("aria-current")).toBe("page");
  expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
});

test.each(["/u/friend", "/nights/night-id"])(
  "%s retains navigation and links to the viewer's own profile",
  async (pathname) => {
    mount(pathname);
    const profile = await screen.findByRole("link", { name: "@jo" });
    expect(profile.getAttribute("href")).toBe("/u/jo");
    expect(document.querySelector('[aria-current="page"]')).toBeNull();
    expect(screen.getByRole("navigation", { name: "Main navigation" })).toBeDefined();
  },
);

test("navigation remains usable when there is no profile yet", async () => {
  vi.mocked(api).mockResolvedValue(null);
  mount("/log");
  expect(await screen.findByRole("link", { name: "Log a drink" })).toBeDefined();
  expect(screen.queryByText("@jo")).toBeNull();
});


test("saving a username refreshes the persistent profile link", async () => {
  let username = "before";
  vi.mocked(api).mockImplementation(async (_path, init) => {
    if (init?.method === "PATCH") username = "after";
    return { username, avatar_src: null };
  });
  vi.mocked(usePathname).mockReturnValue("/u/before");
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <DesktopNav />
      <AccountPanel
        username="before"
        userCode="abc"
        timezone="America/Los_Angeles"
        email="jo@example.test"
        avatarUrl={null}
        leaderboardOptIn
      />
    </QueryClientProvider>,
  );
  await screen.findByRole("link", { name: "@before" });
  fireEvent.change(screen.getByLabelText("Username"), { target: { value: "after" } });
  fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
  const profile = await screen.findByRole("link", { name: "@after" });
  expect(profile.getAttribute("href")).toBe("/u/after");
  expect(screen.queryByRole("link", { name: "@before" })).toBeNull();
});
