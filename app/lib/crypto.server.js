// ── Chiffrement des jetons OAuth (décision 20) — AES-256-GCM, clé dans l'env Vercel ──────────────
// TOKEN_ENCRYPTION_KEY = 32 octets en base64. La base ne voit jamais un jeton en clair : sans clé
// valide on REFUSE (erreur explicite), jamais de repli en clair. Format stocké (TEXT) :
// base64(iv 12 octets | tag 16 octets | chiffré). IV aléatoire → deux chiffrements d'un même jeton
// diffèrent. rawKey est injectable (tests) ; par défaut process.env, lu à l'appel (pas à l'import).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(rawKey) {
  const raw = rawKey ?? process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY manquante : refus de stocker un jeton en clair.");
  const key = Buffer.from(String(raw), "base64");
  if (key.length !== 32) throw new Error("TOKEN_ENCRYPTION_KEY invalide : 32 octets en base64 attendus.");
  return key;
}

export function encryptSecret(plain, rawKey) {
  const key = loadKey(rawKey);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString("base64");
}

export function decryptSecret(payload, rawKey) {
  const key = loadKey(rawKey);
  const buf = Buffer.from(String(payload), "base64");
  if (buf.length < IV_BYTES + TAG_BYTES) throw new Error("Jeton chiffré invalide.");
  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const enc = buf.subarray(IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}
