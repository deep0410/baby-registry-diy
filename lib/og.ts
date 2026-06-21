// Best-effort scrape of a product page for { imageUrl, price, title }.
// Tries structured data (JSON-LD), Open Graph / Twitter meta, then
// retailer-specific patterns (Amazon). Filters out tracking/beacon URLs.

export interface ProductInfo {
  imageUrl: string | null;
  price: string | null; // display-ready, e.g. "$129.99"
  title: string | null;
}

export async function fetchProductInfo(url: string): Promise<ProductInfo> {
  const empty: ProductInfo = { imageUrl: null, price: null, title: null };
  let base: URL;
  try {
    base = new URL(url);
    if (base.protocol !== "http:" && base.protocol !== "https:") return empty;
  } catch {
    return empty;
  }

  let html = "";
  try {
    const res = await fetch(base.toString(), {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return empty;
    html = (await res.text()).slice(0, 1_500_000);
  } catch {
    return empty;
  }

  const fromJsonLd = parseJsonLd(html, base);
  const imageUrl =
    fromJsonLd.imageUrl ||
    pickImage(
      [
        metaContent(html, "og:image:secure_url"),
        metaContent(html, "og:image"),
        metaContent(html, "twitter:image"),
        metaContent(html, "twitter:image:src"),
        linkHref(html, "image_src"),
        amazonDynamicImage(html),
        amazonAttr(html, "data-old-hires"),
        firstContentImage(html),
      ],
      base
    );

  const price =
    fromJsonLd.price ||
    fromMetaPrice(html) ||
    amazonPrice(html) ||
    genericPrice(html);

  const title =
    fromJsonLd.title ||
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    tagText(html, "title");

  return {
    imageUrl: imageUrl || null,
    price: price || null,
    title: title ? clean(title) : null,
  };
}

// Back-compat helper used elsewhere.
export async function fetchOgImage(url: string): Promise<string | null> {
  return (await fetchProductInfo(url)).imageUrl;
}

// ---------------- helpers ----------------

function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&#x2f;/gi, "/")
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function clean(s: string): string {
  return decode(s).replace(/\s+/g, " ").trim().slice(0, 200);
}

function metaContent(html: string, key: string): string | null {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${esc}["'][^>]+content=["']([^"']+)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${esc}["']`, "i"),
  ];
  for (const re of patterns) {
    const m = html.match(re);
    if (m && m[1]) return decode(m[1]);
  }
  return null;
}

function linkHref(html: string, rel: string): string | null {
  const m = html.match(new RegExp(`<link[^>]+rel=["']${rel}["'][^>]+href=["']([^"']+)["']`, "i"));
  return m ? decode(m[1]) : null;
}

function tagText(html: string, tag: string): string | null {
  const m = html.match(new RegExp(`<${tag}[^>]*>([^<]+)</${tag}>`, "i"));
  return m ? decode(m[1]) : null;
}

function isBeacon(u: string): boolean {
  return /uedata|\/batch\/|fls-na|fls-eu|csm\?|\/1x1|pixel|sprite|spacer|transparent|grey-?pixel|blank\.|\/ap\/uedata|beacon|googletagmanager|google-analytics|doubleclick/i.test(
    u
  );
}

function pickImage(candidates: (string | null)[], base: URL): string | null {
  for (const c of candidates) {
    if (!c) continue;
    let u = decode(c).trim();
    if (!u) continue;
    if (u.startsWith("//")) u = base.protocol + u;
    try {
      u = new URL(u, base).toString();
    } catch {
      continue;
    }
    if (!/^https?:\/\//i.test(u)) continue;
    if (isBeacon(u)) continue;
    return u;
  }
  return null;
}

function amazonDynamicImage(html: string): string | null {
  // data-a-dynamic-image='{"https://...jpg":[500,500], ...}'
  const m = html.match(/data-a-dynamic-image=(?:"|&quot;|')(\{.*?\})(?:"|&quot;|')/i);
  if (m) {
    const block = decode(m[1]);
    const url = block.match(/https?:\/\/[^"']+?\.(?:jpg|jpeg|png|webp)/i);
    if (url) return url[0];
  }
  return null;
}

function amazonAttr(html: string, attr: string): string | null {
  const m = html.match(new RegExp(`${attr}=["']([^"']+\\.(?:jpg|jpeg|png|webp)[^"']*)["']`, "i"));
  return m ? m[1] : null;
}

function firstContentImage(html: string): string | null {
  const re = /<img[^>]+(?:data-old-hires|data-a-dynamic-image|src)=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const u = m[1];
    if (/\.(jpg|jpeg|png|webp)/i.test(u) && !isBeacon(u)) return u;
  }
  return null;
}

// ----- price -----

const CUR: Record<string, string> = {
  USD: "$",
  CAD: "CA$",
  AUD: "A$",
  GBP: "£",
  EUR: "€",
  JPY: "¥",
  INR: "₹",
};

function formatPrice(amount: string, currency?: string | null): string {
  const num = amount.replace(/[^0-9.,]/g, "");
  if (!num) return amount.trim();
  const sym = currency ? CUR[currency.toUpperCase()] || (currency.length <= 3 ? currency + " " : currency) : "$";
  return `${sym}${num}`;
}

function fromMetaPrice(html: string): string | null {
  const amount =
    metaContent(html, "product:price:amount") ||
    metaContent(html, "og:price:amount") ||
    metaContent(html, "price") ||
    metaItemprop(html, "price");
  if (!amount) return null;
  const currency =
    metaContent(html, "product:price:currency") ||
    metaContent(html, "og:price:currency") ||
    metaItemprop(html, "priceCurrency");
  return formatPrice(amount, currency);
}

function metaItemprop(html: string, prop: string): string | null {
  const m =
    html.match(new RegExp(`<meta[^>]+itemprop=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i")) ||
    html.match(new RegExp(`itemprop=["']${prop}["'][^>]*content=["']([^"']+)["']`, "i"));
  return m ? decode(m[1]) : null;
}

function amazonPrice(html: string): string | null {
  // Amazon renders the visible price inside <span class="a-offscreen">$129.99</span>
  const m = html.match(/class="a-offscreen"\s*>\s*([^<]{1,16})</i);
  if (m && /\d/.test(m[1])) return decode(m[1]).trim();
  const whole = html.match(/class="a-price-whole">\s*([\d.,]+)/i);
  const frac = html.match(/class="a-price-fraction">\s*(\d{2})/i);
  if (whole) return `$${whole[1].replace(/[.,]\s*$/, "")}${frac ? "." + frac[1] : ""}`;
  return null;
}

function genericPrice(html: string): string | null {
  const m =
    html.match(/["']price["']\s*:\s*["']?\s*([\d]+\.[\d]{2})/i) ||
    html.match(/>\s*(\$|£|€|CA\$|A\$)\s?([\d]{1,3}(?:,\d{3})*(?:\.\d{2}))/);
  if (!m) return null;
  if (m.length === 3) return `${m[1]}${m[2]}`;
  return `$${m[1]}`;
}

interface JsonLdResult {
  imageUrl: string | null;
  price: string | null;
  title: string | null;
}

function parseJsonLd(html: string, base: URL): JsonLdResult {
  const out: JsonLdResult = { imageUrl: null, price: null, title: null };
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    let data: any;
    try {
      data = JSON.parse(m[1].trim());
    } catch {
      continue;
    }
    const nodes: any[] = [];
    const visit = (n: any) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) return n.forEach(visit);
      nodes.push(n);
      if (n["@graph"]) visit(n["@graph"]);
    };
    visit(data);
    const product = nodes.find((n) => {
      const t = n["@type"];
      return t === "Product" || (Array.isArray(t) && t.includes("Product"));
    });
    if (!product) continue;

    if (!out.title && product.name) out.title = String(product.name);
    if (!out.imageUrl && product.image) {
      let img = product.image;
      if (Array.isArray(img)) img = img[0];
      if (img && typeof img === "object") img = img.url || img["@id"];
      if (img) out.imageUrl = pickImage([String(img)], base);
    }
    if (!out.price) {
      let offers = product.offers;
      if (Array.isArray(offers)) offers = offers[0];
      const amount = offers?.price ?? offers?.lowPrice ?? offers?.priceSpecification?.price;
      if (amount != null) {
        const currency = offers?.priceCurrency ?? offers?.priceSpecification?.priceCurrency;
        out.price = formatPrice(String(amount), currency);
      }
    }
    if (out.imageUrl && out.price && out.title) break;
  }
  return out;
}
