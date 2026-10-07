import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, expect, test, vi } from "vitest";
import LogPage from "@/app/log/page";
import CameraDialog from "@/app/log/camera-dialog";
import EntryCard from "@/app/entry-card";
import ProfileView from "@/app/u/[username]/profile-view";
import { ApiError, api } from "@/lib/api";

const navigation = vi.hoisted(() => ({
  edit: "entry",
  drink: "",
  router: { push: vi.fn(), replace: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation.router,
  useSearchParams: () =>
    new URLSearchParams({ ...(navigation.edit ? { id: navigation.edit } : {}), ...(navigation.drink ? { drink: navigation.drink } : {}) }),
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  api: vi.fn(),
}));
vi.mock("@/lib/photo", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/photo")>()),
  compressPhoto: async () => new Blob(["jpeg"]),
  photoForm: () => new FormData(),
}));

const entry = {
  drink_id: null,
  custom_drink_name: "Beer",
  logged_at: "2026-10-03T03:00:00Z",
  photo_path: null,
};
function mount(ui: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  navigation.edit = "entry";
  navigation.drink = "";
  vi.mocked(api)
    .mockReset()
    .mockImplementation(async (path) => {
      if (path === "/me") return { id: "owner" };
      if (path === "/entries/entry") return entry;
      return [];
    });
});

test("collection prefill waits for explicit submit and preserves the chosen name", async () => {
  navigation.edit = "";
  navigation.drink = "Tea & lime";
  mount(<LogPage />);
  expect(await screen.findByText("Tea & lime")).toBeDefined();
  expect(vi.mocked(api).mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  const button = screen.getByRole("button", { name: "Log it" });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button);
  await waitFor(() => expect(api).toHaveBeenCalledWith("/entries", expect.objectContaining({ method: "POST", body: expect.stringContaining('"custom_drink_name":"Tea & lime"') })));
});

test("edit data wins over collection prefill", async () => {
  navigation.drink = "Tea & lime";
  mount(<LogPage />);
  expect(await screen.findByText("Beer")).toBeDefined();
  expect(screen.queryByText("Tea & lime")).toBeNull();
});

test("cannot open the camera while an edit is saving", async () => {
  const save = deferred<unknown>();
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (options?.method === "PATCH") return save.promise;
    if (path === "/me") return { id: "owner" };
    if (path === "/entries/entry") return entry;
    return [];
  });
  mount(<LogPage />);
  await screen.findByText("Save changes");
  await waitFor(() =>
    expect(
      (screen.getByText("Save changes") as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  fireEvent.click(screen.getByText("Save changes"));
  await waitFor(() =>
    expect(
      (screen.getByRole("button", { name: "Take photo" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true),
  );
  await act(async () => save.resolve({}));
});

test("cancel discards an in-flight capture and stops the camera", async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({
          getTracks: () => [
            { stop, addEventListener() {}, removeEventListener() {} },
          ],
        }),
    },
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage() {},
  } as unknown as CanvasRenderingContext2D);
  let finish!: BlobCallback;
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => {
    finish = cb;
  });
  mount(<LogPage />);
  fireEvent.click(await screen.findByRole("button", { name: "Take photo" }));
  await waitFor(() => expect(document.querySelector("video")).not.toBeNull());
  const video = document.querySelector("video")!;
  Object.defineProperties(video, {
    readyState: { value: 2 },
    videoWidth: { value: 640 },
    videoHeight: { value: 480 },
  });
  fireEvent.loadedData(video);
  fireEvent.click(screen.getByText("Capture"));
  fireEvent.click(screen.getByText("Cancel"));
  // The old implementation tries to update the input after cancellation.
  vi.stubGlobal(
    "DataTransfer",
    class {
      items = { add() {} };
      files = undefined;
    },
  );
  // A real FileList is not needed: avoid a jsdom-only assignment exception.
  Object.defineProperty(screen.getByLabelText(/Photo · optional/), "files", {
    configurable: true,
    writable: true,
    value: null,
  });
  await act(async () => finish(new Blob(["jpeg"], { type: "image/jpeg" })));
  fireEvent.click(screen.getByText("Save changes"));
  await screen.findByText("Logged");
  expect(
    vi.mocked(api).mock.calls.some(([path]) => path.endsWith("/photo")),
  ).toBe(false);
  expect(stop).toHaveBeenCalled();
  expect(document.body.style.overflow).toBe("");
  vi.unstubAllGlobals();
});

test("leaving an open camera restores scrolling and stops the stream", async () => {
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi
        .fn()
        .mockResolvedValue({
          getTracks: () => [
            { stop, addEventListener() {}, removeEventListener() {} },
          ],
        }),
    },
  });
  document.body.style.overflow = "auto";
  const view = mount(<CameraDialog onClose={() => {}} onPhoto={() => {}} />);
  await waitFor(() =>
    expect(document.querySelector("video")?.srcObject).toBeTruthy(),
  );
  expect(document.body.style.overflow).toBe("hidden");
  view.unmount();
  expect(stop).toHaveBeenCalled();
  expect(document.body.style.overflow).toBe("auto");
  document.body.style.overflow = "";
});

test("permission resolving after the dialog unmounts cannot leave a camera running", async () => {
  const permission = deferred<MediaStream>();
  const stop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: () => permission.promise },
  });
  const view = mount(<CameraDialog onClose={() => {}} onPhoto={() => {}} />);
  view.unmount();
  await act(async () =>
    permission.resolve({
      getTracks: () => [{ stop }],
    } as unknown as MediaStream),
  );
  expect(stop).toHaveBeenCalled();
  expect(document.body.style.overflow).toBe("");
});

