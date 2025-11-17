/**
 * Password validation utilities
 * Enforces strong password requirements
 */

export interface PasswordValidationResult {
  isValid: boolean;
  errors: string[];
  strength: "weak" | "medium" | "strong";
}

/**
 * Validates password strength
 * Requirements:
 * - At least 8 characters
 * - At least one uppercase letter
 * - At least one lowercase letter
 * - At least one number
 * - At least one special character
 */
export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  if (password.length < 8) {
    errors.push("Password must be at least 8 characters long");
  }

  if (!/[A-Z]/.test(password)) {
    errors.push("Password must contain at least one uppercase letter");
  }

  if (!/[a-z]/.test(password)) {
    errors.push("Password must contain at least one lowercase letter");
  }

  if (!/[0-9]/.test(password)) {
    errors.push("Password must contain at least one number");
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push("Password must contain at least one special character (!@#$%^&*...)");
  }

  // Calculate strength
  let strength: "weak" | "medium" | "strong" = "weak";
  if (errors.length === 0) {
    if (password.length >= 12 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /[0-9]/.test(password) && /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
      strength = "strong";
    } else {
      strength = "medium";
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    strength,
  };
}

/**
 * Get password strength indicator color
 */
export function getPasswordStrengthColor(strength: "weak" | "medium" | "strong"): string {
  switch (strength) {
    case "weak":
      return "text-destructive";
    case "medium":
      return "text-yellow-500";
    case "strong":
      return "text-green-500";
    default:
      return "text-muted-foreground";
  }
}

