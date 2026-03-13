import {
  NexusError,
  ValidationError,
  ConfigurationError,
  PermissionError,
  NotFoundError,
  IntegrationError,
  getHttpStatusFromError,
  isNexusError,
} from "@/lib/errors";

describe("NexusError hierarchy", () => {
  describe("NexusError (base)", () => {
    it("sets message, code, statusCode, and context", () => {
      const err = new NexusError("boom", "TEST_CODE", 418, { key: "val" });
      expect(err.message).toBe("boom");
      expect(err.code).toBe("TEST_CODE");
      expect(err.statusCode).toBe(418);
      expect(err.context).toEqual({ key: "val" });
      expect(err.name).toBe("NexusError");
    });

    it("defaults statusCode to 500", () => {
      const err = new NexusError("oops", "CODE");
      expect(err.statusCode).toBe(500);
    });

    it("is an instance of Error", () => {
      expect(new NexusError("x", "Y")).toBeInstanceOf(Error);
    });
  });

  describe.each([
    { Cls: ValidationError, name: "ValidationError", code: "VALIDATION_FAILED", status: 400 },
    { Cls: ConfigurationError, name: "ConfigurationError", code: "NOT_CONFIGURED", status: 500 },
    { Cls: PermissionError, name: "PermissionError", code: "PERMISSION_DENIED", status: 403 },
    { Cls: NotFoundError, name: "NotFoundError", code: "NOT_FOUND", status: 404 },
    { Cls: IntegrationError, name: "IntegrationError", code: "INTEGRATION_FAILED", status: 502 },
  ])("$name", ({ Cls, name, code, status }) => {
    it("has correct name, code, and statusCode", () => {
      const err = new Cls("msg");
      expect(err.name).toBe(name);
      expect(err.code).toBe(code);
      expect(err.statusCode).toBe(status);
    });

    it("is instanceof NexusError and Error", () => {
      const err = new Cls("msg");
      expect(err).toBeInstanceOf(NexusError);
      expect(err).toBeInstanceOf(Error);
    });

    it("passes context through", () => {
      const err = new Cls("msg", { detail: 42 });
      expect(err.context).toEqual({ detail: 42 });
    });
  });

  describe("getHttpStatusFromError", () => {
    it("returns statusCode for NexusError subclasses", () => {
      expect(getHttpStatusFromError(new ValidationError("x"))).toBe(400);
      expect(getHttpStatusFromError(new PermissionError("x"))).toBe(403);
      expect(getHttpStatusFromError(new NotFoundError("x"))).toBe(404);
      expect(getHttpStatusFromError(new ConfigurationError("x"))).toBe(500);
      expect(getHttpStatusFromError(new IntegrationError("x"))).toBe(502);
    });

    it("returns 500 for plain Error", () => {
      expect(getHttpStatusFromError(new Error("x"))).toBe(500);
    });

    it("returns 500 for non-error values", () => {
      expect(getHttpStatusFromError("string")).toBe(500);
      expect(getHttpStatusFromError(null)).toBe(500);
    });
  });

  describe("isNexusError", () => {
    it("returns true for NexusError and subclasses", () => {
      expect(isNexusError(new NexusError("x", "Y"))).toBe(true);
      expect(isNexusError(new ValidationError("x"))).toBe(true);
      expect(isNexusError(new IntegrationError("x"))).toBe(true);
    });

    it("returns false for plain Error and non-errors", () => {
      expect(isNexusError(new Error("x"))).toBe(false);
      expect(isNexusError("string")).toBe(false);
      expect(isNexusError(undefined)).toBe(false);
    });
  });
});
