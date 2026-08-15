import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

import { serverEnv } from "@/lib/env";

export interface EncryptedSecret {
  ciphertext: Uint8Array;
  initializationVector: Uint8Array;
  authenticationTag: Uint8Array;
  keyVersion: number;
}

function getEncryptionKey(): Buffer {
  if (!serverEnv.INTEGRATION_ENCRYPTION_KEY) {
    throw new Error("INTEGRATION_ENCRYPTION_KEY is not configured.");
  }

  const key = Buffer.from(serverEnv.INTEGRATION_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error(
      "INTEGRATION_ENCRYPTION_KEY must be a base64-encoded 32-byte AES-256 key.",
    );
  }

  return key;
}

export function encryptIntegrationSecret(plaintext: string): EncryptedSecret {
  const initializationVector = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    initializationVector,
  );
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

  return {
    ciphertext,
    initializationVector,
    authenticationTag: cipher.getAuthTag(),
    keyVersion: 1,
  };
}

export function decryptIntegrationSecret(secret: EncryptedSecret): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    getEncryptionKey(),
    secret.initializationVector,
  );
  decipher.setAuthTag(Buffer.from(secret.authenticationTag));
  return Buffer.concat([
    decipher.update(secret.ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
