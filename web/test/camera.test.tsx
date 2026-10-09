import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import CameraDialog from "@/app/log/camera-dialog";

let stop: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
beforeEach(() => {
  stop = vi.fn();
  getUserMedia = vi.fn().mockResolvedValue({
    getTracks: () => [{ stop, addEventListener() {}, removeEventListener() {} }],
    getVideoTracks: () => [{ getSettings: () => ({ facingMode: "environment" }) }],
  });
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage() {}, translate() {}, scale() {} } as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(new Blob(["jpeg"], { type: "image/jpeg" })));
});
async function ready() {
  await waitFor(() => expect(document.querySelector("video")?.srcObject).toBeTruthy());
  const video = document.querySelector("video")!;
  Object.defineProperties(video, { readyState: { configurable: true, value: 2 }, videoWidth: { configurable: true, value: 640 }, videoHeight: { configurable: true, value: 480 } });
  fireEvent.loadedData(video);
}

test("capture is reviewed, retaken, and only attached on confirmation", async () => {
  const onPhoto = vi.fn();
  const onClose = vi.fn();
  render(<CameraDialog onPhoto={onPhoto} onClose={onClose} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  expect(await screen.findByAltText("Photo preview")).toBeDefined();
  expect(stop).toHaveBeenCalled();
  expect(onPhoto).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Retake" }));
  await ready();
  expect(getUserMedia).toHaveBeenCalledTimes(2);
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  fireEvent.click(await screen.findByRole("button", { name: "Use photo" }));
  expect(onPhoto).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg" }));
  expect(onClose).toHaveBeenCalledOnce();
});

test("flip releases the old camera and requests the other facing mode", async () => {
  render(<CameraDialog onPhoto={() => {}} onClose={() => {}} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Flip camera" }));
  await waitFor(() => expect(getUserMedia).toHaveBeenCalledWith({ video: { facingMode: "user" }, audio: false }));
  expect(stop).toHaveBeenCalled();
});

test("failed encoding stays in the camera and can be retried", async () => {
  vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((cb) => cb(null));
  render(<CameraDialog onPhoto={() => {}} onClose={() => {}} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Could not capture photo — try again.");
  expect(screen.getByRole("button", { name: "Capture" })).toHaveProperty("disabled", false);
});

test("a library photo is validated and reviewed even without camera permission", async () => {
  getUserMedia.mockRejectedValue(new Error("denied"));
  const onPhoto = vi.fn();
  render(<CameraDialog onPhoto={onPhoto} onClose={() => {}} />);
  await screen.findByRole("alert");
  const input = screen.getByLabelText("Choose photo from library");
  fireEvent.change(input, { target: { files: [new File(["bad"], "bad.txt", { type: "text/plain" })] } });
  expect(screen.queryByAltText("Photo preview")).toBeNull();
  const file = new File(["jpeg"], "drink.jpg", { type: "image/jpeg" });
  await act(async () => fireEvent.change(input, { target: { files: [file] } }));
  expect(screen.getByAltText("Photo preview")).toBeDefined();
  expect(onPhoto).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Use photo" }));
  expect(onPhoto).toHaveBeenCalledWith(file);
});

test("closing review discards the photo and releases its preview URL", async () => {
  const onPhoto = vi.fn();
  const revoke = vi.spyOn(URL, "revokeObjectURL");
  const view = render(<CameraDialog onPhoto={onPhoto} onClose={() => view.unmount()} />);
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  await screen.findByAltText("Photo preview");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onPhoto).not.toHaveBeenCalled();
  expect(revoke).toHaveBeenCalledWith("blob:preview");
});

test("a late camera request after flipping is stopped without replacing the active preview", async () => {
  let resolve!: (stream: MediaStream) => void;
  getUserMedia.mockImplementationOnce(() => new Promise<MediaStream>((r) => { resolve = r; }));
  render(<CameraDialog onPhoto={() => {}} onClose={() => {}} />);
  fireEvent.click(screen.getByRole("button", { name: "Flip camera" }));
  await ready();
  const current = document.querySelector("video")!.srcObject;
  const lateStop = vi.fn();
  await act(async () => resolve({ getTracks: () => [{ stop: lateStop }] } as unknown as MediaStream));
  expect(lateStop).toHaveBeenCalledOnce();
  expect(document.querySelector("video")!.srcObject).toBe(current);
});

test("front camera capture matches its mirrored preview", async () => {
  getUserMedia.mockResolvedValue({
    getTracks: () => [{ stop, addEventListener() {}, removeEventListener() {} }],
    getVideoTracks: () => [{ getSettings: () => ({ facingMode: "user" }) }],
  });
  const context = { drawImage: vi.fn(), translate: vi.fn(), scale: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(context as unknown as CanvasRenderingContext2D);
  render(<CameraDialog onPhoto={() => {}} onClose={() => {}} />);
  await ready();
  expect(document.querySelector("video")!.className).toContain("-scale-x-100");
  fireEvent.click(screen.getByRole("button", { name: "Capture" }));
  expect(context.translate).toHaveBeenCalledWith(640, 0);
  expect(context.scale).toHaveBeenCalledWith(-1, 1);
  expect(context.drawImage).toHaveBeenCalled();
});
