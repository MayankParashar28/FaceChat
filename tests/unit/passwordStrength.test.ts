import { describe, it, expect } from "vitest";
import { validatePasswordStrength } from "../../server/utils/passwordHash";

describe("validatePasswordStrength", () => {
  it("accepts a strong password", () => {
    const result = validatePasswordStrength("Str0ng!Pass");
    expect(result.isValid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("rejects a short password and reports why", () => {
    const result = validatePasswordStrength("aB1!");
    expect(result.isValid).toBe(false);
    expect(result.errors).toContain("Password must be at least 8 characters long");
  });

  it("requires uppercase, number, and special character", () => {
    const result = validatePasswordStrength("alllowercase");
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        "Password must contain at least one uppercase letter",
        "Password must contain at least one number",
        "Password must contain at least one special character",
      ])
    );
  });
});
