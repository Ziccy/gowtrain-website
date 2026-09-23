import { NextRequest, NextResponse } from "next/server";

const ALLOWED_ORIGINS = new Set([
  "https://www.gowtrain.com",
  "https://gowtrain.com",
  "http://localhost:8081",
]);

type Handler = (
  request: NextRequest
) => Promise<NextResponse>;

function originAllowed(request: NextRequest): boolean {
  const origin = request.headers.get("origin");

  // Native requests bevatten doorgaans geen Origin.
  // De bestaande Bearer-tokencontrole blijft verplicht.
  return origin === null || ALLOWED_ORIGINS.has(origin);
}

function addHeaders(
  request: NextRequest,
  response: NextResponse
): NextResponse {
  const origin = request.headers.get("origin");

  response.headers.set("Cache-Control", "no-store");

  const vary = response.headers.get("Vary");
  const values = vary
    ? vary.split(",").map((value) => value.trim())
    : [];

  if (!values.some((value) => value.toLowerCase() === "origin")) {
    values.push("Origin");
    response.headers.set("Vary", values.join(", "));
  }

  if (origin && ALLOWED_ORIGINS.has(origin)) {
    response.headers.set("Access-Control-Allow-Origin", origin);
  }

  return response;
}

export function connectOptions(
  request: NextRequest
): NextResponse {
  if (!originAllowed(request)) {
    return addHeaders(
      request,
      NextResponse.json(
        { error: "Deze oorsprong is niet toegestaan." },
        { status: 403 }
      )
    );
  }

  const response = new NextResponse(null, { status: 204 });

  response.headers.set(
    "Access-Control-Allow-Methods",
    "POST, OPTIONS"
  );
  response.headers.set(
    "Access-Control-Allow-Headers",
    "Authorization, Content-Type"
  );
  response.headers.set("Access-Control-Max-Age", "600");

  return addHeaders(request, response);
}

export async function withConnectCors(
  request: NextRequest,
  handler: Handler
): Promise<NextResponse> {
  if (!originAllowed(request)) {
    return addHeaders(
      request,
      NextResponse.json(
        { error: "Deze oorsprong is niet toegestaan." },
        { status: 403 }
      )
    );
  }

  try {
    const response = await handler(request);
    return addHeaders(request, response);
  } catch {
    // Geen tokens of onboardinglinks loggen.
    return addHeaders(
      request,
      NextResponse.json(
        {
          error:
            "De Connect-aanvraag kon niet worden bevestigd. Controleer de bestaande status voordat je opnieuw probeert.",
        },
        { status: 503 }
      )
    );
  }
}