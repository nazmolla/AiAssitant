import { apiClient, ApiError } from "@/lib/api/client";

// ── Mock global fetch ────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

afterEach(() => {
  mockFetch.mockReset();
});

// ── Helpers ──────────────────────────────────────────────────

function jsonResponse(data: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  };
}

// ── Tests ────────────────────────────────────────────────────

describe("apiClient", () => {
  describe("get", () => {
    it("sends GET request and returns parsed JSON", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ items: [1, 2] }));

      const result = await apiClient.get<{ items: number[] }>("/api/test");

      expect(mockFetch).toHaveBeenCalledWith("/api/test", { method: "GET" });
      expect(result).toEqual({ items: [1, 2] });
    });
  });

  describe("post", () => {
    it("sends POST with JSON body", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ id: "abc" }, 201));

      const result = await apiClient.post("/api/test", { name: "x" });

      expect(mockFetch).toHaveBeenCalledWith("/api/test", {
        method: "POST",
        body: JSON.stringify({ name: "x" }),
        headers: { "Content-Type": "application/json" },
      });
      expect(result).toEqual({ id: "abc" });
    });
  });

  describe("put", () => {
    it("sends PUT with JSON body", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ ok: true }));
      await apiClient.put("/api/test", { val: 1 });
      expect(mockFetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({ method: "PUT" }));
    });
  });

  describe("delete", () => {
    it("sends DELETE request", async () => {
      mockFetch.mockResolvedValue(jsonResponse(null, 204));
      await apiClient.delete("/api/test/1");
      expect(mockFetch).toHaveBeenCalledWith("/api/test/1", { method: "DELETE" });
    });
  });

  describe("error handling", () => {
    it("throws ApiError with parsed error message on non-ok response", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ error: "Not found" }, 404));

      await expect(apiClient.get("/api/missing")).rejects.toThrow(ApiError);
      try {
        await apiClient.get("/api/missing");
      } catch (err) {
        expect(err).toBeInstanceOf(ApiError);
        expect((err as ApiError).status).toBe(404);
        expect((err as ApiError).message).toBe("Not found");
      }
    });

    it("throws ApiError with generic message when body has no error field", async () => {
      mockFetch.mockResolvedValue(jsonResponse({ detail: "oops" }, 500));

      try {
        await apiClient.get("/api/fail");
      } catch (err) {
        expect((err as ApiError).message).toBe("Request failed with status 500");
      }
    });

    it("handles non-JSON error responses", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: () => Promise.reject(new Error("not json")),
        text: () => Promise.resolve("Bad Gateway"),
      });

      await expect(apiClient.get("/api/fail")).rejects.toThrow(ApiError);
    });
  });
});
