#!/usr/bin/env node
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";

import { createCredentialStore } from "./auth/storage.js";
import { captureGiftfulBrowserSession } from "./auth/browser-login.js";
import { GiftfulClient } from "./giftful/client.js";

function readHiddenPassword(prompt: string): Promise<string> {
  const fromEnvironment = process.env.GIFTFUL_PASSWORD;
  if (fromEnvironment !== undefined) {
    delete process.env.GIFTFUL_PASSWORD;
    return Promise.resolve(fromEnvironment);
  }
  if (!stdin.isTTY || !stdout.isTTY || typeof stdin.setRawMode !== "function") {
    throw new Error(
      "A TTY is required for hidden password entry. For non-interactive login, set GIFTFUL_PASSWORD for this command only.",
    );
  }

  stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let password = "";
    const wasRaw = stdin.isRaw;

    const cleanup = () => {
      stdin.off("data", onData);
      stdin.setRawMode(Boolean(wasRaw));
      stdin.pause();
    };
    const onData = (buffer: Buffer) => {
      for (const byte of buffer) {
        if (byte === 3) {
          cleanup();
          stdout.write("\n");
          reject(new Error("Login cancelled."));
          return;
        }
        if (byte === 10 || byte === 13) {
          cleanup();
          stdout.write("\n");
          resolve(password);
          return;
        }
        if (byte === 8 || byte === 127) {
          password = password.slice(0, -1);
        } else {
          password += String.fromCharCode(byte);
        }
      }
    };

    stdin.setRawMode(true);
    stdin.resume();
    stdin.on("data", onData);
  });
}

function printHelp(): void {
  console.log(`Giftful MCP authentication

Usage:
  giftful-auth login [username-or-email]
  giftful-auth login-browser
  giftful-auth status [--validate]
  giftful-auth logout

From this source checkout:
  npm run auth -- login [username-or-email]
  npm run auth -- login-browser

The password is never stored. The refresh token is kept in the platform's
system credential manager by default. Set GIFTFUL_PROFILE for multiple accounts.`);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? "help";
  const store = await createCredentialStore();
  const client = new GiftfulClient(store);

  if (command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }
  if (command === "status") {
    const status = await client.authStatus(process.argv.includes("--validate"));
    console.log(JSON.stringify(status, null, 2));
    return;
  }
  if (command === "logout") {
    await client.logout();
    console.log("Logged out; the persistent Giftful session was removed.");
    return;
  }
  if (
    command === "login-browser" ||
    command === "login-apple" ||
    (command === "login" && process.argv.includes("--browser")) ||
    (command === "login" && process.argv.includes("--apple"))
  ) {
    console.log(
      "Opening a temporary browser profile. Complete your preferred sign-in flow on Giftful; this command never sees your identity-provider password or verification codes.",
    );
    const refreshToken = await captureGiftfulBrowserSession();
    console.log(
      "Giftful login detected. Validating and storing the session...",
    );
    const user = await client.importRefreshToken(refreshToken);
    console.log(
      `Logged in as @${user.username}. Session stored in ${client.storageDescription()}.`,
    );
    return;
  }
  if (command === "login") {
    let username = process.argv[3];
    if (!username) {
      const readline = createInterface({ input: stdin, output: stdout });
      username = (
        await readline.question("Giftful username or email: ")
      ).trim();
      readline.close();
    }
    if (!username) throw new Error("A username or email is required.");
    const password = await readHiddenPassword("Giftful password: ");
    if (!password) throw new Error("A password is required.");
    try {
      const user = await client.login(username, password);
      console.log(
        `Logged in as @${user.username}. Session stored in ${client.storageDescription()}.`,
      );
    } finally {
      // The only password reference is released after this block; it is never written to disk.
    }
    return;
  }

  throw new Error(`Unknown command: ${command}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
