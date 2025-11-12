// api/chat.js
// Vercel Node serverless – Appel OpenAI non-streaming + anti-boucle + lecture docs

import fs from "fs";
import path from "path";

/* ---------- utilitaires de lecture fichiers ---------- */
function loadText(filePath, fallbackLabel) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return `(${fallbackLabel} introuvable)`;
  }
}
function loadJsonPretty(filePath, fallbackLabel) {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    return JSON.stringify(data, null, 2);
  } catch {
    return `(${fallbackLabel} introuvable)`;
  }
}

/* ---------- handler Vercel ---------- */
export default async function handler(req, res) {
  // CORS minimal (utile si WebView/app externe)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") {
    res.status(200).end();
    return;
  }
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
      res.status(400).send("Payload invalide : messages[] requis.");
      return;
    }

    // --- charge la notice + le catalogue PEDUZZI
    const base = process.cwd();
    const notice = loadText(path.join(base, "docs", "notice.md"), "NOTICE");
    const cataloguePretty = loadJsonPretty(
      path.join(base, "docs", "catalogue.json"),
      "CATALOGUE"
    );

    // --- contexte injecté
    const CONTEXT = [
      "=== NOTICE (extraits METRIX) ===",
      notice,
      "",
      "=== CATALOGUE_JSON (stock PEDUZZI : refs / désignations / poids) ===",
      cataloguePretty
    ].join("\n");

    // --- politique de sortie & anti-boucle (renforce le SYSTEM_PROMPT)
    const OUTPUT_POLICY = [
      "Anti-boucle & logique d’état (OBLIGATOIRE) :",
      "- Maintiens une checklist interne : { longueur_L, hauteur_H, largeur (1,00 m par défaut ou 0,70 m si dit), protection_côté_mur (oui/non), grutage (oui/non) }.",
      "- À chaque tour : extrais les infos déjà données, mets à jour la checklist.",
      "- Ne repose JAMAIS une question déjà répondue.",
      "- S'il manque 1 info, pose UNE seule question courte pour cette info la plus bloquante.",
      "- Quand toutes les infos sont connues, génère immédiatement la liste finale (tableau HTML) sans re-questionner.",
      "",
      "Cas m² : si l’utilisateur parle en m² (ex. 40 m²), NE DÉDUIS RIEN. Demande explicitement longueur ET hauteur en mètres, puis continue.",
      "",
      "Sortie finale : un seul tableau HTML avec colonnes Référence | Désignation | Qté | PU(kg) | PT(kg), puis une ligne TOTAL GÉNÉRAL (kg).",
      "Utiliser uniquement des références présentes dans CATALOGUE_JSON ; sinon écrire « Référence indisponible au stock PEDUZZI » (sans inventer de poids).",
      "Ordre de fin : question protection côté mur (⚠️ obligatoire si espace > 20 cm) → question grutage → tableau final.",
      "Style : français pro, concis."
    ].join("\n");

    // --- appel OpenAI (non-streaming pour stabilité)
    const upstreamBody = {
      model: MODEL,
      temperature: 0.1, // plus bas => moins de dérives / redites
      top_p: 0.8,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: "Contexte utilisateur : " + (user?.email || "inconnu") },
        { role: "system", content: CONTEXT },
        { role: "system", content: OUTPUT_POLICY },
        ...messages
      ]
    };

    const upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(upstreamBody)
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
