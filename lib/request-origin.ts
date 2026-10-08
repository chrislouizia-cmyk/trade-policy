// Request.url may use the internal Next.js hostname behind a proxy. The Host
// header identifies the requested public host; forwarding supplies its scheme.
export function isSameRequestOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  if (!origin) return true;
  try {
    const url = new URL(request.url);
    const host = request.headers.get("host") ?? url.host;
    const protocol = (
      request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "")
    )
      .split(",")[0]
      .trim();
    if (protocol !== "http" && protocol !== "https") return false;
    return (
      new URL(origin).origin === new URL(`${protocol}://${host}`).origin &&
      new URL(origin).origin === origin
    );
  } catch {
    return false;
  }
}
