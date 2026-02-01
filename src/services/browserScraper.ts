import { chromium, Browser, Page } from "playwright";
import * as fs from "fs";

export interface ScrapeResult {
  ok: boolean;
  url?: string;
  finalUrl?: string;
  title?: string;
  metaDescription?: string;
  text?: string;
  html?: string;
  modeUsed?: 'fetch' | 'playwright';
  error?: string;
  isServerError?: boolean;
}

const MAX_TEXT_LENGTH = 40000;
const MAX_HTML_LENGTH = 200000;
const FETCH_TIMEOUT = 10000;
const PLAYWRIGHT_TIMEOUT = 25000;

// Concurrency guard - max 2 concurrent Playwright renders
let activePlaywrightCount = 0;
const MAX_CONCURRENT_PLAYWRIGHT = 2;
const playwrightQueue: Array<{ resolve: () => void }> = [];

async function acquirePlaywrightSlot(): Promise<void> {
  if (activePlaywrightCount < MAX_CONCURRENT_PLAYWRIGHT) {
    activePlaywrightCount++;
    return;
  }
  return new Promise<void>((resolve) => {
    playwrightQueue.push({ resolve });
  });
}

function releasePlaywrightSlot(): void {
  activePlaywrightCount--;
  if (playwrightQueue.length > 0 && activePlaywrightCount < MAX_CONCURRENT_PLAYWRIGHT) {
    const next = playwrightQueue.shift();
    if (next) {
      activePlaywrightCount++;
      next.resolve();
    }
  }
}

export function checkPlaywrightInstallation(): { installed: boolean; executablePath: string | null; error?: string } {
  try {
    const execPath = chromium.executablePath();
    const exists = fs.existsSync(execPath);
    return {
      installed: exists,
      executablePath: execPath,
      error: exists ? undefined : `Executable not found at: ${execPath}`
    };
  } catch (err: any) {
    return {
      installed: false,
      executablePath: null,
      error: err.message
    };
  }
}

function isLikelyJsShell(html: string, text: string): boolean {
  const htmlLength = html.length;
  const textLength = text.trim().length;
  
  if (htmlLength === 0) return false;
  
  const textRatio = textLength / htmlLength;
  const hasReactRoot = html.includes('id="root"') || html.includes('id="app"') || html.includes('id="__next"');
  const hasLowContent = textLength < 200;
  const hasScriptTags = (html.match(/<script/gi) || []).length > 3;
  
  return (textRatio < 0.05 && hasScriptTags) || (hasReactRoot && hasLowContent);
}

function extractMetaDescription(html: string): string | undefined {
  const match = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                html.match(/<meta[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  return match?.[1]?.trim();
}

function extractTitle(html: string): string | undefined {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match?.[1]?.trim();
}

async function fetchWithTimeout(url: string, timeout: number): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scrapeWithFetch(url: string): Promise<ScrapeResult & { html: string; isJsShell: boolean }> {
  try {
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT);
    
    if (!response.ok) {
      return { 
        ok: false, 
        error: `HTTP ${response.status}: ${response.statusText}`,
        html: '',
        isJsShell: false
      };
    }
    
    const html = await response.text();
    const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
                     .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
                     .replace(/<[^>]+>/g, ' ')
                     .replace(/\s+/g, ' ')
                     .trim();
    
    const title = extractTitle(html);
    const metaDescription = extractMetaDescription(html);
    const isJsShell = isLikelyJsShell(html, text);
    
    return {
      ok: true,
      url,
      finalUrl: response.url,
      title,
      metaDescription,
      text: text.slice(0, MAX_TEXT_LENGTH),
      html: html.slice(0, MAX_HTML_LENGTH),
      modeUsed: 'fetch',
      isJsShell,
    };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { ok: false, error: 'Fetch timeout', html: '', isJsShell: false };
    }
    return { ok: false, error: error.message, html: '', isJsShell: false };
  }
}

async function scrapeWithPlaywright(url: string): Promise<ScrapeResult> {
  await acquirePlaywrightSlot();
  
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    });

    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    const page: Page = await context.newPage();

    // Block images, fonts, and media for speed
    await page.route('**/*', (route) => {
      const resourceType = route.request().resourceType();
      if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
        route.abort();
      } else {
        route.continue();
      }
    });

    await page.goto(url, { waitUntil: "networkidle", timeout: PLAYWRIGHT_TIMEOUT });

    const title = await page.title();
    const finalUrl = page.url();
    const html = await page.content();
    const text = await page.evaluate(() => document.body?.innerText || "");
    const metaDescription = await page.evaluate(() => {
      const meta = document.querySelector('meta[name="description"]');
      return meta?.getAttribute('content') || undefined;
    });

    await context.close();

    return {
      ok: true,
      url,
      finalUrl,
      title: title.trim(),
      metaDescription,
      text: text.trim().slice(0, MAX_TEXT_LENGTH),
      html: html.slice(0, MAX_HTML_LENGTH),
      modeUsed: 'playwright',
    };
  } catch (error: any) {
    console.error("Browser scraping error:", error.message);
    
    if (error.message?.includes("Executable doesn't exist") || 
        error.message?.includes("browserType.launch") ||
        error.message?.includes("Failed to launch")) {
      return { 
        ok: false, 
        error: `Browser launch failed: ${error.message}`,
        isServerError: true 
      };
    }
    
    if (error.message?.includes("Timeout")) {
      return { ok: false, error: "Page took too long to load" };
    }
    if (error.message?.includes("net::ERR_NAME_NOT_RESOLVED")) {
      return { ok: false, error: "Website not found - check the URL" };
    }
    if (error.message?.includes("net::ERR_CONNECTION_REFUSED")) {
      return { ok: false, error: "Website refused connection" };
    }
    
    return { ok: false, error: `Scraping failed: ${error.message}` };
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    releasePlaywrightSlot();
  }
}

export async function scrapeWebsite(url: string, forcePlaywright: boolean = false): Promise<ScrapeResult> {
  // Validate URL
  let normalizedUrl: string;
  try {
    const parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { ok: false, error: "URL must use http or https protocol" };
    }
    normalizedUrl = parsedUrl.href;
  } catch {
    try {
      const parsedUrl = new URL(`https://${url}`);
      normalizedUrl = parsedUrl.href;
    } catch {
      return { ok: false, error: "Invalid URL format" };
    }
  }

  // If forcePlaywright requested, go straight to Playwright
  if (forcePlaywright) {
    return scrapeWithPlaywright(normalizedUrl);
  }

  // Try fast fetch first
  const fetchResult = await scrapeWithFetch(normalizedUrl);
  
  // If fetch failed completely, try Playwright
  if (!fetchResult.ok) {
    console.log(`Fetch failed for ${normalizedUrl}, trying Playwright: ${fetchResult.error}`);
    return scrapeWithPlaywright(normalizedUrl);
  }
  
  // If JS shell detected, use Playwright for full rendering
  if (fetchResult.isJsShell) {
    console.log(`JS shell detected for ${normalizedUrl}, using Playwright`);
    return scrapeWithPlaywright(normalizedUrl);
  }
  
  // Fetch was successful and not a JS shell
  const { isJsShell, ...result } = fetchResult;
  return result;
}

// Legacy export for backward compatibility
export async function scrapeWithBrowser(url: string): Promise<ScrapeResult> {
  return scrapeWebsite(url, true);
}
