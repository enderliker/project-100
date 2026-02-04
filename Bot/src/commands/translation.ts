import { createLogger } from "@project/shared";

const DEFAULT_TRANSLATE_URL = "https://libretranslate.de/translate";
const DEFAULT_TIMEOUT_MS = 8_000;
const logger = createLogger("discord");

export interface TranslateResult {
  translatedText: string;
  detectedSource?: string | null;
  provider: string;
}

export interface TranslateRequest {
  text: string;
  source: string | null;
  target: string;
}

function getTranslateUrl(): string {
  return process.env.TRANSLATE_API_URL?.trim() || DEFAULT_TRANSLATE_URL;
}

function getTranslateApiKey(): string | undefined {
  const key = process.env.TRANSLATE_API_KEY?.trim();
  return key || undefined;
}

export async function translateText(request: TranslateRequest): Promise<TranslateResult> {
  const url = getTranslateUrl();
  const apiKey = getTranslateApiKey();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        q: request.text,
        source: request.source ?? "auto",
        target: request.target,
        format: "text",
        ...(apiKey ? { api_key: apiKey } : {})
      }),
      signal: controller.signal
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Translate request failed (${response.status}): ${body}`);
    }

    const payload = (await response.json()) as {
      translatedText?: string;
      detectedLanguage?: { language?: string };
    };

    return {
      translatedText: payload.translatedText ?? "",
      detectedSource: payload.detectedLanguage?.language ?? null,
      provider: "libretranslate"
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`event=translate_failed message="${message}"`);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
