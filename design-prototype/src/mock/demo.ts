/* ============================================================
   Preview / demo credentials — DEV PROTOTYPE ONLY.

   This file exists only in the design-prototype's frontend mock
   layer. It does not touch, weaken, or represent the production
   security model (the real backend keeps its own accounts, real
   TOTP secrets, and real password hashing).

   Use these on the login screen at http://localhost:5180/#/login:

     Username or email : cornelius
     Password          : nexora2026
     Authenticator code: 123456   (any 6 digits works;
                                   000000 simulates a rejected code)
     Recovery code     : N7K4-Q9W2 (from "Lost your authenticator?")

   NOTE: accounts are identified by USERNAME only (the backend AccountView
   has no email field). This demo login hint intentionally does NOT carry the
   founder's real email — that lives only in mock/contact.ts (single source
   of truth, never duplicated). These credentials are for development
   prototyping only and do NOT represent real backend accounts or seeds.
   ============================================================ */

export const DEMO = {
  username: 'cornelius',
  email: 'cornelius@nexora.demo',
  password: 'nexora2026',
  totp: '123456',
  totpRejected: '000000',
  recovery: 'N7K4-Q9W2',
} as const

/* Recovery codes for the preview account (one-time use in a real backend). */
export const RECOVERY_CODES = [
  'N7K4-Q9W2', 'D3F8-X1M6', 'P5H2-J8T4', 'R9L1-C7V3',
  'A2B6-G4E8', 'S5K7-Y3Q9', 'W8J4-Z6N1', 'M1C9-E7H5',
]