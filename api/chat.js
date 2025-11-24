// api/chat.js
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID;

// CORS simple pour pouvoir appeler depuis ton front
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Parse le body si Vercel ne l’a pas déjà fait
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  const raw = await new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

// Nettoie les références de sources éventuelles
function cleanAnswer(text = "") {
  return (
    text
      // [source: ...] ou (source ...)
      .replace(/\[source[^\]]*\]/gi, "")
      .replace(/\(source[^\)]*\)/gi, "")
      // Lignes "Source: ..." / "Sources: ..."
      .replace(/^\s*sources?\s*:\s*.*$/gim, "")
      // Références numérotées [1], [12]
      .replace(/(\s|^)\[\d+\](?=\s|$)/g, " ")
      // Marques style  
      .replace(/【\d+[^】]*】/g, "")
      // Espaces / lignes vides en trop
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Méthode non autorisée" });

  try {
    if (!process.env.OPENAI_API_KEY)
      return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    if (!ASST_ID)
      return res.status(500).json({ error: "ASST_ID manquante" });

    const { question, threadId: incomingThreadId } = await readJsonBody(req);

    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Question manquante" });
    }

    let threadId = incomingThreadId || null;

    // 1) Créer un thread si besoin (nouveau sujet)
    if (!threadId) {
      const created = await client.beta.threads.create();
      threadId = created.id;
    }

    // 2) Ajouter le message user au thread
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: question,
    });

    // 3) Lancer le run et attendre la fin
    const run = await client.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: ASST_ID,
    });

    if (run.status !== "completed") {
      return res
        .status(200)
        .json({ answer: `Non précisé (run: ${run.status}).`, threadId });
    }

    // 4) Récupérer la dernière réponse de l’assistant
    const msgs = await client.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 5,
    });

    const assistantMsg = msgs.data.find((m) => m.role === "assistant");
    const rawAnswer =
      assistantMsg?.content
        ?.map((c) => (c.type === "text" ? c.text.value : ""))
        .join("\n")
        .trim() || "Non précisé dans les documents.";

    const answer = cleanAnswer(rawAnswer);

    return res.status(200).json({ answer, threadId });
  } catch (e) {
    console.error("chat:", e?.response?.data || e);
    return res
      .status(500)
      .json({ error: e?.message || "Erreur interne côté serveur" });
  }
}
// --- Catalogue officiel ALTRAD METRIX (extrait) ---
// Poids en kg, d'après ton bon de commande + notice.
// Le modèle NE doit utiliser que ces références pour la liste de matériel.

const CATALOG = {
  ALTASV5: {
    ref: "ALTASV5",
    designation: "Socle à vérin 0,61 m",
    poids: 3.2,
  },
  ALTKFSV: {
    ref: "ALTKFSV",
    designation: "Fixe socle à vérin",
    poids: 3.1,
  },
  ALTKEMB: {
    ref: "ALTKEMB",
    designation: "Embase de départ",
    poids: 2.1,
  },
  ALTKPT1: {
    ref: "ALTKPT1",
    designation: "Poteau standard hauteur 1,00 m",
    poids: 5.4,
  },
  ALTKPT2: {
    ref: "ALTKPT2",
    designation: "Poteau standard hauteur 2,00 m",
    poids: 9.9,
  },
  ALTKLC2: {
    ref: "ALTKLC2",
    designation: "Lisse 1,00 m (perpendiculaire)",
    poids: 4.0,
  },
  ALTKLC5: {
    ref: "ALTKLC5",
    designation: "Lisse 2,50 m (protection échelle)",
    poids: 8.5,
  },
  ALTKMC5: {
    ref: "ALTKMC5",
    designation: "Plancher acier 2,50 × 0,30 m",
    poids: 17.3,
  },
  ALTKPE5: {
    ref: "ALTKPE5",
    designation: "Plancher trappe 2,50 × 0,60 m",
    poids: 25.4,
  },
  ALTKGH5: {
    ref: "ALTKGH5",
    designation: "Garde-corps permanent de sécurité 2,50 m",
    poids: 13.3,
  },
  ALTKGH2: {
    ref: "ALTKGH2",
    designation: "Garde-corps permanent de sécurité 1,00 m avec plinthe intégrée",
    poids: 8.5,
  },
  ALTKPI5: {
    ref: "ALTKPI5",
    designation: "Plinthe bois 2,50 m",
    poids: 4.9,
  },
  ALTKDV5: {
    ref: "ALTKDV5",
    designation: "Diagonale verticale 2,50 × 2,00 m",
    poids: 11.2,
  },
  ALT00S75: {
    ref: "ALT00S75",
    designation: "Stabilisateur télescopique 3,30 à 6,00 m",
    poids: 3.2,
  },
  ALTL99P: {
    ref: "ALTL99P",
    designation: "Cale bois",
    poids: 1.1,
  },
  ALTRLEV: {
    ref: "ALTRLEV",
    designation: "Crochet de levage",
    poids: 1.1,
  },
  ALTKB12: {
    ref: "ALTKB12",
    designation: "Boulon de jonction 12 × 60 mm (poteaux)",
    poids: 0.1,
  },
  ALTAA2: {
    ref: "ALTAA2",
    designation: "Tube d’amarrage 1,00 m crochet coudé",
    poids: 3.9,
  },
  ALTAR12: {
    ref: "ALTAR12",
    designation: "Tige d’amarrage diamètre 12 longueur 120 mm",
    poids: 1.0,
  },
  ALTACPI: {
    ref: "ALTACPI",
    designation: "Coupleur de levage pour tube 48,3 mm",
    poids: 2.0,
  },
};

