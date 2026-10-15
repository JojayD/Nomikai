import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import ProfileView, { type Profile } from "@/app/u/[username]/profile-view";
import { ApiError, api } from "@/lib/api";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));

const profile: Profile = {
  id: "owner",
  username: "jo",
  avatar_url: null,
  avatar_src: null,
  user_code: "CODE",
  timezone: "America/Los_Angeles",
};
const row = {
  id: "entry-1",
  user_id: "owner",
  username: "jo",
  avatar_url: null,
  drink_name: "Yuzu Fizz",
  night_out_id: null,
  night_out_name: null,
  location: "Bar One",
  photo_path: null,
  note: null,
  recommended: true,
  logged_at: "2026-10-01T00:00:00Z",
  reaction_count: 0,
  reacted_by_me: false,
};

beforeEach(() => vi.mocked(api).mockReset());

function mount(viewerId = "owner", existingClient?: QueryClient) {
  const client = existingClient ?? new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ProfileView profile={profile} viewerId={viewerId} email={null} leaderboardOptIn />
    </QueryClientProvider>,
  );
  return { client, ...view };
}

test("searches all profile pages with trimmed Unicode text and recommended filter", async () => {
  const firstPage = Array.from({ length: 30 }, (_, i) => ({ ...row, id: `entry-${i}` }));
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) return path.includes("offset=30") ? [row] : firstPage;
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 31, unique_drinks: 1, nights_out: 0 };
    return [];
  });
  mount();
  await screen.findByRole("button", { name: "Load more" });
  fireEvent.change(screen.getByRole("searchbox", { name: "Search drink history" }), {
    target: { value: `  ${"🍵".repeat(120)}  ` },
  });
  fireEvent.click(screen.getByRole("checkbox", { name: "Recommended only" }));
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => {
    const urls = vi.mocked(api).mock.calls.map(([path]) => path);
    expect(urls.some((path) => typeof path === "string" && path.startsWith("/entries?") &&
      new URLSearchParams(path.split("?")[1]).get("q") === "🍵".repeat(120) &&
      path.includes("recommended=true") && path.includes("offset=0"))).toBe(true);
  });
  expect(vi.mocked(api).mock.calls.some(([path, init]) =>
    typeof path === "string" && path.startsWith("/entries?") && init?.signal instanceof AbortSignal)).toBe(true);
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await waitFor(() => expect(vi.mocked(api).mock.calls.some(([path]) =>
    typeof path === "string" && path.startsWith("/entries?") && path.includes("offset=30") && path.includes("recommended=true"))).toBe(true));
});

test("rejects search longer than 120 Unicode characters without silently changing its meaning", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) return [row];
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 1, unique_drinks: 1, nights_out: 0 };
    return [];
  });
  mount();
  await screen.findByText("Yuzu Fizz");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search drink history" }), {
    target: { value: "🍵".repeat(121) },
  });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(screen.getByRole("alert").textContent).toMatch(/120 characters/i);
  expect(vi.mocked(api).mock.calls.filter(([path]) =>
    typeof path === "string" && path.startsWith("/entries?"))).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect((screen.getByRole("searchbox", { name: "Search drink history" }) as HTMLInputElement).value).toBe("");
});

test("a new search removes old cards while loading, distinguishes no match, and clears filters", async () => {
  let finish!: (rows: typeof row[]) => void;
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) {
      if (path.includes("q=missing")) return new Promise<typeof row[]>((resolve) => { finish = resolve; });
      return [row];
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 1, unique_drinks: 1, nights_out: 0 };
    return [];
  });
  mount();
  await screen.findByText("Yuzu Fizz");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search drink history" }), { target: { value: "missing" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(screen.queryByText("Yuzu Fizz")).toBeNull();
  expect(screen.getByRole("status").textContent).toMatch(/loading/i);
  await act(async () => finish([]));
  expect(await screen.findByText("No drinks match these filters.")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(await screen.findByText("Yuzu Fizz")).toBeDefined();
  expect((screen.getByRole("searchbox", { name: "Search drink history" }) as HTMLInputElement).value).toBe("");
});

