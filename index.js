/**
 * CROUS TRACKER — SERVER (Node.js)
 * Tourne 24/7 sur Railway / Render / Fly.io
 * Scrape trouverunlogement.lescrous.fr et envoie des emails via Nodemailer
 */

"use strict";

const fetch      = require("node-fetch");
const nodemailer = require("nodemailer");
const { parse }  = require("node-html-parser");
const http       = require("http");

// ─────────────────────────────────────────────
// CONFIG — via variables d'environnement (.env)
// ─────────────────────────────────────────────
const CONFIG = {
  // Villes séparées par des virgules  ex: "Paris,Lyon,Bordeaux"
  CITIES: (process.env.CITIES || "Paris").split(",").map(c => c.trim()),

  // Loyer max en euros
  MAX_PRICE: parseInt(process.env.MAX_PRICE || "800", 10),

  // Intervalle en minutes
  INTERVAL_MINUTES: parseInt(process.env.INTERVAL_MINUTES || "5", 10),

  // Email destinataire
  EMAIL_TO: process.env.EMAIL_TO || "",

  // Config SMTP (Gmail recommandé)
  SMTP_HOST:     process.env.SMTP_HOST     || "smtp.gmail.com",
  SMTP_PORT:     parseInt(process.env.SMTP_PORT || "587", 10),
  SMTP_USER:     process.env.SMTP_USER     || "",   // ton adresse Gmail
  SMTP_PASS:     process.env.SMTP_PASS     || "",   // mot de passe d'application Google

  // Port HTTP (pour le health check Railway/Render)
  PORT: parseInt(process.env.PORT || "3000", 10),
};

// ─────────────────────────────────────────────
// MAPPING VILLE → RÉGION CROUS
// ─────────────────────────────────────────────
const CROUS_REGIONS = {
  "paris":         "tools/31",
  "ile-de-france": "tools/31",
  "versailles":    "tools/31",
  "creteil":       "tools/31",
  "lyon":          "tools/1",
  "marseille":     "tools/3",
  "aix":           "tools/3",
  "bordeaux":      "tools/42",
  "toulouse":      "tools/19",
  "montpellier":   "tools/32",
  "lille":         "tools/23",
  "rennes":        "tools/28",
  "brest":         "tools/28",
  "nantes":        "tools/36",
  "strasbourg":    "tools/12",
  "grenoble":      "tools/8",
  "nice":          "tools/37",
  "nancy":         "tools/24",
  "metz":          "tools/24",
  "caen":          "tools/14",
  "rouen":         "tools/16",
  "clermont":      "tools/5",
  "dijon":         "tools/7",
  "tours":         "tools/39",
  "poitiers":      "tools/22",
  "limoges":       "tools/22",
  "amiens":        "tools/18",
  "reims":         "tools/12",
  "besancon":      "tools/7",
  "pau":           "tools/19",
  "perpignan":     "tools/32",
  "nimes":         "tools/32",
  "angers":        "tools/36",
  "le mans":       "tools/36",
  "orleans":       "tools/39",
};

function getCrousPath(city) {
  const norm = city
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  for (const [key, path] of Object.entries(CROUS_REGIONS)) {
    if (norm.includes(key)) return path;
  }
  return "tools/31"; // fallback Paris
}

// ─────────────────────────────────────────────
// ÉTAT
// ─────────────────────────────────────────────
const knownIds    = new Set();
let   checksCount = 0;
let   newCount    = 0;

