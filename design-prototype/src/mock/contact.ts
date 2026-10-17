/* ============================================================
   Authoritative contact values for Blueprint-First Customer Care / Founder
   contact. Single source of truth — no duplicates.
   ============================================================ */

export const CARE_EMAIL = 'adedejicorneliusvictor@gmail.com'
export const CARE_WA = '2347061743252'

export const GMAIL_COMPOSE_URL =
  `https://mail.google.com/mail/?view=cm&fs=1&to=${CARE_EMAIL}`

export const WHATSAPP_URL =
  `https://wa.me/${CARE_WA}?text=${encodeURIComponent('Hello Blueprint-First support — I have a question.')}`

export const MAILTO_URL = `mailto:${CARE_EMAIL}`