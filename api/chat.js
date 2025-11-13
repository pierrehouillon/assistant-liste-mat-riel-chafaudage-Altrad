// api/chat.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Fonction Serverless Vercel classique (Node.js)
module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const userMessages = body.messages || [];

    // Petit garde-fou : si pas de messages, on répond gentiment
    if (!Array.isArray(userMessages) || userMessages.length === 0) {
      res.status(400).json({ error: "messages manquants" });
      return;
    }

    // Message système simple (on remettra plus tard les règles complètes/vector store)
    const systemMessage = {
      role: "system",
      content:
        "Tu es l'assistant ALTRAD METRIX. Réponds en français, avec un ton de collègue chantier, en aidant à configurer un échafaudage.",
    };

    const messages = [systemMessage, ...userMessages];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const answer = completion.choices[0].message.content;
    // On renvoie juste du texte brut (plus simple pour le front)
    res.status(200).send(answer);
  } catch (err) {
    console.error("Erreur /api/chat :", err);
    res.status(500).json({ error: "Erreur interne API chat" });
  }
};
