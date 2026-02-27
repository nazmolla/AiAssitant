/**
 * Password policy enforcement for local accounts.
 *
 * Requirements:
 *  - Minimum 8 characters
 *  - At least one uppercase letter
 *  - At least one lowercase letter
 *  - At least one digit
 *  - At least one special character
 */

export interface PasswordPolicyResult {
  valid: boolean;
  message: string;
}

const MIN_LENGTH = 8;

export function validatePassword(password: string): PasswordPolicyResult {
  if (!password || password.length < MIN_LENGTH) {
    return { valid: false, message: `Password must be at least ${MIN_LENGTH} characters.` };
  }
  if (!/[A-Z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one uppercase letter." };
  }
  if (!/[a-z]/.test(password)) {
    return { valid: false, message: "Password must contain at least one lowercase letter." };
  }
  if (!/[0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one digit." };
  }
  if (!/[^A-Za-z0-9]/.test(password)) {
    return { valid: false, message: "Password must contain at least one special character." };
  }
  return { valid: true, message: "" };
}
