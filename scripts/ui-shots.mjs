// Visual verification utility. Credentials come from env vars — never hardcode them:
//   SHOT_EMAIL=... SHOT_PASSWORD=... node scripts/ui-shots.mjs
import { chromium } from "playwright-core";

const base = process.env.SHOT_BASE_URL ?? "http://127.0.0.1:5000";
const email = process.env.SHOT_EMAIL;
const password = process.env.SHOT_PASSWORD;

if (!email || !password) {
  console.error("Set SHOT_EMAIL and SHOT_PASSWORD env vars.");
  process.exit(1);
}

const shots = [
  { path: "/login", file: "/tmp/shots/login.jpg", auth: false },
  { path: "/today", file: "/tmp/shots/today.jpg", auth: true },
  { path: "/clients", file: "/tmp/shots/clients.jpg", auth: true },
  { path: "/policies", file: "/tmp/shots/policies.jpg", auth: true },
  { path: "/receipts", file: "/tmp/shots/receipts.jpg", auth: true },
  { path: "/today", file: "/tmp/shots/today-mobile.jpg", auth: true, width: 390, height: 844 },
  { path: "/today", file: "/tmp/shots/today-dark.jpg", auth: true, dark: true },
];

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

let authed = false;
for (const shot of shots) {
  if (shot.width) await page.setViewportSize({ width: shot.width, height: shot.height });
  else await page.setViewportSize({ width: 1440, height: 900 });
  if (shot.auth && !authed) {
    await page.goto(`${base}/login`, { waitUntil: "networkidle" });
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.click('button[type="submit"]');
    await page.waitForURL(/\/today/, { timeout: 15000 });
    await page.waitForLoadState("networkidle");
    authed = true;
  }
  await page.goto(`${base}${shot.path}`, { waitUntil: "networkidle" });
  if (shot.dark) {
    await page.evaluate(() => document.documentElement.classList.add("dark"));
    await page.waitForTimeout(300);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot.file, type: "jpeg", quality: 85 });
  console.log("saved", shot.file);
}

await browser.close();
