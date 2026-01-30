import { chromium, Browser, Page } from "playwright";

export interface BrowserScrapeResult {
  ok: boolean;
  url?: string;
  title?: string;
  text?: string;
  html?: string;
  error?: string;
}

const MAX_TEXT_LENGTH = 40000;
const MAX_HTML_LENGTH = 200000;

export async function scrapeWithBrowser(url: string): Promise<BrowserScrapeResult> {
  // Validate URL
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return { ok: false, error: "URL must use http or https protocol" };
    }
  } catch {
    // Try adding https:// if no protocol
    try {
      parsedUrl = new URL(`https://${url}`);
      url = parsedUrl.href;
    } catch {
      return { ok: false, error: "Invalid URL format" };
    }
  }

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

    // Navigate and wait for content
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("networkidle", { timeout: 45000 });
    await page.waitForTimeout(1200); // Extra time for JS to settle

    // Extract content
    const title = await page.title();
    const html = await page.content();
    const text = await page.evaluate(() => document.body?.innerText || "");

    await context.close();

    return {
      ok: true,
      url: page.url(),
      title: title.trim(),
      text: text.trim().slice(0, MAX_TEXT_LENGTH),
      html: html.slice(0, MAX_HTML_LENGTH),
    };
  } catch (error: any) {
    console.error("Browser scraping error:", error.message);
    
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
  }
}
