import OpenAI from "openai";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Méthode non autorisée" });
  }

  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const ASST_ID = process.env.ASST_ID;

    if (!ASST_ID) {
      return res.status(500).json({ error: "ASST_ID manquant dans Vercel" });
    }

    const { messages } = await req.json?.() || req.body;

    // Sécurité : si rien envoyé
    if (!messages) {
      return res.status(400).json({ error: "messages manquants" });
    }

    // --- ICI : appel à ton assistant OpenAI ---
    const thread = await client.beta.threads.create({
      messages: messages.map(m => ({
        role: m.role,
        content: m.content
      }))
    });

    const run = await client.beta.threads.runs.createAndPoll(thread.id, {
      assistant_id: ASST_ID
    });

    const list = await client.beta.threads.messages.list(thread.id, {
      order: "desc",
      limit: 1
    });

    const answer =
      list.data?.[0]?.content?.[0]?.text?.value ||
      "Erreur : aucune réponse assistant";

    res.status(200).json({ answer });

  } catch (e) {
    console.error("❌ Erreur API /chat :", e);
    res.status(500).json({ error: e.message || "Erreur interne" });
  }
}
