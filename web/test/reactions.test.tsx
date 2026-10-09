import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import EntryCard, { type EntryRowData } from "@/app/entry-card";
import { api } from "@/lib/api";

vi.mock("@/lib/api", () => ({ api: vi.fn() }));
const row: EntryRowData = {
  id: "entry",
  user_id: "owner",
  username: "owner",
  drink_name: "Tea",
  avatar_url: null,
  night_out_id: null,
  night_out_name: null,
  location: null,
  photo_path: null,
  note: null,
  recommended: null,
  logged_at: new Date().toISOString(),
  reaction_count: 0,
  reacted_by_me: false,
};
beforeEach(() => {
  vi.mocked(api).mockReset();
});
function mount(copies = 1) {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      {Array.from({ length: copies }, (_, i) => (
        <EntryCard key={i} row={row} />
      ))}
    </QueryClientProvider>,
  );
}

test("rapid taps send only one reaction while the request is pending", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount();
  const button = screen.getByRole("button", { name: "React" });
  fireEvent.click(button);
  fireEvent.click(button);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  expect(button.textContent).toBe("♥ 1");
  await act(async () => finish({ reacted: true }));
  expect(button.getAttribute("aria-pressed")).toBe("true");
});

test("a rejected reaction rolls back and tells the user they can retry", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("offline"));
  mount();
  const button = screen.getByRole("button", { name: "React" });
  fireEvent.click(button);
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toMatch(/try again/i),
  );
  expect(button.textContent).toBe("♡");
  expect(button.getAttribute("aria-pressed")).toBe("false");
});

test("two views of the same entry cannot send overlapping reaction writes", async () => {
  let finish!: (value: unknown) => void;
  vi.mocked(api).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  mount(2);
  const buttons = screen.getAllByRole("button", { name: "React" });
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  await waitFor(() => expect(api).toHaveBeenCalledTimes(1));
  await act(async () => finish({ reacted: true }));
});
