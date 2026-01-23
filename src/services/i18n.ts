import { createHash } from "crypto";
import OpenAI from "openai";
import type { PrismaClient } from "@prisma/client";

const RULES_VERSION = "1";

const SUPPORTED_UI_LANGUAGES = ["en", "sw", "am", "so", "fr"] as const;
const SUPPORTED_TRANSLATION_LANGUAGES = [
  "en",
  "sw",
  "am",
  "so",
  "fr",
  "ar",
  "om",
  "ti",
  "rw",
  "lg",
] as const;

type UILanguage = (typeof SUPPORTED_UI_LANGUAGES)[number];
type TranslationLanguage = (typeof SUPPORTED_TRANSLATION_LANGUAGES)[number];

const FREE_DAILY_LIMIT = parseInt(
  process.env.TRANSLATION_FREE_DAILY_LIMIT || "200",
  10
);
const PRO_DAILY_LIMIT = parseInt(
  process.env.TRANSLATION_PRO_DAILY_LIMIT || "5000",
  10
);

const MAX_TEXT_LENGTH = 5000;

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
});

const AI_MODEL = process.env.AI_TRANSLATION_MODEL || "gpt-4o-mini";

function computeCacheKey(
  text: string,
  fromLang: string,
  toLang: string,
  mode: string
): string {
  const data = `${text}|${fromLang}|${toLang}|${mode}|${RULES_VERSION}`;
  return createHash("sha256").update(data).digest("hex");
}

function getUtcMidnight(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface DetectResult {
  lang: string;
}

export interface TranslateResult {
  from: string;
  to: string;
  translatedText: string;
  cached: boolean;
}

export interface TranslationQuotaError {
  error: "TRANSLATION_LIMIT_REACHED";
  limit: number;
  plan: string;
}

export function isValidUILanguage(lang: string): lang is UILanguage {
  return SUPPORTED_UI_LANGUAGES.includes(lang as UILanguage);
}

export function isValidTranslationLanguage(
  lang: string
): lang is TranslationLanguage {
  return SUPPORTED_TRANSLATION_LANGUAGES.includes(lang as TranslationLanguage);
}

export function getSupportedUILanguages(): readonly string[] {
  return SUPPORTED_UI_LANGUAGES;
}

export function getSupportedTranslationLanguages(): readonly string[] {
  return SUPPORTED_TRANSLATION_LANGUAGES;
}

export async function detectLanguage(
  text: string,
  prisma: PrismaClient
): Promise<DetectResult> {
  if (!text || text.length === 0) {
    return { lang: "und" };
  }

  const prompt = `Detect the language of the following text. Return ONLY the ISO 639-1 two-letter language code (e.g., "en", "sw", "am", "so", "fr", "ar", "om", "ti", "rw", "lg"). If you cannot determine the language, return "und".

Text: "${text.slice(0, 500)}"

Language code:`;

  try {
    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: 10,
      temperature: 0,
    });

    const detected = response.choices[0]?.message?.content?.trim().toLowerCase();
    if (detected && /^[a-z]{2,3}$/.test(detected)) {
      return { lang: detected };
    }
    return { lang: "und" };
  } catch (error) {
    console.error("Language detection error:", error instanceof Error ? error.message : "Unknown error");
    return { lang: "und" };
  }
}

