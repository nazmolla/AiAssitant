/**
 * Unit tests for use-screen-share hook.
 * @jest-environment jsdom
 */
import { renderHook, act } from "@testing-library/react";
import { useScreenShare } from "@/hooks/use-screen-share";

describe("useScreenShare", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    originalFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      json: () => Promise.resolve({ screen_sharing_enabled: 1 }),
    });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  test("initializes with screen not sharing", () => {
    const { result } = renderHook(() => useScreenShare());
    expect(result.current.screenSharing).toBe(false);
    expect(result.current.latestFrameRef.current).toBeNull();
    expect(result.current.frameImgRef.current).toBeNull();
  });

  test("screenShareEnabled defaults to true", () => {
    const { result } = renderHook(() => useScreenShare());
    expect(result.current.screenShareEnabled).toBe(true);
  });

  test("captureFrame returns null when no video element", () => {
    const { result } = renderHook(() => useScreenShare());
    const frame = result.current.captureFrame();
    expect(frame).toBeNull();
  });

  test("stopScreenShare sets screenSharing to false", () => {
    const { result } = renderHook(() => useScreenShare());
    // Initially false, calling stop should remain false (no-op)
    act(() => { result.current.stopScreenShare(); });
    expect(result.current.screenSharing).toBe(false);
    expect(result.current.latestFrameRef.current).toBeNull();
  });

  test("startScreenShare calls onError when getDisplayMedia is unavailable", async () => {
    const onError = jest.fn();

    // Ensure getDisplayMedia is not available
    Object.defineProperty(navigator, "mediaDevices", {
      value: {},
      configurable: true,
    });

    const { result } = renderHook(() => useScreenShare({ onError }));

    await act(async () => { await result.current.startScreenShare(); });

    expect(onError).toHaveBeenCalledWith(expect.stringContaining("Screen sharing is not available"));
    expect(result.current.screenSharing).toBe(false);
  });

  test("startScreenShare handles NotAllowedError silently", async () => {
    const onError = jest.fn();

    Object.defineProperty(navigator, "mediaDevices", {
      value: {
        getDisplayMedia: jest.fn().mockRejectedValue(new DOMException("", "NotAllowedError")),
      },
      configurable: true,
    });

    const { result } = renderHook(() => useScreenShare({ onError }));

    await act(async () => { await result.current.startScreenShare(); });

    // NotAllowedError should be handled silently (no onError call)
    expect(onError).not.toHaveBeenCalled();
    expect(result.current.screenSharing).toBe(false);
  });

  test("fetches screen sharing preference on mount", () => {
    renderHook(() => useScreenShare());
    expect(global.fetch).toHaveBeenCalledWith("/api/config/profile");
  });
});
