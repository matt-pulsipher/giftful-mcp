import { access, mkdtemp, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { delimiter, join } from "node:path";

import { chromium, type BrowserContext, type Page } from "playwright-core";

import type { RefreshToken } from "../giftful/types.js";

const GIFTFUL_LOGIN_URL = "https://giftful.com/login";
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function executableCandidates(environment: NodeJS.ProcessEnv): string[] {
  const configured = environment.GIFTFUL_BROWSER_EXECUTABLE?.trim();
  const candidates = configured ? [configured] : [];

  if (process.platform === "darwin") {
    const applicationRoots = ["/Applications", join(homedir(), "Applications")];
    for (const root of applicationRoots) {
      candidates.push(
        join(root, "Google Chrome.app/Contents/MacOS/Google Chrome"),
        join(root, "Microsoft Edge.app/Contents/MacOS/Microsoft Edge"),
        join(root, "Brave Browser.app/Contents/MacOS/Brave Browser"),
        join(root, "Chromium.app/Contents/MacOS/Chromium"),
      );
    }
  } else if (process.platform === "win32") {
    const roots = [
      environment.PROGRAMFILES,
      environment["PROGRAMFILES(X86)"],
      environment.LOCALAPPDATA,
    ].filter((value): value is string => Boolean(value));
    for (const root of roots) {
      candidates.push(
        join(root, "Google", "Chrome", "Application", "chrome.exe"),
        join(root, "Microsoft", "Edge", "Application", "msedge.exe"),
        join(
          root,
          "BraveSoftware",
          "Brave-Browser",
          "Application",
          "brave.exe",
        ),
      );
    }
  } else {
    const names = [
      "google-chrome",
      "google-chrome-stable",
      "microsoft-edge",
      "microsoft-edge-stable",
      "brave-browser",
      "chromium",
      "chromium-browser",
    ];
    for (const directory of (environment.PATH ?? "")
      .split(delimiter)
      .filter(Boolean)) {
      for (const name of names) candidates.push(join(directory, name));
    }
    candidates.push(
      "/usr/bin/google-chrome",
      "/usr/bin/microsoft-edge",
      "/usr/bin/brave-browser",
      "/usr/bin/chromium",
      "/usr/bin/chromium-browser",
    );
  }

  return [...new Set(candidates)];
}

async function findBrowserExecutable(
  environment: NodeJS.ProcessEnv,
): Promise<string> {
  for (const candidate of executableCandidates(environment)) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Continue through the supported browser locations.
    }
  }

  throw new Error(
    "No supported browser was found. Install Chrome, Edge, Brave, or Chromium, or set GIFTFUL_BROWSER_EXECUTABLE to its executable path.",
  );
}

function parseTimeout(environment: NodeJS.ProcessEnv): number {
  const configured = environment.GIFTFUL_BROWSER_LOGIN_TIMEOUT_MS;
  if (!configured) return DEFAULT_TIMEOUT_MS;
  const timeout = Number(configured);
  if (!Number.isSafeInteger(timeout) || timeout <= 0) {
    throw new Error(
      "GIFTFUL_BROWSER_LOGIN_TIMEOUT_MS must be a positive integer.",
    );
  }
  return timeout;
}

function isGiftfulPage(page: Page): boolean {
  try {
    const hostname = new URL(page.url()).hostname;
    return hostname === "giftful.com" || hostname.endsWith(".giftful.com");
  } catch {
    return false;
  }
}

function parseRefreshToken(raw: string | null): RefreshToken | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<RefreshToken>;
    if (
      typeof value.id !== "number" ||
      !Number.isSafeInteger(value.id) ||
      typeof value.token !== "string" ||
      value.token.length === 0
    ) {
      return null;
    }
    return { id: value.id, token: value.token };
  } catch {
    return null;
  }
}

async function readRefreshToken(
  context: BrowserContext,
): Promise<RefreshToken | null> {
  for (const page of context.pages()) {
    if (!isGiftfulPage(page)) continue;
    try {
      const raw = await page.evaluate(() =>
        localStorage.getItem("refreshToken"),
      );
      const token = parseRefreshToken(raw);
      if (token) return token;
    } catch {
      // Navigation can destroy an execution context; the next poll will retry.
    }
  }
  return null;
}

export async function captureGiftfulBrowserSession(
  environment: NodeJS.ProcessEnv = process.env,
): Promise<RefreshToken> {
  const executablePath = await findBrowserExecutable(environment);
  const timeoutMs = parseTimeout(environment);
  const profileDirectory = await mkdtemp(join(tmpdir(), "giftful-mcp-login-"));
  let context: BrowserContext | undefined;
  let browserClosed = false;

  try {
    context = await chromium.launchPersistentContext(profileDirectory, {
      executablePath,
      headless: false,
      viewport: null,
    });
    context.on("close", () => {
      browserClosed = true;
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(GIFTFUL_LOGIN_URL, { waitUntil: "domcontentloaded" });

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const refreshToken = await readRefreshToken(context);
      if (refreshToken) return refreshToken;
      if (browserClosed)
        throw new Error(
          "The login browser was closed before Giftful signed in.",
        );
      await new Promise((resolve) => setTimeout(resolve, 750));
    }
    throw new Error(
      `Timed out after ${Math.round(timeoutMs / 1000)} seconds waiting for Giftful login.`,
    );
  } finally {
    await context?.close().catch(() => undefined);
    await rm(profileDirectory, { recursive: true, force: true, maxRetries: 3 });
  }
}
