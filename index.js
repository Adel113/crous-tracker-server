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
  CITIES:           (process.env.CITIES || "Paris").split(",").map(c => c.trim()),
  MAX_PRICE:        parseInt(process.env.MAX_PRICE || "800", 10),
  INTERVAL_MINUTES: parseInt(process.env.INTERVAL_MINUTES || "5", 10),
  EMAIL_TO:         process.env.EMAIL_TO || "adelsidiahmed2020@gmail.com",
  SMTP_HOST:        process.env.SMTP_HOST || "smtp.gmail.com",
  SMTP_PORT:        parseInt(process.env.SMTP_PORT || "587", 10),
  SMTP_USER:        process.env.SMTP_USER || "",
  SMTP_PASS:        process.env.SMTP_PASS || "",
  PORT:             parseInt(process.env.PORT || "3000", 10),
};

// ─────────────────────────────────────────────
// MAPPING VILLE → { tool, bounds }
// Pour ajouter une ville : va sur trouverunlogement.lescrous.fr,
// cherche ta ville, et copie l'URL — récupère tool et bounds dedans.
// ─────────────────────────────────────────────
const CROUS_CITIES = {
  "paris":        { tool: "42", bounds: "2.224122_48.902156_2.4697602_48.8155755" },
  "versailles":   { tool: "42", bounds: "2.0627_48.8351_2.1594_48.7888" },
  "creteil":      { tool: "42", bounds: "2.4295_48.7970_2.4880_48.7670" },
  "lyon":         { tool: "42", bounds: "4.771572126783989_45.783966009716735_4.900427873216012_45.694033990283266" },
  "marseille":    { tool: "42", bounds: "5.3204_43.3207_5.4083_43.2504" },
  "aix":          { tool: "42", bounds: "5.4042_43.5432_5.4680_43.5036" },
  "bordeaux":     { tool: "42", bounds: "-0.6843641392097606_44.838966009716735_-0.5576358607902394_44.74903399028326" },
  "toulouse":     { tool: "42", bounds: "1.3868_43.6357_1.5235_43.5560" },
  "montpellier":  { tool: "42", bounds: "3.8244_43.6340_3.9131_43.5752" },
  "lille":        { tool: "42", bounds: "2.9869_50.6730_3.1236_50.5933" },
  "rennes":       { tool: "42", bounds: "-1.7457_48.1424_-1.6090_48.0627" },
  "brest":        { tool: "42", bounds: "-4.5493_48.4204_-4.4126_48.3607" },
  "nantes":       { tool: "42", bounds: "-1.6058_47.2552_-1.4691_47.1755" },
  "strasbourg":   { tool: "42", bounds: "7.6862_48.6090_7.8229_48.5293" },
  "grenoble":     { tool: "42", bounds: "5.6747_45.2123_5.7784_45.1526" },
  "nice":         { tool: "42", bounds: "7.2019_43.7317_7.3046_43.6720" },
  "nancy":        { tool: "42", bounds: "6.1449_48.7143_6.2136_48.6746" },
  "metz":         { tool: "42", bounds: "6.1315_49.1394_6.2002_49.0997" },
  "caen":         { tool: "42", bounds: "-0.3990_49.2234_-0.3303_49.1837" },
  "rouen":        { tool: "42", bounds: "1.0538_49.4700_1.1225_49.4103" },
  "clermont":     { tool: "42", bounds: "3.0515_45.7994_3.1202_45.7597" },
  "dijon":        { tool: "42", bounds: "5.0076_47.3467_5.0763_47.3070" },
  "tours":        { tool: "42", bounds: "0.6558_47.4150_0.7245_47.3553" },
  "poitiers":     { tool: "42", bounds: "0.2949_46.5997_0.3636_46.5600" },
  "limoges":      { tool: "42", bounds: "1.2323_45.8566_1.3010_45.8169" },
  "amiens":       { tool: "42", bounds: "2.2666_49.9195_2.3353_49.8798" },
  "reims":        { tool: "42", bounds: "3.9869_49.2793_4.0556_49.2396" },
  "besancon":     { tool: "42", bounds: "5.9952_47.2706_6.0639_47.2309" },
  "pau":          { tool: "42", bounds: "-0.4082_43.3327_-0.3395_43.2930" },
  "perpignan":    { tool: "42", bounds: "2.8499_42.7244_2.9186_42.6847" },
  "nimes":        { tool: "42", bounds: "4.3246_43.8583_4.3933_43.8186" },
  "angers":       { tool: "42", bounds: "-0.5870_47.5054_-0.5183_47.4657" },
  "le mans":      { tool: "42", bounds: "0.1661_48.0392_0.2348_47.9995" },
  "orleans":      { tool: "42", bounds: "1.8757578_47.9335389_1.9487114_47.8132802" },
};

