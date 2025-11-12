// api/chat.js
// Vercel Node serverless — Anti-boucle côté serveur :
// 1) On extrait l'état (Checklist) depuis TOUT l'historique.
// 2) On dit au modèle exactement ce qui est connu / manquant.
// 3) On lui ordonne : poser UNE seule question manquante OU produire la liste finale.

import fs from "fs";
import path from "path";

/* ----------------- Utils lecture fichiers ----------------- */
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

/* ----------------- Extraction Checklist depuis l'historique ----------------- */
/**
 * Très simple heuristique FR :
 * - Longueur / Hauteur / Largeur : cherche "<nombre> m" proche des mots-clés.
 * - Protection côté mur : "proteger/protection + oui/non", "côté mur", "coté mur", "mur".
 * - Grutage : "gruter/grutage + oui/non".
 * - Largeur : par défaut 1.00 m si non précisée.
 * On lit TOUT l'historique user+assistant (ordonné) => dernier mentionné gagne.
 */
function parseChecklist(allMessages) {
  // État par défaut
  const state = {
    type: "façade_droite",
    longueur_L: null,   // en m (nombre)
    hauteur_H: null,    // en m (nombre)
    largeur: 1.0,       // par défaut 1.00 m
    largeur_source: "defaut", // "defaut" | "user"
    protection_cote_mur: null, // true/false
    grutage: null,      // true/false
  };

  const numRe = "(\\d+(?:[\\.,]\\d+)?)\\s*m"; // capture 12,5 m / 12.5 m / 12 m
  const reLong = new RegExp("(longueur|long|façade)\\s*(?:de|:)?\\s*" + numRe, "i");
  const reHaut = new RegExp("(hauteur|haut)\\s*(?:de|:)?\\s*" + numRe, "i");
  const reLarg = new RegExp("(largeur|profondeur)\\s*(?:de|:)?\\s*" + numRe, "i");

  const yesWords = ["oui", "yes", "y", "ok", "obligatoire"];
  const noWords  = ["non", "no", "n"];

  function toFloat(fr) {
    if (!fr) return null;
    const s = String(fr).replace(",", ".").trim();
    const v = parseFloat(s);
    return Number.isFinite(v) ? v : null;
  }
  function scanYesNo(text) {
    const t = text.toLowerCase();
    for (const w of yesWords) if (t.includes(w)) return true;
    for (const w of noWords)  if (t.includes(w)) return false;
    return null;
  }

  for (const m of allMessages) {
    if (!m || typeof m.content !== "string") continue;
    const t = m.content.toLowerCase();

    // largeur
    const mlarg = m.content.match(reLarg);
    if (mlarg) {
      const v = toFloat(mlarg[2]);
      if (v) {
        state.largeur = v;
        state.largeur_source = "user";
      }
    } else {
      // phrases "0,70", "0.70", "70 cm"
      const quick070 = /0[\.,]?70\s*m/;
      const quick100 = /1([\.,]00)?\s*m/;
      if (quick070.test(t)) { state.largeur = 0.7; state.largeur_source = "user"; }
      if (/\b70\s*cm\b/.test(t)) { state.largeur = 0.7; state.largeur_source = "user"; }
      if (quick100.test(t)) { state.largeur = 1.0; state.largeur_source = "user"; }
    }

    // longueur
    const mlong = m.content.match(reLong);
    if (mlong) {
      const v = toFloat(mlong[2]);
      if (v) state.longueur_L = v;
    } else {
      // phrases comme "5m de long", "long de 5m"
      const m2 = m.content.match(new RegExp(numRe + "\\s*(de\\s*)?(long|longueur)", "i"));
      if (m2) {
        const v = toFloat(m2[1]);
        if (v) state.longueur_L = v;
      }
    }

    // hauteur
    const mhaut = m.content.match(reHaut);
    if (mhaut) {
      const v = toFloat(mhaut[2]);
      if (v) state.hauteur_H = v;
    } else {
      const m2 = m.content.match(new RegExp(numRe + "\\s*(de\\s*)?(haut|hauteur)", "i"));
      if (m2) {
        const v = toFloat(m2[1]);
        if (v) state.hauteur_H = v;
      }
    }

    // protection côté mur
    if (t.includes("côté mur") || t.includes("coté mur") || t.includes("mur")) {
      const yn = scanYesNo(t);
      if (yn !== null) state.protection_cote_mur = yn;
    }
    if (t.includes("proteger la façade") || t.includes("protection façade") || t.includes("protection de la façade")) {
      const yn = scanYesNo(t);
      if (yn !== null) state.protection_cote_mur = yn;
    }

    // grutage
    if (t.includes("gruter") || t.includes("grutage") || t.includes("levage")) {
      const yn = scanYesNo(t);
      if (yn !== null) state.grutage = yn;
    }
  }

  return state;
}

