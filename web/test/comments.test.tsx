import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, test, vi } from "vitest";
import Comments from "@/app/comments";

const api = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api", () => ({ api, json: (body: unknown) => ({ body }) }));

test("opens the thread, posts a comment, and only offers delete where allowed", async () => {
  const thread = [
    { id: "c1", user_id: "me", username: "me", body: "mine", created_at: "" },
    { id: "c2", user_id: "other", username: "other", body: "theirs", created_at: "" },
  ];
  api.mockImplementation(async (path: string, init?: { method?: string }) =>
    path === "/me" ? { id: "me" } : init?.method ? {} : thread);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <Comments entryId="e1" ownerId="owner" count={2} />
    </QueryClientProvider>,
  );
  fireEvent.click(screen.getByRole("button", { name: "2 comments" }));
  await screen.findByText("theirs");
  // not the entry's owner, so only my own comment can go
  expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);

  const post = screen.getByRole("button", { name: "Post" });
  expect(post).toHaveProperty("disabled", true);
  fireEvent.change(screen.getByLabelText("Add a comment"), { target: { value: "cheers" } });
  fireEvent.click(post);
  await vi.waitFor(() =>
    expect(api).toHaveBeenCalledWith("/entries/e1/comments", { method: "POST", body: { body: "cheers" } }));
});
