import { validatePassword } from "@/lib/auth/password-policy";

describe("validatePassword", () => {
  test("rejects empty password", () => {
    expect(validatePassword("")).toEqual({ valid: false, message: "Password must be at least 8 characters." });
  });

  test("rejects short password", () => {
    expect(validatePassword("Ab1!xyz")).toEqual({ valid: false, message: "Password must be at least 8 characters." });
  });

  test("rejects password without uppercase", () => {
    expect(validatePassword("abcdefg1!")).toEqual({
      valid: false,
      message: "Password must contain at least one uppercase letter.",
    });
  });

  test("rejects password without lowercase", () => {
    expect(validatePassword("ABCDEFG1!")).toEqual({
      valid: false,
      message: "Password must contain at least one lowercase letter.",
    });
  });

  test("rejects password without digit", () => {
    expect(validatePassword("Abcdefgh!")).toEqual({
      valid: false,
      message: "Password must contain at least one digit.",
    });
  });

  test("rejects password without special character", () => {
    expect(validatePassword("Abcdefg1")).toEqual({
      valid: false,
      message: "Password must contain at least one special character.",
    });
  });

  test("accepts valid complex password", () => {
    expect(validatePassword("MyP@ss1!")).toEqual({ valid: true, message: "" });
  });

  test("accepts long complex password", () => {
    expect(validatePassword("SuperSecure#2024!")).toEqual({ valid: true, message: "" });
  });
});
