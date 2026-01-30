import * as cheerio from "cheerio";

export interface ScrapeResult {
  success: boolean;
  content?: string;
  title?: string;
  url?: string;
  error?: string;
}

const USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function extractContentFromHtml(html: string): { content: string; title: string } {
  const $ = cheerio.load(html);

  $("script, style, noscript, iframe, svg, meta, link, [hidden], .hidden, [style*='display:none'], [style*='display: none']").remove();
  $("nav, header, footer, aside, .nav, .navbar, .sidebar, .footer, .header, .menu, .advertisement, .ads, .ad, [role='navigation'], [role='banner'], [role='contentinfo']").remove();

  const title = $("title").text().trim() || 
                $("h1").first().text().trim() || 
                $('meta[property="og:title"]').attr("content") || 
                "";

  const textParts: string[] = [];

  const prioritySelectors = ["article", "main", "[role='main']", ".content", ".post", ".entry", "#content", "#main"];
  let foundPriorityContent = false;

  for (const selector of prioritySelectors) {
    const elements = $(selector);
    if (elements.length > 0) {
      elements.each((_, el) => {
        const text = $(el).text().trim();
        if (text.length > 100) {
          textParts.push(text);
          foundPriorityContent = true;
        }
      });
      if (foundPriorityContent) break;
    }
  }

  if (!foundPriorityContent) {
    $("h1, h2, h3, h4, h5, h6").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 3) {
        textParts.push(`## ${text}`);
      }
    });

    $("p").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 20) {
        textParts.push(text);
      }
    });

    $("li").each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 10 && text.length < 500) {
        textParts.push(`- ${text}`);
      }
    });

    $("section, div").each((_, el) => {
      const $el = $(el);
      if ($el.children().length === 0) {
        const text = $el.text().trim();
        if (text.length > 30 && text.length < 1000) {
          textParts.push(text);
        }
      }
    });
  }

  let content = textParts
    .map(text => text.replace(/\s+/g, " ").trim())
    .filter(text => text.length > 0)
    .filter((text, index, arr) => arr.indexOf(text) === index)
    .join("\n\n");

  content = content.slice(0, 15000);

  return { content, title };
}

async function fetchWithRetry(url: string, retries = 2): Promise<Response> {
  let lastError: Error | null = null;
  
  for (let i = 0; i <= retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": USER_AGENT,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          "Cache-Control": "no-cache",
          "Pragma": "no-cache",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "none",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
        },
        redirect: "follow",
      });
      
      clearTimeout(timeout);
      return response;
    } catch (error: any) {
      lastError = error;
      if (i < retries) {
        await new Promise(resolve => setTimeout(resolve, 1000 * (i + 1)));
      }
    }
  }
  
  throw lastError;
}

export async function scrapeWebsite(url: string): Promise<ScrapeResult> {
  // Auto-add https:// if no protocol provided
  let normalizedUrl = url.trim();
  if (!normalizedUrl.match(/^https?:\/\//i)) {
    normalizedUrl = `https://${normalizedUrl}`;
  }

  try {
    new URL(normalizedUrl);
  } catch {
    return { success: false, error: "Invalid URL format" };
  }

  // Use normalizedUrl for the rest of the function
  url = normalizedUrl;

  try {
    let response: Response;
    
    try {
      response = await fetchWithRetry(url);
    } catch (fetchError: any) {
      if (fetchError.name === "AbortError") {
        return { success: false, error: "Website took too long to respond" };
      }
      if (fetchError.message?.includes("ENOTFOUND") || fetchError.message?.includes("getaddrinfo")) {
        return { success: false, error: "Website not found - check the URL" };
      }
      if (fetchError.message?.includes("ECONNREFUSED")) {
        return { success: false, error: "Website refused connection" };
      }
      if (fetchError.message?.includes("certificate") || fetchError.message?.includes("SSL") || fetchError.message?.includes("CERT")) {
        return { success: false, error: "Website has SSL certificate issues" };
      }
      return { success: false, error: `Failed to connect: ${fetchError.message}` };
    }

    const status = response.status;
    const finalUrl = response.url;

    if (status === 403 || status === 401) {
      return { success: false, error: "Website blocked our request" };
    }
    if (status === 404) {
      return { success: false, error: "Page not found (404)" };
    }
    if (status >= 500) {
      return { success: false, error: `Website server error (${status})` };
    }
    if (status >= 400) {
      return { success: false, error: `Website returned error (${status})` };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml")) {
      return { success: false, error: "URL does not point to an HTML page" };
    }

    const html = await response.text();

    if (!html || html.length < 100) {
      return { success: false, error: "Website returned empty or minimal content" };
    }

    const { content, title } = extractContentFromHtml(html);

    if (!content || content.length < 50) {
      const $ = cheerio.load(html);
      const bodyText = $("body").text().replace(/\s+/g, " ").trim().slice(0, 15000);
      
      if (bodyText.length < 50) {
        return { success: false, error: "No text content found on page" };
      }

      return {
        success: true,
        content: bodyText,
        title: title || "Untitled",
        url: finalUrl,
      };
    }

    return {
      success: true,
      content,
      title: title || "Untitled",
      url: finalUrl,
    };

  } catch (error: any) {
    console.error("Scraping error:", error.message);
    return { success: false, error: `Scraping failed: ${error.message}` };
  }
}
