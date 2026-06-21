// Best-effort fetch of a product page's preview image (og:image / twitter:image).
export async function fetchOgImage(url: string): Promise<string | null> {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    const res = await fetch(u.toString(), {
      headers: {
        // Pretend to be a normal browser so retailers serve real HTML.
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      // Don't hang forever on a slow store.
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const html = (await res.text()).slice(0, 600_000);

    const candidates = [
      /<meta[^>]+property=["']og:image:secure_url["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']og:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    ];
    for (const re of candidates) {
      const m = html.match(re);
      if (m && m[1]) return absolutize(m[1], u);
    }
    // Fallback: first reasonably-sized <img>.
    const img = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (img && img[1]) return absolutize(img[1], u);
    return null;
  } catch {
    return null;
  }
}

function absolutize(src: string, base: URL): string {
  try {
    return new URL(src, base).toString();
  } catch {
    return src;
  }
}