// ─────────────────────────────────────────────
// SCRAPING
// ─────────────────────────────────────────────
async function fetchListings(city) {
  const path = getCrousPath(city);
  const url  = `https://trouverunlogement.lescrous.fr/${path}/search?price=${CONFIG.MAX_PRICE}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
      timeout: 15000,
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    return parseListings(html, city);
  } catch (err) {
    log(`ERREUR réseau (${city}): ${err.message}`);
    return [];
  }
}

function parseListings(html, city) {
  const root  = parse(html);
  const items = [];
  const seen  = new Set();

  // Stratégie 1 : liens /accommodations/{id}
  root.querySelectorAll('a[href*="/accommodations/"]').forEach(link => {
    const href    = link.getAttribute("href") || "";
    const idMatch = href.match(/\/accommodations\/(\d+)/);
    if (!idMatch) return;
    const id = idMatch[1];
    if (seen.has(id)) return;
    seen.add(id);

    const container = link.closest("li") || link.closest("article") || link;

    const name = (
      container.querySelector("h2,h3,.accommodation-title")?.text ||
      link.text ||
      `Logement #${id}`
    ).replace(/\s+/g, " ").trim();

    const priceEl = container.querySelector('[class*="price"],[class*="prix"]');
    const price   = priceEl ? priceEl.text.replace(/\s+/g, " ").trim() : "";

    const addrEl  = container.querySelector('[class*="address"],[class*="adresse"]');
    const address = addrEl ? addrEl.text.replace(/\s+/g, " ").trim() : city;

    items.push({
      id,
      name,
      price,
      address,
      city,
      url: `https://trouverunlogement.lescrous.fr${href}`,
    });
  });

  // Stratégie 2 (fallback regex)
  if (items.length === 0) {
    const matches = [...html.matchAll(/\/accommodations\/(\d+)/g)];
    const unique  = [...new Set(matches.map(m => m[1]))];
    unique.forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      items.push({
        id,
        name:    `Logement CROUS #${id}`,
        price:   "",
        address: city,
        city,
        url:     `https://trouverunlogement.lescrous.fr/tools/42/accommodations/${id}`,
      });
    });
  }

  return items;
}

// ─────────────────────────────────────────────
// NODEMAILER
// ─────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   CONFIG.SMTP_HOST,
      port:   CONFIG.SMTP_PORT,
      secure: CONFIG.SMTP_PORT === 465,
      auth: {
        user: CONFIG.SMTP_USER,
        pass: CONFIG.SMTP_PASS,
      },
    });
  }
  return transporter;
}

