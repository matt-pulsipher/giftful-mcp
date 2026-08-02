import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { AsyncEntry } from "@napi-rs/keyring";

import type { AuthRecord } from "../giftful/types.js";

const CREDENTIAL_SERVICE = "com.giftful-mcp.session";

export interface CredentialStore {
  load(): Promise<AuthRecord | null>;
  save(record: AuthRecord): Promise<void>;
  clear(): Promise<void>;
  description(): string;
}

function validateRecord(value: unknown): AuthRecord {
  if (!value || typeof value !== "object") {
    throw new Error("Stored Giftful session is not an object.");
  }

  const record = value as Partial<AuthRecord>;
  if (
    record.schemaVersion !== 1 ||
    !record.refreshToken ||
    typeof record.refreshToken.id !== "number" ||
    typeof record.refreshToken.token !== "string" ||
    !record.user ||
    typeof record.user.id !== "number" ||
    typeof record.user.username !== "string"
  ) {
    throw new Error(
      "Stored Giftful session has an unsupported or invalid format.",
    );
  }
  return record as AuthRecord;
}

export class SystemCredentialStore implements CredentialStore {
  private readonly entry: AsyncEntry;

  constructor(private readonly profile: string) {
    this.entry = new AsyncEntry(CREDENTIAL_SERVICE, profile);
  }

  description(): string {
    const backend =
      process.platform === "darwin"
        ? "macOS Keychain"
        : process.platform === "win32"
          ? "Windows Credential Manager"
          : "system Secret Service";
    return `${backend} (service ${CREDENTIAL_SERVICE}, profile ${this.profile})`;
  }

  async load(): Promise<AuthRecord | null> {
    const stored = await this.entry.getPassword();
    if (!stored) return null;
    try {
      return validateRecord(JSON.parse(stored));
    } catch (error) {
      throw new Error(
        `Unable to decode Giftful session from the system credential store: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async save(record: AuthRecord): Promise<void> {
    await this.entry.setPassword(JSON.stringify(record));
  }

  async clear(): Promise<void> {
    await this.entry.deleteCredential();
  }
}

// Backwards-compatible export for code written against the first release.
export { SystemCredentialStore as KeychainCredentialStore };

export class FileCredentialStore implements CredentialStore {
  readonly path: string;

  constructor(profile: string, explicitPath?: string) {
    const defaultRoot = process.env.XDG_CONFIG_HOME
      ? resolve(process.env.XDG_CONFIG_HOME)
      : join(homedir(), ".config");
    this.path = explicitPath
      ? resolve(explicitPath)
      : join(defaultRoot, "giftful-mcp", `${profile}.json`);
  }

  description(): string {
    return `mode-0600 credential file (${this.path})`;
  }

  async load(): Promise<AuthRecord | null> {
    try {
      const raw = await readFile(this.path, "utf8");
      return validateRecord(JSON.parse(raw));
    } catch (error) {
      const nodeError = error as NodeJS.ErrnoException;
      if (nodeError.code === "ENOENT") return null;
      throw error;
    }
  }

  async save(record: AuthRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.path}.${process.pid}.tmp`;
    try {
      await writeFile(temporaryPath, `${JSON.stringify(record, null, 2)}\n`, {
        encoding: "utf8",
        mode: 0o600,
        flag: "w",
      });
      await chmod(temporaryPath, 0o600);
      await rename(temporaryPath, this.path);
      await chmod(this.path, 0o600);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
  }

  async clear(): Promise<void> {
    await unlink(this.path).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
    });
  }
}

export async function createCredentialStore(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<CredentialStore> {
  const profile = environment.GIFTFUL_PROFILE?.trim() || "default";
  const selected =
    environment.GIFTFUL_AUTH_STORAGE?.trim().toLowerCase() || "auto";

  if (
    !new Set(["auto", "system", "keyring", "keychain", "file"]).has(selected)
  ) {
    throw new Error(
      "GIFTFUL_AUTH_STORAGE must be auto, system, keyring, keychain, or file.",
    );
  }

  if (selected === "keychain" && process.platform !== "darwin") {
    throw new Error("Keychain storage was requested, but this is not macOS.");
  }
  if (selected !== "file") {
    return new SystemCredentialStore(profile);
  }
  return new FileCredentialStore(profile, environment.GIFTFUL_AUTH_FILE);
}