export async function translate(
  text: string,
  to: string,
  prisma: PrismaClient,
  businessId: string,
  options: {
    from?: string;
    mode?: "plain" | "rich";
  } = {}
): Promise<TranslateResult | TranslationQuotaError> {
  const from = options.from || "auto";
  const mode = options.mode || "plain";

  if (!text || text.length === 0) {
    return { from, to, translatedText: "", cached: false };
  }

  if (text.length > MAX_TEXT_LENGTH) {
    throw new Error(`Text exceeds maximum length of ${MAX_TEXT_LENGTH} characters`);
  }

  if (!isValidTranslationLanguage(to)) {
    throw new Error(`Unsupported target language: ${to}`);
  }

  const cacheKey = computeCacheKey(text, from, to, mode);

  const cached = await prisma.translationCache.findUnique({
    where: { keyHash: cacheKey },
  });

  if (cached) {
    await prisma.translationCache.update({
      where: { keyHash: cacheKey },
      data: {
        hitCount: { increment: 1 },
        lastHitAt: new Date(),
      },
    });

    console.log(`Translation cache hit, keyHash=${cacheKey.slice(0, 8)}...`);

    return {
      from: cached.fromLang,
      to: cached.toLang,
      translatedText: cached.textTranslated,
      cached: true,
    };
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { plan: true },
  });

  if (!business) {
    throw new Error(`Business not found: ${businessId}`);
  }

  const plan = business.plan || "free";
  const dailyLimit = plan === "pro" ? PRO_DAILY_LIMIT : FREE_DAILY_LIMIT;
  const today = getUtcMidnight();

  const usage = await prisma.translationUsageDaily.upsert({
    where: {
      businessId_day: { businessId, day: today },
    },
    create: {
      businessId,
      day: today,
      count: 0,
    },
    update: {},
  });

  if (usage.count >= dailyLimit) {
    return {
      error: "TRANSLATION_LIMIT_REACHED",
      limit: dailyLimit,
      plan,
    };
  }

  let detectedFrom = from;
  if (from === "auto") {
    const detected = await detectLanguage(text, prisma);
    detectedFrom = detected.lang;
  }

  if (detectedFrom === to) {
    return { from: detectedFrom, to, translatedText: text, cached: false };
  }

  const modeInstruction =
    mode === "rich"
      ? "Preserve all formatting, HTML tags, markdown, and structure."
      : "Return plain text without any formatting.";

  const prompt = `Translate the following text from ${detectedFrom === "und" ? "the detected language" : detectedFrom} to ${to}.

IMPORTANT RULES:
1. Preserve all numbers, prices, phone numbers, SKUs, and names EXACTLY as they appear
2. ${modeInstruction}
3. Return ONLY the translated text, nothing else
4. If translation is impossible, return the original text

Text to translate:
${text}

Translation:`;

  try {
    const response = await openai.chat.completions.create({
      model: AI_MODEL,
      messages: [{ role: "user", content: prompt }],
      max_tokens: Math.min(text.length * 3, 4096),
      temperature: 0.3,
    });

    const translatedText =
      response.choices[0]?.message?.content?.trim() || text;

    await prisma.translationCache.create({
      data: {
        keyHash: cacheKey,
        fromLang: detectedFrom,
        toLang: to,
        textOriginal: text,
        textTranslated: translatedText,
      },
    });

    await prisma.translationUsageDaily.update({
      where: {
        businessId_day: { businessId, day: today },
      },
      data: {
        count: { increment: 1 },
      },
    });

    console.log(
      `Translation: ${detectedFrom}->${to}, len=${text.length}, cached=false`
    );

    return {
      from: detectedFrom,
      to,
      translatedText,
      cached: false,
    };
  } catch (error) {
    console.error("Translation error:", error instanceof Error ? error.message : "Unknown error");
    throw new Error("Translation failed");
  }
}

export function isQuotaError(
  result: TranslateResult | TranslationQuotaError
): result is TranslationQuotaError {
  return "error" in result && result.error === "TRANSLATION_LIMIT_REACHED";
}

export async function translateMessage(
  text: string,
  businessId: string,
  prisma: PrismaClient,
  direction: "incoming" | "outgoing"
): Promise<{
  textOriginal: string;
  langOriginal: string;
  textTranslated: string | null;
  langTranslated: string | null;
  translationStatus: "none" | "done" | "failed";
  translationError: string | null;
}> {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      autoTranslateIncoming: true,
      autoTranslateOutgoing: true,
      incomingTranslateTo: true,
      outgoingTranslateTo: true,
    },
  });

  if (!business) {
    return {
      textOriginal: text,
      langOriginal: "und",
      textTranslated: null,
      langTranslated: null,
      translationStatus: "none",
      translationError: "Business not found",
    };
  }

  const detected = await detectLanguage(text, prisma);
  const langOriginal = detected.lang;

  const shouldTranslate =
    direction === "incoming"
      ? business.autoTranslateIncoming
      : business.autoTranslateOutgoing;

  const targetLang =
    direction === "incoming"
      ? business.incomingTranslateTo
      : business.outgoingTranslateTo;

  if (!shouldTranslate || langOriginal === targetLang) {
    return {
      textOriginal: text,
      langOriginal,
      textTranslated: null,
      langTranslated: null,
      translationStatus: "none",
      translationError: null,
    };
  }

  try {
    const result = await translate(text, targetLang, prisma, businessId, {
      from: langOriginal,
    });

    if (isQuotaError(result)) {
      return {
        textOriginal: text,
        langOriginal,
        textTranslated: null,
        langTranslated: null,
        translationStatus: "failed",
        translationError: `Quota exceeded: ${result.limit} translations/day (${result.plan} plan)`,
      };
    }

    return {
      textOriginal: text,
      langOriginal,
      textTranslated: result.translatedText,
      langTranslated: result.to,
      translationStatus: "done",
      translationError: null,
    };
  } catch (error) {
    return {
      textOriginal: text,
      langOriginal,
      textTranslated: null,
      langTranslated: null,
      translationStatus: "failed",
      translationError: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
