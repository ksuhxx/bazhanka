import dns from 'node:dns/promises';
import net from 'node:net';
import * as cheerio from 'cheerio';
import { HttpError } from './util.js';

// Block requests to private / loopback networks (SSRF protection).
function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::1' || v === '::' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe80');
}

async function assertPublicHost(hostname) {
  const addrs = await dns.lookup(hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new HttpError(400, 'Could not reach that shop');
  if (addrs.some((a) => isPrivateIp(a.address))) throw new HttpError(400, 'That address is not allowed');
}

function parsePrice(v) {
  if (v === undefined || v === null) return null;
  const cleaned = String(v).replace(/\s| /g, '').replace(/[^\d.,]/g, '');
  if (!cleaned) return null;
  // "1.299,00" -> 1299.00 ; "1,299.00" -> 1299.00 ; "1299,5" -> 1299.5
  let s = cleaned;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
}

function findProductInJsonLd(node) {
  if (!node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const n of node) {
      const found = findProductInJsonLd(n);
      if (found) return found;
    }
    return null;
  }
  const type = node['@type'];
  if (type === 'Product' || (Array.isArray(type) && type.includes('Product'))) return node;
  if (node['@graph']) return findProductInJsonLd(node['@graph']);
  return null;
}

export function extractMetadata(html, pageUrl) {
  const $ = cheerio.load(html);
  const meta = (sel) => $(sel).attr('content')?.trim() || null;
  const out = { title: null, image: null, price: null, currency: null };

  $('script[type="application/ld+json"]').each((_, el) => {
    if (out.title && out.price) return;
    try {
      const product = findProductInJsonLd(JSON.parse($(el).contents().text()));
      if (!product) return;
      out.title ||= product.name || null;
      const img = Array.isArray(product.image) ? product.image[0] : product.image;
      out.image ||= (typeof img === 'object' ? img?.url : img) || null;
      let offer = Array.isArray(product.offers) ? product.offers[0] : product.offers;
      if (offer?.offers) offer = Array.isArray(offer.offers) ? offer.offers[0] : offer.offers;
      if (offer) {
        out.price ||= parsePrice(offer.price ?? offer.lowPrice);
        out.currency ||= offer.priceCurrency || null;
      }
    } catch {
      /* ignore broken JSON-LD */
    }
  });

  out.title ||= meta('meta[property="og:title"]') || meta('meta[name="twitter:title"]') || $('title').first().text().trim() || null;
  out.image ||= meta('meta[property="og:image"]') || meta('meta[property="og:image:url"]') || meta('meta[name="twitter:image"]');
  out.price ||= parsePrice(meta('meta[property="product:price:amount"]') || meta('meta[property="og:price:amount"]') || $('[itemprop="price"]').attr('content'));
  out.currency ||= meta('meta[property="product:price:currency"]') || meta('meta[property="og:price:currency"]') || $('[itemprop="priceCurrency"]').attr('content') || null;

  if (out.image) {
    try { out.image = new URL(out.image, pageUrl).toString(); } catch { out.image = null; }
  }
  if (out.title) out.title = out.title.replace(/\s+/g, ' ').slice(0, 300);
  if (out.currency) out.currency = String(out.currency).toUpperCase().slice(0, 3);
  if (out.currency === 'ГРН') out.currency = 'UAH';
  return out;
}

export async function fetchPreview(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new HttpError(400, 'That does not look like a link');
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Only http(s) links are supported');

  // Follow redirects manually so every hop is checked against private networks.
  let current = url;
  let res;
  for (let hop = 0; hop < 5; hop++) {
    await assertPublicHost(current.hostname);
    res = await fetch(current, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
      headers: {
        // Many shops (Rozetka, Silpo…) block anything that looks like a bot, so look like a normal browser.
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'uk-UA,uk;q=0.9,en;q=0.8',
      },
    }).catch((e) => { console.warn(`preview: ${current.hostname} failed:`, e.message); return null; });
    if (!res) throw new HttpError(502, 'The shop did not respond in time; fill the item in by hand');
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      current = new URL(res.headers.get('location'), current);
      continue;
    }
    break;
  }
  if (!res.ok) console.warn(`preview: ${current.hostname} answered ${res.status}`);
  if (!res.ok) throw new HttpError(502, `The shop answered with ${res.status}; fill the item in by hand`);

  // Read at most 2 MB.
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  while (size < 2_000_000) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
  }
  reader.cancel().catch(() => {});
  const html = Buffer.concat(chunks).toString('utf8');
  return { url: current.toString(), ...extractMetadata(html, current) };
}
