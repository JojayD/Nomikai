import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import Avatar from "@/app/avatar";
import AccountPanel from "@/app/account-panel";
import { api } from "@/lib/api";
import { photoProblem } from "@/lib/photo";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: async () => ({ error: null }) } }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: vi.fn(async () => ({})),
}));
vi.mock("@/lib/photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo")>()),
  compressPhoto: async () => new Blob(["jpeg"]),
}));

beforeEach(() => {
  vi.mocked(api).mockClear();
});

test("renders the signed image when there is one", () => {
  render(<Avatar src="https://example.test/a.jpg" username="jo" size={7} />);
  const img = document.querySelector("img");
  expect(img?.getAttribute("src")).toBe("https://example.test/a.jpg");
  expect(img?.className).toContain("h-7");
});

test("falls back to the username initial when there is no avatar", () => {
  render(<Avatar src={null} username="jo" size={7} />);
  expect(document.querySelector("img")).toBeNull();
  expect(screen.getByText("j").className).toContain("h-7");
});

test.each([
  [20 * 1024 * 1024, null],
  [20 * 1024 * 1024 + 1, "That image is over 20 MB."],
])("checks the raw image size boundary at %i bytes", (bytes, problem) => {
  const file = new File([new Uint8Array(bytes)], "me.png", { type: "image/png" });
  expect(photoProblem(file)).toBe(problem);
});

function mountPanel() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <AccountPanel
        username="jo"
        userCode="abc"
        timezone="UTC"
        email="jo@example.test"
        avatarUrl={null}
        leaderboardOptIn
      />
    </QueryClientProvider>,
  );
}

test("a non-image avatar is refused without a request and the input resets", () => {
  mountPanel();
  const input = screen.getByLabelText("Avatar") as HTMLInputElement;
  // jsdom cannot populate a file input's value like the native picker does.
  Object.defineProperty(input, "value", {
    configurable: true,
    writable: true,
    value: "C:\\fakepath\\notes.txt",
  });
  fireEvent.change(input, {
    target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
  });
  expect(screen.getByText("Choose an image file.")).toBeDefined();
  expect(vi.mocked(api)).not.toHaveBeenCalled();
  expect(input.value).toBe("");
});

test("an image avatar is uploaded", async () => {
  mountPanel();
  fireEvent.change(screen.getByLabelText("Avatar"), {
    target: { files: [new File(["jpeg"], "me.jpg", { type: "image/jpeg" })] },
  });
  await waitFor(() =>
    expect(vi.mocked(api)).toHaveBeenCalledWith(
      "/me/avatar",
      expect.objectContaining({ method: "POST" }),
    ),
  );
  expect(await screen.findByText("Saved.")).toBeDefined();
});