/* ----------------- construction d'une directive "prochaine action" ----------------- */
function nextActionFromState(state) {
  // Ordre de priorité : L, H, (largeur = par défaut, donc on ne bloque pas), protection, grutage
  if (!state.longueur_L) {
    return {
      action: "ask",
      question: "Donne-moi la **longueur** de ta façade (en mètres).",
      known: state
    };
  }
  if (!state.hauteur_H) {
    return {
      action: "ask",
      question: "Donne-moi la **hauteur** de ta façade (en mètres).",
      known: state
    };
  }
  if (state.protection_cote_mur === null) {
    return {
      action: "ask",
      question:
        "Souhaites-tu **protéger la façade côté mur** ? ⚠️ Si l’espace échafaudage ↔ mur est **> 20 cm**, la protection est **obligatoire**.",
      known: state
    };
  }
  if (state.grutage === null) {
    return {
      action: "ask",
      question: "Souhaites-tu **gruter** l’échafaudage ?",
      known: state
    };
  }
  return { action: "produce_list", known: state };
}

/* ----------------- Handler Vercel ----------------- */
export default async function handler(req, res) {
  // CORS minimal
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }
  if (req.method !== "POST") { res.status(405).send("Method Not Allowed"); return; }

  try {
    const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
    const MODEL = process.env.MODEL || "gpt-4o-mini";
    const SYSTEM_PROMPT =
      process.env.SYSTEM_PROMPT ||
      "Tu es ALTRAD Assistant, expert échafaudage METRIX. Réponds en français.";

    if (!OPENAI_API_KEY) { res.status(500).send("OPENAI_API_KEY manquant."); return; }

    const { messages = [], user } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).send("Payload invalide : messages[] requis."); return;
    }

    // 1) Charger NOTICE + CATALOGUE
    const base = process.cwd();
    const notice = loadText(path.join(base, "docs", "notice.md"), "NOTICE");
    const cataloguePretty = loadJsonPretty(path.join(base, "docs", "catalogue.json"), "CATALOGUE");

    // 2) Construire l'état (Checklist) depuis tout l'historique user+assistant
    const convoForState = messages.filter(m => m && typeof m.content === "string");
    const state = parseChecklist(convoForState);
    const next = nextActionFromState(state);

    // 3) Contexte envoyé au modèle
    const CONTEXT = [
      "=== NOTICE (extraits METRIX) ===",
      notice,
      "",
      "=== CATALOGUE_JSON (stock PEDUZZI : refs/désignations/poids) ===",
      cataloguePretty,
      "",
      "=== CHECKLIST ACTUELLE (état consolidé) ===",
      JSON.stringify(state, null, 2),
      "",
      "=== DIRECTIVE SERVEUR (obligatoire) ===",
      next.action === "ask"
        ? [
            "Une seule question à poser (ne pas en poser d'autres) :",
            next.question,
            "NEREPOSE PAS une info déjà connue dans la checklist ci-dessus."
          ].join("\n")
        : [
            "Toutes les infos nécessaires sont connues. PRODUIS maintenant la **liste finale**.",
            "- Un seul **tableau HTML** : Référence | Désignation | Qté | PU(kg) | PT(kg).",
            "- Ajouter la ligne **TOTAL GÉNÉRAL (kg)**.",
            "- Utiliser **uniquement** des références présentes dans CATALOGUE_JSON.",
            "- Rappeler en fin : “Tu peux maintenant saisir ta commande dans **ta tablette** ou sur le **Back Office PEDUZZI**.”"
          ].join("\n")
    ].join("\n");

    // 4) Policy anti-boucle supplémentaire
    const OUTPUT_POLICY = [
      "Règles anti-boucle :",
      "- Ne pas reposer de question déjà renseignée dans la CHECKLIST ACTUELLE.",
      "- Si next_action = ask, ne poser **qu'une seule** question (celle fournie).",
      "- Si next_action = produce_list, générer directement le tableau final sans poser de question.",
      "",
      "Cas m² : si l’utilisateur donne uniquement une surface (ex. 40 m²), **ne rien déduire**. Demander explicitement longueur ET hauteur.",
      "",
      "Rappels techniques : largeur par défaut 1,00 m (0,70 m si spécifié). 1 trappe par niveau. Stabilisation : ≤6 m stabilisateurs seulement, >6 m ancrages muraux seulement. 1 lisse 2,50 m par échelle; 1 diagonale verticale 2,50×2,00 pour la première échelle."
    ].join("\n");

    // 5) Appel OpenAI non-streaming (stable)
    const upstreamBody = {
      model: MODEL,
      temperature: 0.1,
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

