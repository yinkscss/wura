import { chromium } from "playwright-core";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const shots = path.resolve(__dirname, "../shots");

const pages = [
  { file: "01-landing-desktop.html", out: "01-landing-desktop.png", width: 1440, height: 900, scale: 2 },
  { file: "02-chat-swap-approve.html", out: "02-chat-swap-approve.png", width: 390, height: 844, scale: 2 },
  { file: "03-send-confirm.html", out: "03-send-confirm.png", width: 390, height: 844, scale: 2 },
  { file: "04-payment-link.html", out: "04-payment-link.png", width: 390, height: 844, scale: 2 },
  { file: "05-dashboard-balance-limits.html", out: "05-dashboard-balance-limits.png", width: 1440, height: 900, scale: 2 },
  { file: "06-onboarding-verify-once.html", out: "06-onboarding-verify-once.png", width: 1440, height: 900, scale: 2 },
  { file: "00-overview.html", out: "00-overview.png", width: 1920, height: 1080, scale: 2 },
];

const browser = await chromium.launch({
  channel: "chrome",
  args: ["--disable-font-subpixel-positioning", "--font-render-hinting=none"],
});

for (const p of pages) {
  const context = await browser.newContext({
    viewport: { width: p.width, height: p.height },
    deviceScaleFactor: p.scale,
  });
  const page = await context.newPage();
  const url = pathToFileURL(path.join(__dirname, p.file)).href;
  await page.goto(url, { waitUntil: "networkidle" });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((res) => { img.onload = img.onerror = res; })
      )
    );
  });
  // give a beat for paint
  await page.waitForTimeout(120);
  const dest = path.join(shots, p.out);
  await page.screenshot({ path: dest, type: "png", clip: { x: 0, y: 0, width: p.width, height: p.height } });
  console.log("wrote", dest);
  await context.close();
}

await browser.close();
