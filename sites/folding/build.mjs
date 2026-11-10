import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pages } from "./src/pages.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const origin = "https://getfolding.app";
const escape = (value) => value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
function document(page) {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><title>${escape(page.title)}</title><meta name="description" content="${escape(page.description)}"><link rel="canonical" href="${origin}${page.path}">${page.noindex ? '<meta name="robots" content="noindex,nofollow">' : ""}<meta property="og:type" content="website"><meta property="og:title" content="${escape(page.title)}"><meta property="og:description" content="${escape(page.description)}"><meta property="og:url" content="${origin}${page.path}"><link rel="icon" type="image/png" href="/assets/icon-selected.png"><link rel="stylesheet" href="/assets/site.css"></head>
<body><a class="skip" href="#main">Skip to content</a><header class="header"><div class="wrap header-inner"><a class="brand" href="/" aria-label="Folding home"><img src="/assets/icon-selected.png" width="34" height="34" alt="">Folding</a><nav class="nav" aria-label="Main"><a href="/"${page.path === "/" ? ' aria-current="page"' : ""}>Overview</a><a href="/support/"${page.path === "/support/" ? ' aria-current="page"' : ""}>Support</a></nav></div></header><main id="main" tabindex="-1">${page.content}</main><footer class="footer"><div class="wrap footer-inner"><p>© 2026 Folding</p><nav aria-label="Footer"><a href="/privacy/">Privacy</a><a href="/support/">Support</a><a href="/delete/">Delete data</a><a href="/appeal/">Appeal</a></nav></div></footer></body></html>\n`;
}
{
  const output = join(root, "dist");
  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  await cp(join(root, "assets"), join(output, "assets"), { recursive: true });
  for (const page of pages) {
    const filename = page.path === "/404.html" ? "404.html" : `${page.path.slice(1)}index.html`;
    const destination = join(output, filename);
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, document(page));
  }
  await writeFile(join(output, "robots.txt"), `User-agent: *\nAllow: /\nSitemap: ${origin}/sitemap.xml\n`);
  await writeFile(join(output, "sitemap.xml"), `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${pages.filter((page) => !page.noindex).map((page) => `<url><loc>${origin}${page.path}</loc></url>`).join("")}</urlset>\n`);
  await writeFile(join(output, "_redirects"), "/delete-account /delete/ 301\n/appeals /appeal/ 301\n/privacy-policy /privacy/ 301\n");
  await writeFile(join(output, "_headers"), `/*
  Content-Security-Policy: default-src 'none'; style-src 'self'; img-src 'self'; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; upgrade-insecure-requests
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  Permissions-Policy: camera=(), microphone=(), geolocation=()
  Cache-Control: public, max-age=0, must-revalidate
`);
}
console.log("Built Folding public pages in dist/.");