test("a late response from an earlier search cannot replace the newer results", async () => {
  let finishSlow!: (rows: typeof row[]) => void;
  let slowSignal: AbortSignal | null | undefined;
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (typeof path === "string" && path.startsWith("/entries?")) {
      const q = new URLSearchParams(path.split("?")[1]).get("q");
      if (q === "slow") {
        slowSignal = init?.signal;
        return new Promise<typeof row[]>((resolve) => { finishSlow = resolve; });
      }
      return q === "fast" ? [{ ...row, id: "fast", drink_name: "Fast Drink" }] : [];
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 1, unique_drinks: 1, nights_out: 0 };
    return [];
  });
  mount();
  await screen.findByText("No drinks logged yet.");
  const search = screen.getByRole("searchbox", { name: "Search drink history" });
  fireEvent.change(search, { target: { value: "slow" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await waitFor(() => expect(finishSlow).toBeDefined());
  fireEvent.change(search, { target: { value: "fast" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Fast Drink");
  expect(slowSignal?.aborted).toBe(true);
  await act(async () => finishSlow([{ ...row, id: "slow", drink_name: "Slow Drink" }]));
  expect(screen.getByText("Fast Drink")).toBeDefined();
  expect(screen.queryByText("Slow Drink")).toBeNull();
});

test("failed refresh keeps same-filter cards with an explicit stale warning and retries", async () => {
  let failRefresh = false;
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) {
      if (failRefresh) throw new Error("offline");
      return [row];
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 1, unique_drinks: 1, nights_out: 0 };
    return [];
  });
  const { client } = mount();
  await screen.findByText("Yuzu Fizz");
  failRefresh = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ["entries"] }); });
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/showing saved results/i));
  expect(screen.getByText("Yuzu Fizz")).toBeDefined();
  failRefresh = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
});

test("initial network failure offers a retry without showing an empty-history message", async () => {
  let attempts = 0;
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) {
      if (++attempts === 1) throw new Error("offline");
      return [row];
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 1, unique_drinks: 1, nights_out: 0 };
    return [];
  });
  mount();
  await screen.findByRole("button", { name: "Retry" });
  expect(screen.queryByText("No drinks logged yet.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Yuzu Fizz")).toBeDefined();
});

test("failed next page keeps earlier cards and retries that page", async () => {
  const firstPage = Array.from({ length: 30 }, (_, i) => ({ ...row, id: `entry-${i}` }));
  let nextFails = true;
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) {
      if (path.includes("offset=30")) {
        if (nextFails) throw new Error("offline");
        return [{ ...row, id: "last-entry", drink_name: "Last Drink" }];
      }
      return firstPage;
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 31, unique_drinks: 2, nights_out: 0 };
    return [];
  });
  mount();
  fireEvent.click(await screen.findByRole("button", { name: "Load more" }));
  await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/could not load more/i));
  expect(screen.getAllByRole("link", { name: "Edit" })).toHaveLength(30);
  nextFails = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(await screen.findByText("Last Drink")).toBeDefined();
  expect(screen.getAllByRole("link", { name: "Edit" })).toHaveLength(31);
});

test("friend access loss hides cached history after a 403", async () => {
  let denied = false;
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/friendships/with/")) return { id: "friendship", requester_id: "viewer", status: "accepted" };
    if (path === "/blocks") return [];
    if (typeof path === "string" && path.startsWith("/entries?")) {
      if (denied) throw new ApiError("Forbidden", 403);
      return [row];
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 1, unique_drinks: 1, nights_out: 0 };
    return [];
  });
  const { client } = mount("viewer");
  await screen.findByText("Yuzu Fizz");
  denied = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ["entries"] }); });
  await waitFor(() => expect(screen.queryByText("Yuzu Fizz")).toBeNull());
  expect(screen.getByRole("alert").textContent).toMatch(/no longer have access/i);
  expect(screen.getByRole("link", { name: "View friends" }).getAttribute("href")).toBe("/friends");
});

