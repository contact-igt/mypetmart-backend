import puppeteer, { type Browser } from "puppeteer";

import { logger } from "../../utils/logger.js";

// One headless Chromium instance shared across every PDF render in this
// process — launching a fresh browser per request (~1-2s, real memory) would
// make every receipt download pay that cost. Lazily started on first use,
// closed once via closePdfRenderer() during graceful shutdown (see
// server.ts) so a SIGTERM doesn't leave an orphaned Chromium process.
let browserPromise: Promise<Browser> | null = null;

function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] }).catch((error: unknown) => {
      // A failed launch must not permanently wedge every future render
      // attempt behind a rejected promise — clear it so the next call
      // retries a fresh launch instead of replaying the same failure forever.
      browserPromise = null;
      throw error;
    });
  }
  return browserPromise;
}

/**
 * Renders a self-contained HTML document (inline CSS only — see
 * receipt.template.ts, no external stylesheet/network fetch) to a PDF
 * buffer. A4, print backgrounds enabled so the template's own background
 * colors/borders survive into the PDF.
 */
export async function renderHtmlToPdf(html: string): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    // "load" is sufficient (not "networkidle0", which setContent() no
    // longer accepts) — the template is fully self-contained inline
    // HTML/CSS with no external resource fetches to wait out.
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({ format: "a4", printBackground: true, margin: { top: "16mm", bottom: "16mm", left: "14mm", right: "14mm" } });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

export async function closePdfRenderer(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
  } catch (error) {
    logger.warn({ err: error }, "pdf renderer: error closing browser during shutdown");
  } finally {
    browserPromise = null;
  }
}
