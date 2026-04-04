#!/usr/bin/env node
/**
 * Mzansi Deployment Script
 * Usage: node deploy.js --data client.json
 * Or:    node deploy.js (interactive prompts)
 */

const https = require("https");
const fs = require("fs");
const path = require("path");
const readline = require("readline");

// ─── CONFIG ───────────────────────────────────────────────────
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "";
const TEMPLATE_PATH = path.join(__dirname, "index.html");

// ─── HELPERS ──────────────────────────────────────────────────
function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function fillTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => data[key] || "");
}

function vercelRequest(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: "api.vercel.com",
      path,
      method,
      headers: {
        Authorization: `Bearer ${VERCEL_TOKEN}`,
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// ─── COLLECT CLIENT DATA ──────────────────────────────────────
async function collectData() {
  // If a JSON file was passed, use it
  const dataFlag = process.argv.indexOf("--data");
  if (dataFlag !== -1 && process.argv[dataFlag + 1]) {
    const filePath = process.argv[dataFlag + 1];
    console.log(`📂 Loading client data from ${filePath}...\n`);
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  }

  // Otherwise, prompt interactively
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\n🚀 Mzansi Deploy — Client Setup\n");

  const data = {};
  data.business_name     = await ask(rl, "Business name: ");
  data.tagline           = await ask(rl, "Tagline (what you do + where): ");
  data.service_description = await ask(rl, "Short description: ");
  data.location_area     = await ask(rl, "Area (e.g. Mitchells Plain, Cape Town): ");
  data.phone_number      = await ask(rl, "Phone number (e.g. 0821234567): ");
  data.whatsapp_number   = await ask(rl, "WhatsApp number (27 format, e.g. 27821234567): ");
  data.hero_image_url    = await ask(rl, "Hero image URL (or press Enter for placeholder): ")
    || "https://images.unsplash.com/photo-1521737604893-d14cc237f11d?w=800&q=80";
  data.service_1         = await ask(rl, "Service 1 name: ");
  data.service_1_desc    = await ask(rl, "Service 1 description: ");
  data.service_1_price   = await ask(rl, "Service 1 price (e.g. From R350): ");
  data.service_2         = await ask(rl, "Service 2 name: ");
  data.service_2_desc    = await ask(rl, "Service 2 description: ");
  data.service_2_price   = await ask(rl, "Service 2 price: ");
  data.service_3         = await ask(rl, "Service 3 name: ");
  data.service_3_desc    = await ask(rl, "Service 3 description: ");
  data.service_3_price   = await ask(rl, "Service 3 price: ");
  data.testimonial_text  = await ask(rl, "Testimonial quote: ");
  data.testimonial_name  = await ask(rl, "Testimonial name: ");
  data.testimonial_suburb = await ask(rl, "Testimonial suburb: ");
  data.operating_hours   = await ask(rl, "Operating hours (e.g. Mon–Sat, 7am–6pm): ");

  rl.close();
  return data;
}

// ─── DEPLOY TO VERCEL ─────────────────────────────────────────
async function deploy(clientData) {
  if (!VERCEL_TOKEN) {
    console.error("❌ VERCEL_TOKEN not set. Run: export VERCEL_TOKEN=your_token");
    process.exit(1);
  }

  console.log(`\n⚙️  Building site for "${clientData.business_name}"...`);

  // Fill template
  const template = fs.readFileSync(TEMPLATE_PATH, "utf8");
  const html = fillTemplate(template, clientData);

  // Project name from business name
  const projectName = `mzansi-${slugify(clientData.business_name)}`;
  console.log(`📦 Deploying as: ${projectName}`);

  // Deploy via Vercel API (files deployment — no GitHub needed)
  const result = await vercelRequest("POST", "/v13/deployments", {
    name: projectName,
    files: [
      {
        file: "index.html",
        data: html,
      },
    ],
    projectSettings: {
      framework: null,
    },
    target: "production",
  });

  if (result.url) {
    const siteUrl = `https://${result.url}`;
    console.log(`\n✅ Deployed successfully!`);
    console.log(`🌐 URL: ${siteUrl}`);
    console.log(`\n📲 Send this to the client:`);
    console.log(`─────────────────────────────────────`);
    console.log(`Hi ${clientData.business_name}! 🎉`);
    console.log(`Your website is live: ${siteUrl}`);
    console.log(`Share it with your customers!`);
    console.log(`─────────────────────────────────────`);

    // Save deployment record
    const record = {
      business_name: clientData.business_name,
      url: siteUrl,
      deployed_at: new Date().toISOString(),
      ...clientData,
    };
    const logPath = path.join(__dirname, "deployments.json");
    const existing = fs.existsSync(logPath)
      ? JSON.parse(fs.readFileSync(logPath, "utf8"))
      : [];
    existing.push(record);
    fs.writeFileSync(logPath, JSON.stringify(existing, null, 2));
    console.log(`\n📝 Saved to deployments.json`);

    return siteUrl;
  } else {
    console.error("\n❌ Deployment failed:");
    console.error(JSON.stringify(result, null, 2));
    process.exit(1);
  }
}

// ─── MAIN ─────────────────────────────────────────────────────
(async () => {
  try {
    const clientData = await collectData();
    await deploy(clientData);
  } catch (err) {
    console.error("❌ Error:", err.message);
    process.exit(1);
  }
})();
