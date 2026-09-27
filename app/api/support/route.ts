import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MAX_BODY_BYTES = 24_576;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALLOWED_ORIGINS = new Set([
  "https://www.gowtrain.com",
  "https://gowtrain.com",
]);

if (process.env.NODE_ENV === "development") {
  ALLOWED_ORIGINS.add("http://localhost:3000");
  ALLOWED_ORIGINS.add("http://127.0.0.1:3000");
  ALLOWED_ORIGINS.add("http://localhost:8081");
}

class InvalidBodyError extends Error {}

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  /*
   * Native aanvragen hebben doorgaans geen Origin.
   * Dit is geen authenticatie: het formulier is openbaar.
   */
  return origin === null || ALLOWED_ORIGINS.has(origin);
}

function addHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Vary", "Origin");

  const origin = request.headers.get("origin");

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  return response;
}

function json(
  request: NextRequest,
  body: Record<string, unknown>,
  status = 200
): NextResponse {
  const response = NextResponse.json(body, { status });

  if (status === 429) {
    response.headers.set("Retry-After", "3600");
  }

  return addHeaders(request, response);
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) {
    throw new Error("Serverconfiguratie ontbreekt.");
  }

  return value;
}

function isObject(
  value: unknown
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

async function readBody(
  request: NextRequest
): Promise<string> {
  const contentType = request.headers
    .get("content-type")
    ?.split(";")[0]
    .trim()
    .toLowerCase();

  if (contentType !== "application/json" || !request.body) {
    throw new InvalidBodyError();
  }

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });

  let bytes = 0;
  let text = "";

  try {
    while (true) {
      const { done, value } = await reader.read();

      if (done) break;

      bytes += value.byteLength;

      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new InvalidBodyError();
      }

      text += decoder.decode(value, { stream: true });
    }

    text += decoder.decode();
  } catch {
    throw new InvalidBodyError();
  } finally {
    reader.releaseLock();
  }

  return text;
}

/* PREFLIGHT VOOR LOKAAL EXPO-WEB */

export function OPTIONS(
  request: NextRequest
): NextResponse {
  if (!originAllowed(request)) {
    return json(
      request,
      { code: "FORBIDDEN" },
      403
    );
  }

  const response = new NextResponse(null, { status: 204 });

  response.headers.set(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );

  response.headers.set(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  response.headers.set("Access-Control-Max-Age", "600");

  return addHeaders(request, response);
}

/* CONTACTBERICHT */

export async function POST(
  request: NextRequest
): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return json(
      request,
      {
        code: "FORBIDDEN",
        error:
          "Verstuur je bericht via het contactformulier op de website of in de app.",
      },
      403
    );
  }

  let forwarded = false;

  try {
    const body = await readBody(request);

    let parsed: unknown;

    try {
      parsed = JSON.parse(body);
    } catch {
      throw new InvalidBodyError();
    }

    if (
      !isObject(parsed) ||
      typeof parsed.submissionId !== "string" ||
      !UUID_PATTERN.test(parsed.submissionId)
    ) {
      throw new InvalidBodyError();
    }

    const submissionId = parsed.submissionId.toLowerCase();

    const secret = requiredEnv("SUPPORT_INTERNAL_SECRET");

    if (!/^[0-9a-f]{64}$/.test(secret)) {
      throw new Error("Ongeldige serverconfiguratie.");
    }

    const supabaseUrl = new URL(
      requiredEnv("NEXT_PUBLIC_SUPABASE_URL")
    );

    if (
      supabaseUrl.protocol !== "https:" ||
      supabaseUrl.username ||
      supabaseUrl.password ||
      supabaseUrl.search ||
      supabaseUrl.hash ||
      supabaseUrl.pathname !== "/"
    ) {
      throw new Error("Ongeldige Supabase-configuratie.");
    }

    const functionUrl = new URL(
      "/functions/v1/send-support-message",
      supabaseUrl
    );

    forwarded = true;

    const response = await fetch(functionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-support-internal-secret": secret,
      },
      body,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(35_000),
    });

    let result: unknown = null;

    try {
      result = await response.json();
    } catch {
      // Een verloren antwoord bewijst geen mislukte verzending.
    }

    if (
      response.ok &&
      isObject(result) &&
      result.accepted === true &&
      result.submissionId === submissionId
    ) {
      return json(request, {
        accepted: true,
        submissionId,
      });
    }

    const code =
      isObject(result) && typeof result.code === "string"
        ? result.code
        : "";

    if (response.status === 400 && code === "INVALID_INPUT") {
      return json(
        request,
        {
          code,
          error:
            "Controleer je e-mailadres, onderwerp en bericht. Gebruik maximaal 120 tekens voor het onderwerp en 5000 voor het bericht.",
        },
        400
      );
    }

    if (response.status === 429 && code === "RATE_LIMITED") {
      return json(
        request,
        {
          code,
          error:
            "Het formulier is tijdelijk begrensd. Probeer het over een uur opnieuw.",
        },
        429
      );
    }

    if (
      response.status === 409 &&
      code === "ALREADY_SUBMITTED"
    ) {
      return json(
        request,
        {
          code,
          error:
            "Deze inzending is al eerder gestart. We versturen niet opnieuw; controleer eerst of je al een reactie hebt ontvangen.",
        },
        409
      );
    }

    if (
      code === "DELIVERY_FAILED" ||
      code === "TEMPORARILY_UNAVAILABLE"
    ) {
      return json(
        request,
        {
          code,
          error:
            "Je bericht kon niet worden verzonden. Bewaar je tekst en probeer het later opnieuw.",
        },
        503
      );
    }

    return json(
      request,
      {
        code: "DELIVERY_UNCERTAIN",
        error:
          "We kunnen de verzending niet bevestigen. Je bericht kan al zijn verstuurd. Bewaar je inzendnummer en verstuur niet meteen opnieuw.",
      },
      503
    );
  } catch (error: unknown) {
    if (error instanceof InvalidBodyError) {
      return json(
        request,
        {
          code: "INVALID_INPUT",
          error: "De aanvraag is ongeldig of te groot.",
        },
        400
      );
    }

    return json(
      request,
      {
        code: forwarded
          ? "DELIVERY_UNCERTAIN"
          : "TEMPORARILY_UNAVAILABLE",
        error: forwarded
          ? "We kunnen de verzending niet bevestigen. Je bericht kan al zijn verstuurd. Bewaar je inzendnummer en verstuur niet meteen opnieuw."
          : "Het contactformulier is tijdelijk niet beschikbaar. Bewaar je tekst en probeer het later opnieuw.",
      },
      503
    );
  }
}