/**
 * Mzansi Deploy API
 * POST /api/deploy
 * Body: { "client": { business_name, tagline, ... } }
 * Returns: { success: true, url: "https://..." }
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const API_SECRET = process.env.API_SECRET;

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

function fillTemplate(template, data) {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) =>
    (data[key] || "").replace(/\\/g, "\\\\")
  );
}

function vercelDeploy(projectName, html) {
  return new Promise((resolve, reject) => {
    const body = {
      name: projectName,
      files: [
        {
          file: "index.html",
          data: Buffer.from(html).toString("base64"),
          encoding: "base64",
        },
      ],
      projectSettings: { framework: null },
      target: "production",
    };

    const payload = JSON.stringify(body);

    const options = {
      hostname: "api.vercel.com",
      path: "/v13/deployments",
      method: "POST",
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
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

// Parse raw body manually (Vercel doesn't auto-parse)
function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => (raw += chunk));
    req.on("end", () => {
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error("Invalid JSON: " + e.message)); }
    });
    req.on("error", reject);
  });
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = req.headers["x-api-secret"];
  if (API_SECRET && secret !== API_SECRET) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  let body;
  try {
    body = await parseBody(req);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const { client } = body;
  if (!client || !client.business_name) {
    return res.status(400).json({ error: "Missing client.business_name" });
  }

  try {
    const templatePath = path.join(process.cwd(), "index.html");
    const template = fs.readFileSync(templatePath, "utf8");
    const html = fillTemplate(template, client);
    const projectName = `mzansi-${slugify(client.business_name)}`;
    const result = await vercelDeploy(projectName, html);

    if (result.url) {
      return res.status(200).json({
        success: true,
        url: `https://${result.url}`,
        business: client.business_name,
      });
    } else {
      console.error("Vercel error:", JSON.stringify(result));
      return res.status(500).json({ error: "Deployment failed", detail: result });
    }
  } catch (err) {
    console.error("Deploy error:", err);
    return res.status(500).json({ error: err.message });
  }
};