function getCrousConfig(city) {
  const norm = city
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
  for (const [key, cfg] of Object.entries(CROUS_CITIES)) {
    if (norm.includes(key)) return cfg;
  }
  return CROUS_CITIES["paris"]; // fallback
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
  const { tool, bounds } = getCrousConfig(city);
  const url = `https://trouverunlogement.lescrous.fr/tools/${tool}/search?bounds=${bounds}`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept":          "text/html,application/xhtml+xml",
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
      id, name, price, address, city,
      url: `https://trouverunlogement.lescrous.fr${href}`,
    });
  });

  // Stratégie 2 (fallback regex)
  if (items.length === 0) {
    const matches = [...html.matchAll(/\/accommodations\/(\d+)/g)];
    [...new Set(matches.map(m => m[1]))].forEach(id => {
      if (seen.has(id)) return;
      seen.add(id);
      items.push({
        id,
        name:    `Logement CROUS #${id}`,
        price:   "",
        address: city,
        city,
        url: `https://trouverunlogement.lescrous.fr/tools/42/accommodations/${id}`,
      });
    });
  }

  return items;
}

// ─────────────────────────────────────────────
// EMAIL
// ─────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host:   CONFIG.SMTP_HOST,
      port:   CONFIG.SMTP_PORT,
      secure: CONFIG.SMTP_PORT === 465,
      auth: { user: CONFIG.SMTP_USER, pass: CONFIG.SMTP_PASS },
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

  const listHtml = newItems.map(i => `
    <tr>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;">
        <a href="${i.url}" style="color:#1D9E75;text-decoration:none;font-weight:600;">${escHtml(i.name)}</a><br/>
        <small style="color:#888;">${escHtml(i.address)}</small>
      </td>
      <td style="padding:8px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600;color:#1D9E75;">
        ${i.price ? escHtml(i.price) : "–"}
      </td>
    </tr>
  `).join("");

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
      text:    `${newItems.length} nouveau(x) logement(s) :\n\n${listText}`,
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
// HEALTH SERVER (Railway / Render)
// ─────────────────────────────────────────────
function startHealthServer() {
  http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      status:      "running",
      checks:      checksCount,
      newListings: newCount,
      knownIds:    knownIds.size,
      cities:      CONFIG.CITIES,
      interval:    `${CONFIG.INTERVAL_MINUTES}min`,
      uptime:      `${Math.floor(process.uptime() / 60)} min`,
      lastCheck:   new Date().toISOString(),
    }, null, 2));
  }).listen(CONFIG.PORT, () => log(`Health server démarré sur le port ${CONFIG.PORT}`));
}

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────
function log(msg) {
  console.log(`[${new Date().toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}] ${msg}`);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");
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

  startHealthServer();
  await checkAll();
  setInterval(checkAll, CONFIG.INTERVAL_MINUTES * 60 * 1000);
}

main().catch(err => {
  console.error("Erreur fatale :", err);
  process.exit(1);
});