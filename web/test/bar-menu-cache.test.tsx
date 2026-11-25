import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import BarPicker from "@/app/log/bar-picker";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api, json: (body: unknown) => ({ body }) }));

const bar = { id: "node/1", name: "Test Bar", city: null, address: null };
const menu = { status: "ready", items: [{ name: "House Mule" }], sourceUrls: ["https://example.com"] };

// A fresh QueryClient each time stands in for reopening the app.
async function pickBar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["bars", "test"], [bar]);
  render(
    <QueryClientProvider client={client}>
      <BarPicker value="test" onChange={() => {}} onPickDrink={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.focus(screen.getByLabelText(/Where/));
  fireEvent.click(await screen.findByRole("button", { name: /Test Bar/ }));
  await screen.findByRole("button", { name: "House Mule" });
  cleanup();
}

beforeEach(() => {
  // Node's own localStorage global is unusable here, so stand one in.
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  });
  api.mockReset().mockResolvedValue(menu);
});

test("a menu this device has loaded is reused without a request", async () => {
  await pickBar();
  await pickBar();
  expect(api).toHaveBeenCalledTimes(1);
});

test("a saved menu older than a day is fetched again", async () => {
  await pickBar();
  const saved = JSON.parse(localStorage.getItem("bar-menu:node/1")!);
  localStorage.setItem("bar-menu:node/1", JSON.stringify({ ...saved, at: Date.now() - 25 * 60 * 60_000 }));
  await pickBar();
  expect(api).toHaveBeenCalledTimes(2);
});

test("using my location starts the menu lookup for the closest bars only", async () => {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 1, longitude: 2 } }),
    },
  });
  const far = { ...bar, id: "node/2", name: "Far Bar" };
  api.mockImplementation(async (path: string) =>
    path === "/bars/nearby" ? [{ ...bar, prefetch: true }, far] : menu);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <BarPicker value="" onChange={() => {}} onPickDrink={() => {}} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Use my location" }));
  await screen.findByRole("button", { name: /Far Bar/ });
  await vi.waitFor(() => expect(api).toHaveBeenCalledWith("/bars/node/1/menu", expect.anything()));
  expect(api).not.toHaveBeenCalledWith("/bars/node/2/menu", expect.anything());
  cleanup();
});
