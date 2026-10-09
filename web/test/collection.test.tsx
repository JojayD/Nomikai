import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import { api } from "@/lib/api";
import EntryCard, { type EntryRowData } from "@/app/entry-card";
import Collection from "@/app/collection/page";

vi.mock("@/lib/api", async (original) => ({
  ...(await original<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));
beforeEach(() => {
  vi.mocked(api).mockReset();
});
const row: EntryRowData = {
  id: "entry",
  user_id: "owner",
  username: "jo",
  avatar_url: null,
  drink_name: "Virgin Mojito",
  night_out_id: null,
  night_out_name: null,
  location: null,
  photo_path: null,
  note: null,
  recommended: true,
  logged_at: "2026-10-01T00:00:00Z",
  reaction_count: 0,
  reacted_by_me: false,
};
function mount(child: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{child}</QueryClientProvider>,
  );
}
test("save from a visible entry waits for persistence and lets a failed request retry", async () => {
  let fail!: (error: Error) => void;
  vi.mocked(api).mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  mount(<EntryCard row={row} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Want to try Virgin Mojito" }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/collection/saved",
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ name: "Virgin Mojito" }),
      }),
    ),
  );
  expect(
    (
      screen.getByRole("button", {
        name: "Want to try Virgin Mojito",
      }) as HTMLButtonElement
    ).disabled,
  ).toBe(true);
  fail(new Error("Connection lost"));
  expect(await screen.findByRole("alert")).toBeDefined();
  vi.mocked(api).mockResolvedValueOnce({ id: "saved" });
  fireEvent.click(
    screen.getByRole("button", { name: "Want to try Virgin Mojito" }),
  );
  expect(await screen.findByText("Saved to Want to try")).toBeDefined();
});

test("collection retains a failed add and supports retry, logging and removal", async () => {
  let saved: { id: string; name: string; tried: boolean }[] = [];
  let attempt = 0;
  vi.mocked(api).mockImplementation(async (path, init) => {
    if (init?.method === "PUT") {
      if (++attempt === 1) throw new Error("Offline");
      saved = [{ id: "s1", name: "Tea & lime", tried: false }];
      return saved[0];
    }
    if (init?.method === "DELETE") {
      saved = [];
      return { deleted: true };
    }
    return path === "/collection/saved" ? saved : [];
  });
  mount(<Collection />);
  expect(
    await screen.findByText("Your next discovery starts here."),
  ).toBeDefined();
  fireEvent.change(screen.getByLabelText("Drink name"), {
    target: { value: "Tea & lime" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save drink" }));
  expect(await screen.findByRole("alert")).toBeDefined();
  expect((screen.getByLabelText("Drink name") as HTMLInputElement).value).toBe(
    "Tea & lime",
  );
  fireEvent.click(screen.getByRole("button", { name: "Save drink" }));
  expect(
    (await screen.findByRole("link", { name: "Log Tea & lime" })).getAttribute(
      "href",
    ),
  ).toBe("/log?drink=Tea%20%26%20lime");
  fireEvent.click(screen.getByRole("button", { name: "Remove Tea & lime" }));
  expect(
    await screen.findByText("Your next discovery starts here."),
  ).toBeDefined();
});

test("passport filters actual unique drinks and distinguishes no matches", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/collection/passport"
      ? [
          {
            normalized_name: "tea",
            name: "Tea",
            times_logged: 3,
            recommended: true,
            first_logged_at: "2026-10-01T00:00:00Z",
            last_logged_at: "2026-10-02T00:00:00Z",
          },
          {
            normalized_name: "lager",
            name: "Lager",
            times_logged: 1,
            recommended: false,
            first_logged_at: "2026-10-01T00:00:00Z",
            last_logged_at: "2026-10-01T00:00:00Z",
          },
        ]
      : [],
  );
  mount(<Collection />);
  fireEvent.click(screen.getByRole("button", { name: "Passport" }));
  expect(await screen.findByText("2 unique drinks")).toBeDefined();
  fireEvent.click(screen.getByRole("button", { name: "Recommended" }));
  expect(screen.queryByText("Lager")).toBeNull();
  expect(screen.getByText("Tea")).toBeDefined();
  fireEvent.change(screen.getByLabelText("Search your passport"), {
    target: { value: "coffee" },
  });
  expect(screen.getByText("No drinks match these filters.")).toBeDefined();
});

test("collection load failure offers a retry instead of showing an empty collection", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Offline"))
    .mockResolvedValue([]);
  mount(<Collection />);
  expect(await screen.findByRole("alert")).toBeDefined();
  expect(screen.queryByText("Your next discovery starts here.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(
    await screen.findByText("Your next discovery starts here."),
  ).toBeDefined();
});

test("saving a friend pick links to the Want to try view", async () => {
  vi.mocked(api).mockImplementation(async (path: string) =>
    path === "/collection/picks"
      ? [{ normalized_name: "yuzu", name: "Yuzu", recommenders: ["bo"], last_recommended_at: "2026-10-01T00:00:00Z" }]
      : [],
  );
  mount(<Collection />);
  fireEvent.click(screen.getByRole("button", { name: "From friends" }));
  expect(await screen.findByText("Recommended by bo")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Want to try Yuzu" }));
  fireEvent.click(await screen.findByText("Saved to Want to try"));
  expect(screen.getByRole("button", { name: "Want to try" }).getAttribute("aria-pressed")).toBe("true");
});
