// api/chat.js
// Vercel Node Serverless function (non-streaming) — propre & robuste

import fs from "fs";
import path from "path";

/**
 * Charge un fichier texte en UTF-8, ou renvoie une chaîne fallback.
 */
function loadText(filePath, fallbackLabel) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return `(${fallbackLabel} introuvable)`;
  }
}

/**
 * Charge un JSON lisible (joli) ou renvoie une chaîne fallback.
 */
function loadJsonPretty(filePath, fallbackLabel) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return JSON.stringify(data, null, 2);
  } catch {
    return `(${fallbackLabel} introuvable)`;
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).send("Method Not Allowed");
    return;
  }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
    const MODEL = process.env.MODEL || "gpt-4o-mini";
    const SYSTEM_PROMPT =
      process.env.SYSTEM_PROMPT ||
      "Tu es ALTRAD Assistant, expert échafaudage METRIX. Réponds en français.";

    if (!OPENAI_API_KEY) {
      res.status(500).send("OPENAI_API_KEY manquant.");
      return;
    }

    const { messages = [], user } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).send("Payload invalide: messages[] requis.");
      return;
    }

    // --- Charge les documents locaux (notice + stock PEDUZZI)
    const base = process.cwd();
    const notice = loadText(path.join(base, "docs", "notice.md"), "NOTICE");
    const cataloguePretty = loadJsonPretty(
      path.join(base, "docs", "catalogue.json"),
      "CATALOGUE"
    );

    // --- Contexte injecté dans la requête modèle
    const CONTEXT = [
      "=== NOTICE (extraits METRIX) ===",
      notice,
      "",
      "=== CATALOGUE_JSON (stock PEDUZZI : refs / désignations / poids) ===",
      cataloguePretty,
    ].join("\n");

    // --- Rappels de sortie (léger, le SYSTEM_PROMPT porte la logique métier)
    const OUTPUT_POLICY = [
      "- Un seul tableau HTML final : Référence | Désignation | Qté | PU(kg) | PT(kg).",
      "- Ligne de TOTAL GÉNÉRAL (kg).",
      "- Utiliser uniquement des références présentes dans CATALOGUE_JSON.",
      "- Ordre de fin : question protection côté mur (avec l’avertissement >20 cm) → question grutage → tableau final.",
      "- Si l’utilisateur parle en m², NE RIEN DÉDUIRE : demander explicitement longueur et hauteur, puis continuer.",
    ].join("\n");

    // --- Construction du payload OpenAI (non-streaming)
    const upstreamBody = {
      model: MODEL,
      temperature: 0.2,
      top_p: 0.9,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: "Contexte utilisateur : " + (user?.email || "inconnu") },
        { role: "system", content: CONTEXT },
        { role: "system", content: OUTPUT_POLICY },
        ...messages,
      ],
    };

    // --- Appel OpenAI Chat Completions
    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(upstreamBody),
    });

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => "Erreur OpenAI");
      res.status(upstream.status).send(text);
      return;
    }

    const data = await upstream.json();
    const content = data?.choices?.[0]?.message?.content ?? "(réponse vide)";
    res.status(200).send(content);
  } catch (e) {
    res.status(500).send(e?.message || "Erreur serveur");
  }
}
