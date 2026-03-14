import * as cheerio from "cheerio";

export interface ScrapeResult {
  ok: boolean;
  url?: string;
  finalUrl?: string;
  title?: string;
  metaDescription?: string;
  text?: string;
  html?: string;
  modeUsed?: 'fetch' | 'cheerio' | 'jina';
  error?: string;
  isServerError?: boolean;
}

const MAX_TEXT_LENGTH = 8000;
const FETCH_TIMEOUT = 20000;

async function fetchWithTimeout(url: string, timeout: number, headers: Record<string, string> = {}): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        ...headers,
      },
      redirect: 'follow',
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function scrapeWithCheerio(url: string): Promise<ScrapeResult> {
  try {
    const response = await fetchWithTimeout(url, FETCH_TIMEOUT);

    if (!response.ok) {
      return {
        ok: false,
        error: `Failed to fetch: ${response.status} ${response.statusText}`,
      };
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    $('script, style, nav, footer, header, aside, noscript, iframe, form, button, input, svg, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();

    const title = $('title').text().trim() || $('h1').first().text().trim();
    const metaDescription = $('meta[name="description"]').attr('content')?.trim();

    let content = '';
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '.main-content', '#content', '#main'];

    for (const selector of mainSelectors) {
      if ($(selector).length) {
        content = $(selector).text();
        break;
      }
    }

    if (!content) {
      content = $('body').text();
    }

    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()
      .slice(0, MAX_TEXT_LENGTH);

    if (content.length < 50) {
      return { ok: false, error: 'No readable content found on page' };
    }

    return {
      ok: true,
      url,
      finalUrl: response.url,
      title,
      metaDescription,
      text: content,
      html: html.slice(0, 50000),
      modeUsed: 'cheerio',
    };
  } catch (error: any) {
    const cause = error?.cause?.message || error?.cause?.code || '';
    const msg = error.message || '';

    if (error.name === 'AbortError') {
      return { ok: false, error: 'Request timeout - page took too long to load' };
    }
    if (msg.includes('ENOTFOUND') || msg.includes('ERR_NAME_NOT_RESOLVED') || cause.includes('ENOTFOUND')) {
      return { ok: false, error: 'Website not found - check the URL' };
    }
    if (msg.includes('ECONNREFUSED') || cause.includes('ECONNREFUSED')) {
      return { ok: false, error: 'Website refused connection' };
    }
    if (msg.includes('certificate') || msg.includes('SSL') || msg.includes('CERT') || cause.includes('CERT') || cause.includes('certificate') || cause.includes('unsuitable')) {
      console.error('[scraper] SSL error:', msg, cause);
      return { ok: false, error: `fetch_failed:${msg}` };
    }

    console.error('[scraper] direct fetch failed:', msg, cause ? `(cause: ${cause})` : '');
    return { ok: false, error: `fetch_failed:${msg}` };
  }
}

async function scrapeWithProxy(url: string): Promise<ScrapeResult> {
  const proxyUrl = `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`;
  try {
    const response = await fetchWithTimeout(proxyUrl, FETCH_TIMEOUT, {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    });

    if (!response.ok) {
      return { ok: false, error: `Proxy fetch failed: ${response.status}` };
    }

    const html = await response.text();
    if (!html || html.length < 100) {
      return { ok: false, error: 'No content returned from proxy' };
    }

    const $ = cheerio.load(html);
    $('script, style, nav, footer, header, aside, noscript, iframe, form, button, input, svg, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();

    const title = $('title').text().trim() || $('h1').first().text().trim();
    const metaDescription = $('meta[name="description"]').attr('content')?.trim();

    let content = '';
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '.main-content', '#content', '#main'];
    for (const selector of mainSelectors) {
      if ($(selector).length) {
        content = $(selector).text();
        break;
      }
    }
    if (!content) content = $('body').text();

    content = content.replace(/\s+/g, ' ').replace(/\n\s*\n/g, '\n').trim().slice(0, MAX_TEXT_LENGTH);

    if (content.length < 50) {
      return { ok: false, error: 'No readable content found via proxy' };
    }

    return {
      ok: true,
      url,
      finalUrl: url,
      title,
      metaDescription,
      text: content,
      modeUsed: 'cheerio',
    };
  } catch (error: any) {
    const msg = error.message || '';
    if (error.name === 'AbortError') {
      return { ok: false, error: 'Proxy request timed out' };
    }
    console.error('[scraper] proxy fallback failed:', msg);
    return { ok: false, error: `Proxy failed: ${msg}` };
  }
}

export async function scrapeWebsite(url: string, _forcePlaywright: boolean = false): Promise<ScrapeResult> {
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

  // Try direct scrape first
  const directResult = await scrapeWithCheerio(normalizedUrl);
  if (directResult.ok) {
    return directResult;
  }

  // If direct fetch failed (network error, blocked, JS-rendered, etc.), try proxy fallback
  const shouldTryProxy =
    directResult.error?.startsWith('fetch_failed') ||
    directResult.error?.includes('No readable content') ||
    directResult.error?.includes('timeout') ||
    directResult.error?.includes('refused') ||
    directResult.error?.includes('SSL');

  if (shouldTryProxy) {
    console.log(`[scraper] direct failed (${directResult.error}), trying proxy for ${normalizedUrl}`);
    const proxyResult = await scrapeWithProxy(normalizedUrl);
    if (proxyResult.ok) {
      return proxyResult;
    }
    console.log(`[scraper] proxy also failed (${proxyResult.error})`);
    // Return the friendliest error message
    const directMsg = directResult.error?.replace('fetch_failed:', 'Failed to connect: ') || '';
    return { ok: false, error: directMsg || proxyResult.error || 'Failed to scrape website' };
  }

  return directResult;
}

// Legacy exports for backward compatibility
export async function scrapeWithBrowser(url: string): Promise<ScrapeResult> {
  return scrapeWebsite(url);
}

export function checkPlaywrightInstallation(): { installed: boolean; executablePath: string | null; error?: string } {
  return {
    installed: false,
    executablePath: null,
    error: "Playwright removed - using cheerio instead"
  };
}
