/**
 * Unit tests for use-file-upload hook.
 * @jest-environment jsdom
 */
import React from "react";
import { renderHook, act } from "@testing-library/react";
import "@testing-library/jest-dom";

// Mock chat-panel-types
jest.mock("@/components/chat-panel-types", () => ({
  // Minimal stubs for types - they're just interfaces
}));

import { useFileUpload } from "@/hooks/use-file-upload";

describe("useFileUpload", () => {
  let originalCreateObjectURL: typeof URL.createObjectURL;
  let originalRevokeObjectURL: typeof URL.revokeObjectURL;

  beforeEach(() => {
    originalCreateObjectURL = URL.createObjectURL;
    originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:http://localhost/test-blob");
    URL.revokeObjectURL = jest.fn();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    jest.restoreAllMocks();
  });

  test("initializes with empty pending files", () => {
    const { result } = renderHook(() => useFileUpload());
    expect(result.current.pendingFiles).toEqual([]);
  });

  test("handleFileSelect adds image files with preview URLs", () => {
    const { result } = renderHook(() => useFileUpload());

    const imageFile = new File(["img"], "photo.png", { type: "image/png" });
    const event = {
      target: { files: [imageFile], value: "C:\\photo.png" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    act(() => { result.current.handleFileSelect(event); });

    expect(result.current.pendingFiles).toHaveLength(1);
    expect(result.current.pendingFiles[0].file).toBe(imageFile);
    expect(result.current.pendingFiles[0].previewUrl).toBe("blob:http://localhost/test-blob");
    expect(result.current.pendingFiles[0].uploading).toBe(false);
    expect(URL.createObjectURL).toHaveBeenCalledWith(imageFile);
  });

  test("handleFileSelect adds non-image files without preview URL", () => {
    const { result } = renderHook(() => useFileUpload());

    const textFile = new File(["hello"], "readme.txt", { type: "text/plain" });
    const event = {
      target: { files: [textFile], value: "C:\\readme.txt" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    act(() => { result.current.handleFileSelect(event); });

    expect(result.current.pendingFiles).toHaveLength(1);
    expect(result.current.pendingFiles[0].previewUrl).toBeNull();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  test("handleFileSelect clears the input value for re-selection", () => {
    const { result } = renderHook(() => useFileUpload());

    const target = { files: [new File(["x"], "x.txt", { type: "text/plain" })], value: "C:\\x.txt" };
    const event = { target } as unknown as React.ChangeEvent<HTMLInputElement>;

    act(() => { result.current.handleFileSelect(event); });

    expect(target.value).toBe("");
  });

  test("removePendingFile revokes blob URL and removes entry", () => {
    const { result } = renderHook(() => useFileUpload());

    const imgFile = new File(["img"], "a.png", { type: "image/png" });
    const event = {
      target: { files: [imgFile], value: "" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    act(() => { result.current.handleFileSelect(event); });
    expect(result.current.pendingFiles).toHaveLength(1);

    act(() => { result.current.removePendingFile(0); });

    expect(result.current.pendingFiles).toHaveLength(0);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:http://localhost/test-blob");
  });

  test("removePendingFile does not call revokeObjectURL for null previewUrl", () => {
    const { result } = renderHook(() => useFileUpload());

    const txtFile = new File(["txt"], "a.txt", { type: "text/plain" });
    const event = {
      target: { files: [txtFile], value: "" },
    } as unknown as React.ChangeEvent<HTMLInputElement>;

    act(() => { result.current.handleFileSelect(event); });
    act(() => { result.current.removePendingFile(0); });

    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  test("uploadFile calls fetch with FormData and returns attachment meta", async () => {
    const mockMeta = { id: "att-1", filename: "test.png", mime_type: "image/png", size: 123 };
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockMeta),
    });

    const { result } = renderHook(() => useFileUpload());
    const file = new File(["data"], "test.png", { type: "image/png" });

    const meta = await result.current.uploadFile(file, "thread-1");

    expect(meta).toEqual(mockMeta);
    expect(global.fetch).toHaveBeenCalledWith("/api/attachments", expect.objectContaining({ method: "POST" }));
  });

  test("uploadFile throws on error response", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      json: () => Promise.resolve({ error: "Too large" }),
    });

    const { result } = renderHook(() => useFileUpload());
    const file = new File(["data"], "huge.zip", { type: "application/zip" });

    await expect(result.current.uploadFile(file, "thread-1")).rejects.toThrow("Too large");
  });
});
