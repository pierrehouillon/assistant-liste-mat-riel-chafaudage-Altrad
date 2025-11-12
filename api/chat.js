import fs from "fs";
import path from "path";

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

    // Charge les 2 documents locaux
    const base = process.cwd();
    const notice = fs.readFileSync(path.join(base, "docs", "notice.md"), "utf8");
    const catalogueRaw = fs.readFileSync(path.join(base, "docs", "catalogue.json"), "utf8");
    const catalogue = JSON.parse(catalogueRaw);

    const { messages = [], user } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      res.status(400).send("Payload invalide: messages[] requis.");
      return;
    }

    // Contexte injecté (notice + stock)
    const CONTEXT = [
      "=== NOTICE (extraits) ===",
      notice,
      "",
      "=== CATALOGUE_JSON (références/poids disponibles au stock PEDUZZI) ===",
      JSON.stringify(catalogue, null, 2)
    ].join("\n");

    // Consignes d’output : tableau HTML + total + rappel de saisie BO
    const OUTPUT_POLICY = `
- Toujours produire un **seul tableau HTML** avec les colonnes : Référence | Désignation | Qté | PU(kg) | PT(kg).
- Calculer et afficher la **ligne TOTAL GÉNÉRAL (kg)**.
- N'utiliser **que** les références présentes dans CATALOGUE_JSON. Si une référence n'existe pas, écrire "Référence indisponible au stock PEDUZZI" et ne pas inventer le poids.
- Si une info essentielle manque, poser **une seule** question courte puis produire la liste.
- Avant la sortie finale, demander : "Souhaites-tu protéger la façade côté mur ? Obligatoire si l’espace > 20 cm." puis "Veux-tu **gruter** l’échafaudage ?".
- Finir par : "Tu peux maintenant saisir ta commande dans **ta tablette** ou sur le **Back Office PEDUZZI**."
`;

    // On permet un bouton "Lister maintenant" via un message /force_list
    const last = messages[messages.length - 1]?.content || "";
    const forceList = last && last.toLowerCase().includes("/force_list");

    const upstreamBody = {
      model: MODEL,
      temperature: 0.2,
      top_p: 0.9,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "system", content: "Contexte utilisateur: " + (user?.email || "inconnu") },
        { role: "system", content: CONTEXT },
        { role: "system", content: OUTPUT_POLICY },
        ...(forceList
          ? [{ role: "system", content: "L'utilisateur a demandé la liste immédiatement : **produis la liste complète maintenant**." }]
          : []),
        ...messages
      ],
      stream: false
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
