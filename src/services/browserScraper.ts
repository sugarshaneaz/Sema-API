import * as cheerio from "cheerio";

export interface ScrapeResult {
  ok: boolean;
  url?: string;
  finalUrl?: string;
  title?: string;
  metaDescription?: string;
  text?: string;
  html?: string;
  modeUsed?: 'fetch' | 'cheerio';
  error?: string;
  isServerError?: boolean;
}

const MAX_TEXT_LENGTH = 8000;
const FETCH_TIMEOUT = 15000;

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
    
    // Remove non-content elements
    $('script, style, nav, footer, header, aside, noscript, iframe, form, button, input, svg, [role="navigation"], [role="banner"], [role="contentinfo"]').remove();
    
    // Get title
    const title = $('title').text().trim() || $('h1').first().text().trim();
    
    // Get meta description
    const metaDescription = $('meta[name="description"]').attr('content')?.trim();
    
    // Get main content
    let content = '';
    const mainSelectors = ['main', 'article', '[role="main"]', '.content', '.main-content', '#content', '#main'];
    
    for (const selector of mainSelectors) {
      if ($(selector).length) {
        content = $(selector).text();
        break;
      }
    }
    
    // Fallback to body
    if (!content) {
      content = $('body').text();
    }
    
    // Clean up whitespace
    content = content
      .replace(/\s+/g, ' ')
      .replace(/\n\s*\n/g, '\n')
      .trim()
      .slice(0, MAX_TEXT_LENGTH);
    
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
    if (error.name === 'AbortError') {
      return { ok: false, error: 'Request timeout - page took too long to load' };
    }
    if (error.message?.includes('ENOTFOUND') || error.message?.includes('ERR_NAME_NOT_RESOLVED')) {
      return { ok: false, error: 'Website not found - check the URL' };
    }
    if (error.message?.includes('ECONNREFUSED')) {
      return { ok: false, error: 'Website refused connection' };
    }
    return { ok: false, error: `Scraping failed: ${error.message}` };
  }
}

export async function scrapeWebsite(url: string, _forcePlaywright: boolean = false): Promise<ScrapeResult> {
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

  return scrapeWithCheerio(normalizedUrl);
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
