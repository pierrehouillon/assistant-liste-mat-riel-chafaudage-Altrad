// api/ask.js
import OpenAI from "openai";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const ASST_ID = process.env.ASST_ID;

// CORS simple
function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

// Parse body si Vercel ne l’a pas déjà fait
async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;

  return await new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
  });
}

// Nettoyage de la réponse (suppression des [1],  etc.)
function cleanAnswer(text = "") {
  return text
    .replace(/\[source[^\]]*\]/gi, "")
    .replace(/\(source[^\)]*\)/gi, "")
    .replace(/^\s*sources?\s*:\s*.*$/gim, "")
    .replace(/(\s|^)\[\d+\](?=\s|$)/g, " ")
    .replace(/【\d+[^】]*】/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
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

    // 1) Créer un thread si besoin
    if (!threadId) {
      const created = await client.beta.threads.create();
      threadId = created.id;
    }

    // 2) Ajouter la question de l'utilisateur
    await client.beta.threads.messages.create(threadId, {
      role: "user",
      content: question,
    });

    // 3) Lancer le run de ton assistant METRIX
    const run = await client.beta.threads.runs.createAndPoll(threadId, {
      assistant_id: ASST_ID,
    });

    if (run.status !== "completed") {
      return res
        .status(200)
        .json({ answer: `Run non terminé (${run.status}).`, threadId });
    }

    // 4) Récupérer la dernière réponse assistant
    const msgs = await client.beta.threads.messages.list(threadId, {
      order: "desc",
      limit: 5,
    });

    const assistantMsg = msgs.data.find((m) => m.role === "assistant");

    const rawAnswer =
      assistantMsg?.content
        ?.map((c) => (c.type === "text" ? c.text.value : ""))
        .join("\n")
        .trim() || "Pas de réponse disponible.";

    const answer = cleanAnswer(rawAnswer);

    return res.status(200).json({ answer, threadId });
  } catch (e) {
    console.error("ask METRIX:", e?.response?.data || e);
    return res
      .status(500)
      .json({ error: e?.message || "Erreur interne API METRIX" });
  }
}