test("401 hides cached cards and directs the viewer to sign in", async () => {
  let expired = false;
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) {
      if (expired) throw new ApiError("Unauthorized", 401);
      return [row];
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 1, unique_drinks: 1, nights_out: 0 };
    return [];
  });
  const { client } = mount();
  await screen.findByText("Yuzu Fizz");
  expired = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ["entries"] }); });
  await waitFor(() => expect(screen.queryByText("Yuzu Fizz")).toBeNull());
  expect(screen.getByRole("alert").textContent).toMatch(/session expired/i);
  expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
});

test("denial on one filter conceals another cached filter until fresh access succeeds", async () => {
  let denied = false;
  let holdCachedFilter = false;
  let finishCachedFilter!: (rows: typeof row[]) => void;
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) {
      const q = new URLSearchParams(path.split("?")[1]).get("q");
      if (denied && q === "B") throw new ApiError("Forbidden", 403);
      if (holdCachedFilter && q === "A") return new Promise<typeof row[]>((resolve) => { finishCachedFilter = resolve; });
      return q ? [{ ...row, id: q, drink_name: `Drink ${q}` }] : [];
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 2, unique_drinks: 2, nights_out: 0 };
    return [];
  });
  const { client } = mount();
  await screen.findByText("No drinks logged yet.");
  const search = screen.getByRole("searchbox", { name: "Search drink history" });
  fireEvent.change(search, { target: { value: "A" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Drink A");
  fireEvent.change(search, { target: { value: "B" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Drink B");
  denied = true;
  holdCachedFilter = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ["entries"] }); });
  await waitFor(() => expect(screen.queryByText("Drink B")).toBeNull());
  fireEvent.change(search, { target: { value: "A" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  expect(screen.queryByText("Drink A")).toBeNull();
  await waitFor(() => expect(finishCachedFilter).toBeDefined());
  holdCachedFilter = false;
  denied = false;
  await act(async () => finishCachedFilter([{ ...row, id: "A", drink_name: "Drink A" }]));
  expect(screen.queryByText("Drink A")).toBeNull();
  await waitFor(() => expect((screen.getByRole("button", { name: "Retry access" }) as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: "Retry access" }));
  await waitFor(() => expect(vi.mocked(api).mock.calls.filter(([path]) => typeof path === "string" && path.includes("q=A")).length).toBe(3));
  expect(await screen.findByText("Drink A")).toBeDefined();
});

test("remount after denial cannot show older cached results while access is rechecked", async () => {
  let denied = false;
  let holdDefault = false;
  let finishDefault!: (rows: typeof row[]) => void;
  vi.mocked(api).mockImplementation(async (path) => {
    if (typeof path === "string" && path.startsWith("/entries?")) {
      const q = new URLSearchParams(path.split("?")[1]).get("q");
      if (denied && q === "B") throw new ApiError("Forbidden", 403);
      if (holdDefault && !q) return new Promise<typeof row[]>((resolve) => { finishDefault = resolve; });
      return q === "B" ? [{ ...row, id: "B", drink_name: "Drink B" }] : [row];
    }
    if (typeof path === "string" && path.startsWith("/profiles/")) return { total_entries: 2, unique_drinks: 2, nights_out: 0 };
    return [];
  });
  const { client, unmount } = mount();
  await screen.findByText("Yuzu Fizz");
  fireEvent.change(screen.getByRole("searchbox", { name: "Search drink history" }), { target: { value: "B" } });
  fireEvent.click(screen.getByRole("button", { name: "Search" }));
  await screen.findByText("Drink B");
  denied = true;
  await act(async () => { await client.invalidateQueries({ queryKey: ["entries"] }); });
  await waitFor(() => expect(screen.queryByText("Drink B")).toBeNull());
  unmount();
  holdDefault = true;
  mount("owner", client);
  expect(screen.queryByText("Yuzu Fizz")).toBeNull();
  await waitFor(() => expect(finishDefault).toBeDefined());
  holdDefault = false;
  denied = false;
  await act(async () => finishDefault([row]));
  expect(await screen.findByText("Yuzu Fizz")).toBeDefined();
});