async function sendEmail(newItems) {
  if (!CONFIG.EMAIL_TO || !CONFIG.SMTP_USER || !CONFIG.SMTP_PASS) {
    log("Email non configuré — notification ignorée.");
    return;
  }

  const listText = newItems
    .map(i => `• ${i.name} (${i.city}) — ${i.price || "prix non renseigné"}\n  ${i.url}`)
    .join("\n\n");

  const listHtml = newItems
    .map(i => `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;">
          <a href="${i.url}" style="color:#1D9E75;text-decoration:none;font-weight:600;">
            ${escHtml(i.name)}
          </a><br/>
          <small style="color:#888;">${escHtml(i.address)}</small>
        </td>
        <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#1D9E75;">
          ${i.price ? escHtml(i.price) : "–"}
        </td>
      </tr>
    `)
    .join("");

  const htmlBody = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <div style="background:#1D9E75;padding:20px 24px;border-radius:8px 8px 0 0;">
        <h1 style="color:#fff;margin:0;font-size:20px;">🏠 CROUS Tracker</h1>
        <p style="color:#9fe1cb;margin:4px 0 0;">${newItems.length} nouveau(x) logement(s) disponible(s) !</p>
      </div>
      <div style="border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px;padding:20px 24px;">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr style="background:#f5f4f0;">
              <th style="padding:8px 12px;text-align:left;font-size:12px;color:#888;text-transform:uppercase;">Logement</th>
              <th style="padding:8px 12px;text-align:right;font-size:12px;color:#888;text-transform:uppercase;">Loyer</th>
            </tr>
          </thead>
          <tbody>${listHtml}</tbody>
        </table>
        <p style="margin-top:20px;font-size:13px;color:#888;">
          Villes surveillées : <strong>${CONFIG.CITIES.join(", ")}</strong><br/>
          Vérifié le ${new Date().toLocaleString("fr-FR")}
        </p>
        <a href="https://trouverunlogement.lescrous.fr"
           style="display:inline-block;margin-top:12px;padding:10px 20px;background:#1D9E75;color:#fff;text-decoration:none;border-radius:6px;font-size:14px;">
          Ouvrir le site CROUS →
        </a>
      </div>
    </div>
  `;

  try {
    await getTransporter().sendMail({
      from:    `"CROUS Tracker" <${CONFIG.SMTP_USER}>`,
      to:      CONFIG.EMAIL_TO,
      subject: `[CROUS] ${newItems.length} nouveau(x) logement(s) — ${CONFIG.CITIES.join(", ")}`,
      text:    `${newItems.length} nouveau(x) logement(s) disponible(s) :\n\n${listText}`,
      html:    htmlBody,
    });
    log(`Email envoyé à ${CONFIG.EMAIL_TO}`);
  } catch (err) {
    log(`Erreur envoi email : ${err.message}`);
  }
}

// ─────────────────────────────────────────────
// CYCLE DE VÉRIFICATION
// ─────────────────────────────────────────────
async function checkAll() {
  checksCount++;
  log(`── Vérification #${checksCount} (${CONFIG.CITIES.join(", ")}) ──`);

  const newItems = [];

  for (const city of CONFIG.CITIES) {
    const listings = await fetchListings(city);
    log(`  ${city} : ${listings.length} logement(s) trouvé(s)`);

    for (const item of listings) {
      if (!knownIds.has(item.id)) {
        knownIds.add(item.id);
        newItems.push(item);
      }
    }
  }

  if (newItems.length > 0) {
    newCount += newItems.length;
    log(`🎉 ${newItems.length} NOUVEAU(X) LOGEMENT(S) ! (total : ${newCount})`);
    newItems.forEach(i => log(`   → ${i.name} | ${i.price || "?"} | ${i.url}`));
    await sendEmail(newItems);
  } else {
    log(`  Aucun nouveau logement. (${knownIds.size} connu(s) au total)`);
  }

  log(`── Prochaine vérif dans ${CONFIG.INTERVAL_MINUTES} min ──\n`);
}

// ─────────────────────────────────────────────
// SERVEUR HTTP (health check pour Railway/Render)
// ─────────────────────────────────────────────
function startHealthServer() {
  const server = http.createServer((req, res) => {
    const status = {
      status:      "running",
      checks:      checksCount,
      newListings: newCount,
      knownIds:    knownIds.size,
      cities:      CONFIG.CITIES,
      interval:    `${CONFIG.INTERVAL_MINUTES}min`,
      uptime:      `${Math.floor(process.uptime() / 60)} min`,
      lastCheck:   new Date().toISOString(),
    };
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(status, null, 2));
  });

  server.listen(CONFIG.PORT, () => {
    log(`Health server démarré sur le port ${CONFIG.PORT}`);
  });
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function log(msg) {
  const now = new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" });
  console.log(`[${now}] ${msg}`);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ─────────────────────────────────────────────
// DÉMARRAGE
// ─────────────────────────────────────────────
async function main() {
  log("════════════════════════════════════════");
  log("  CROUS TRACKER — Serveur démarré");
  log("════════════════════════════════════════");
  log(`Villes     : ${CONFIG.CITIES.join(", ")}`);
  log(`Loyer max  : ${CONFIG.MAX_PRICE}€/mois`);
  log(`Intervalle : ${CONFIG.INTERVAL_MINUTES} minutes`);
  log(`Email vers : ${CONFIG.EMAIL_TO || "(non configuré)"}`);
  log("════════════════════════════════════════\n");

  // Démarrer le health server
  startHealthServer();

  // Première vérification immédiate
  await checkAll();

  // Puis toutes les N minutes
  setInterval(checkAll, CONFIG.INTERVAL_MINUTES * 60 * 1000);
}

main().catch(err => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});
