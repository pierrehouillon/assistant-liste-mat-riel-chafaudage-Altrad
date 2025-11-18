// api/ask.js
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID; // Assistant Échafaudage ALTRAD METRIX

// CORS simple
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Lecture JSON compatible Vercel
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

// Nettoyage des petites références [1], Sources:, etc.
function cleanAnswer(text = "") {
  return (
    text
      .replace(/\[source[^\]]*\]/gi, "")
      .replace(/\(source[^\)]*\)/gi, "")
      .replace(/^\s*sources?\s*:\s*.*$/gim, "")
      .replace(/(\s|^)\[\d+\](?=\s|$)/g, " ")
      .replace(/【\d+[^】]*】/g, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]{2,}/g, " ")
      .trim()
  );
}

export default async function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    if (!process.env.OPENAI_API_KEY) {
      return res.status(500).json({ error: "OPENAI_API_KEY manquante" });
    }
    if (!ASST_ID) {
      return res.status(500).json({ error: "ASST_ID manquante" });
    }

    const { question, threadId: incomingThreadId } = await readJsonBody(req);
    if (!question || typeof question !== "string") {
      return res.status(400).json({ error: "Question manquante" });
    }

    let threadId = incomingThreadId || null;

    // 1) Nouveau thread si pas de threadId → nouveau chantier
    if (!threadId) {
      const created = await client.beta.threads.create();
      threadId = created.id;
    }

    // 2) Ajout du message utilisateur
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: question,
    });

    // 3) Run de l'assistant METRIX
    const run = await client.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: ASST_ID,
    });

    if (run.status !== "completed") {
      return res.status(200).json({
        answer: `La réponse n'est pas complète (run: ${run.status}).`,
        threadId,
      });
    }

    // 4) Dernière réponse assistant
    const msgs = await client.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 5,
    });

    const assistantMsg = msgs.data.find((m) => m.role === "assistant");
    const rawAnswer =
      assistantMsg?.content
        ?.map((c) => (c.type === "text" ? c.text.value : ""))
        .join("\n")
        .trim() || "Pas de réponse.";

    const answer = cleanAnswer(rawAnswer);

    return res.status(200).json({ answer, threadId });
  } catch (e) {
    console.error("ask METRIX:", e?.response?.data || e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
