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
      "Tu es ALTRAD Assistant, expert échafaudage METRIX. Réponds en français de manière concise et structurée.";

    if (!OPENAI_API_KEY) {
      res.status(500).send("OPENAI_API_KEY manquant.");
      return;
    }

    const { messages = [], user } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).send("Payload invalide: messages[] requis.");
      return;
    }

    const upstreamBody = {
      model: MODEL,
      stream: false,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: `Contexte utilisateur: ${user?.email || "inconnu"}` },
        ...messages,
      ],
    };

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
