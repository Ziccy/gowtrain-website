export function requireCronSecret(
  request: Request
): Response | null {
  const expectedSecret = process.env.CRON_SECRET;
  const authorization = request.headers.get("authorization");

  if (
    !expectedSecret ||
    authorization !== `Bearer ${expectedSecret}`
  ) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401 }
    );
  }

  return null;
}