test("permission denial is visible and the camera can be cancelled", async () => {
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  const close = vi.fn();
  mount(<CameraDialog onClose={close} onPhoto={() => {}} />);
  expect(await screen.findByRole("alert")).toBeDefined();
  fireEvent.click(screen.getByText("Cancel"));
  expect(close).toHaveBeenCalled();
});

test("retry after a photo failure persists changes to the drink fields", async () => {
  navigation.edit = "";
  let stored: Record<string, unknown> | undefined;
  let uploadAttempts = 0;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/me") return { id: "owner" };
    if (path === "/entries" && options?.method === "POST") {
      if (stored) throw new ApiError("duplicate", 409, "23505");
      stored = JSON.parse(options.body as string);
      return {};
    }
    if (options?.method === "PATCH") {
      stored = JSON.parse(options.body as string);
      return {};
    }
    if (path.endsWith("/photo") && ++uploadAttempts === 1)
      throw new Error("Upload failed");
    return [];
  });
  mount(<LogPage />);
  fireEvent.change(screen.getByPlaceholderText("Start typing…"), {
    target: { value: "Beer" },
  });
  fireEvent.click(screen.getByText("Log “Beer” as written"));
  fireEvent.click(screen.getByText(/Add details/));
  fireEvent.change(screen.getByLabelText(/Photo · optional/), {
    target: { files: [new File(["jpeg"], "drink.jpg", { type: "image/jpeg" })] },
  });
  await waitFor(() =>
    expect((screen.getByText("Log it") as HTMLButtonElement).disabled).toBe(
      false,
    ),
  );
  fireEvent.click(screen.getByText("Log it"));
  await screen.findByText(/Upload failed/);
  fireEvent.change(screen.getByLabelText(/Note · optional/), {
    target: { value: "Updated after failure" },
  });
  fireEvent.click(screen.getByText("Log it"));
  await screen.findByText("Log another");
  await waitFor(() =>
    expect(
      (screen.getByText("Log another") as HTMLButtonElement).disabled,
    ).toBe(false),
  );
  expect(stored?.note).toBe("Updated after failure");
});

test("a chosen photo shows as an image, not just its name", async () => {
  navigation.edit = "";
  mount(<LogPage />);
  fireEvent.change(screen.getByPlaceholderText("Start typing…"), {
    target: { value: "Beer" },
  });
  fireEvent.click(screen.getByText("Log “Beer” as written"));
  fireEvent.click(screen.getByText(/Add details/));
  fireEvent.change(screen.getByLabelText(/Photo · optional/), {
    target: { files: [new File(["jpeg"], "drink.jpg", { type: "image/jpeg" })] },
  });
  expect(
    (screen.getByAltText("Selected photo") as HTMLImageElement).src,
  ).toBe("blob:preview");
});

test("a non-image file is refused before it reaches the form", async () => {
  navigation.edit = "";
  mount(<LogPage />);
  fireEvent.change(screen.getByPlaceholderText("Start typing…"), {
    target: { value: "Beer" },
  });
  fireEvent.click(screen.getByText("Log “Beer” as written"));
  fireEvent.click(screen.getByText(/Add details/));
  fireEvent.change(screen.getByLabelText(/Photo · optional/), {
    target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] },
  });
  expect(screen.getByText("Choose an image file.")).toBeDefined();
  expect(screen.queryByAltText("Selected photo")).toBeNull();
});

const row = {
  id: "entry",
  user_id: "owner",
  username: "jo",
  avatar_url: null,
  drink_name: "Beer",
  night_out_id: null,
  night_out_name: null,
  location: null,
  photo_path: "owner/photo.jpg",
  note: null,
  recommended: null,
  logged_at: "2026-10-03T03:00:00Z",
  reaction_count: 0,
  reacted_by_me: false,
};
test("a failed photo load offers recovery instead of a broken image", () => {
  mount(
    <EntryCard
      row={{ ...row, photo_url: "https://example.test/broken.jpg" }}
    />,
  );
  fireEvent.error(screen.getByAltText("Photo of Beer"));
  expect(screen.getByText("Photo unavailable")).toBeDefined();
  expect(screen.getByRole("button", { name: /Retry photo/ })).toBeDefined();
});
test("a signing failure keeps the attachment visible as unavailable", () => {
  mount(<EntryCard row={{ ...row, photo_url: null }} />);
  expect(screen.getByText("Photo unavailable")).toBeDefined();
});

const profile = {
  id: "owner",
  username: "jo",
  avatar_url: null,
  avatar_src: null,
  user_code: "abc",
  timezone: "UTC",
};
test.each(["empty", "failed"])(
  "profile history shows its %s state",
  async (state) => {
    vi.mocked(api).mockImplementation(async (path) => {
      if (path.startsWith("/entries?") && state === "failed")
        throw new Error("Offline");
      return path.startsWith("/entries?") ? [] : null;
    });
    mount(
      <ProfileView
        profile={profile}
        viewerId="owner"
        email={null}
        leaderboardOptIn={false}
      />,
    );
    expect(
      await screen.findByText(
        state === "empty"
          ? "No drinks logged yet."
          : "Could not load drink history.",
      ),
    ).toBeDefined();
  },
);
