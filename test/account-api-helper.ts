/**
 * Account helpers for tests that need both a platform OWNER and an ordinary
 * user. The two roles have SEPARATE entry points, exactly as in the product:
 * the owner is created through `/api/owner/signup` (the owner entry point) and
 * an ordinary user through `/api/user/signup` (the user entry point). The role
 * is fixed server-side per endpoint, so these helpers mirror how the real
 * product bootstraps rather than asking for a role.
 */
import { signupEnrolledCookie, ownerSignupEnrolledCookie } from './helpers.ts';

/** Creates an ordinary (non-owner) user through the dedicated user entry point. */
export async function signUp(url: string, username: string, _role?: 'admin' | 'developer'): Promise<string> {
  return signupEnrolledCookie(url, username);
}

/** Creates the Platform Owner through the dedicated owner entry point. */
export async function signUpOwner(url: string, username: string): Promise<string> {
  return ownerSignupEnrolledCookie(url, username);
}
