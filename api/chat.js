// api/chat.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --------- Utilitaires simples ---------

function mentionsSurface(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /\b(m²|m2|metre carré|mètre carré|mètres carrés|surface)\b/.test(lower);
}

// extrait longueur + hauteur depuis un texte utilisateur (ex. "5m de long par 6m de haut")
function extractLengthHeight(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // on veut "long" + "haut" dans le même message
  const hasLong = lower.includes("long") || lower.includes("longueur");
  const hasHaut = lower.includes("haut") || lower.includes("hauteur");
  if (!hasLong || !hasHaut) return null;

  const regex = /(\d+(?:[.,]\d+)?)\s*m\b/g;
  const matches = [...lower.matchAll(regex)];
  if (matches.length < 2) return null;

  const L = parseFloat(matches[0][1].replace(",", "."));
  const H = parseFloat(matches[1][1].replace(",", "."));
  if (isNaN(L) || isNaN(H)) return null;

  return { L, H };
}

// Parcourt tous les messages user pour trouver la DERNIÈRE paire (L,H)
function findDims(messages) {
  const users = messages.filter(
    (m) => m && m.role === "user" && typeof m.content === "string"
  );
  let last = null;
  for (const m of users) {
    const d = extractLengthHeight(m.content);
    if (d) last = d;
  }
  return last;
}

// Cherche la dernière réponse OUI/NON à la question "protection façade côté mur ?"
function findProtectionAnswer(messages) {
  let lastProtQuestionIndex = -1;

  messages.forEach((m, idx) => {
    if (
      m &&
      m.role === "assistant" &&
      typeof m.content === "string" &&
      m.content.includes("Souhaites-tu protéger la façade côté mur")
    ) {
      lastProtQuestionIndex = idx;
    }
  });

  if (lastProtQuestionIndex === -1) return null;

  for (let i = messages.length - 1; i > lastProtQuestionIndex; i--) {
    const m = messages[i];
    if (!m || m.role !== "user" || typeof m.content !== "string") continue;
    const t = m.content.trim().toLowerCase();
    if (t.startsWith("oui")) return "oui";
    if (t.startsWith("non")) return "non";
  }
  return null;
}

// Cherche la dernière réponse OUI/NON à la question "Souhaites-tu gruter ton échafaudage ?"
function findGrutageAnswer(messages) {
  let lastQuestionIndex = -1;

  messages.forEach((m, idx) => {
    if (
      m &&
      m.role === "assistant" &&
      typeof m.content === "string" &&
      m.content.includes("Souhaites-tu gruter ton échafaudage")
    ) {
      lastQuestionIndex = idx;
    }
  });

  if (lastQuestionIndex === -1) return null;

  for (let i = messages.length - 1; i > lastQuestionIndex; i--) {
    const m = messages[i];
    if (!m || m.role !== "user" || typeof m.content !== "string") continue;
    const t = m.content.trim().toLowerCase();
    if (t.startsWith("oui")) return "oui";
    if (t.startsWith("non")) return "non";
  }
  return null;
}

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const history = Array.isArray(body.messages) ? body.messages : [];

    if (history.length === 0) {
      res.status(400).json({ error: "messages manquants" });
      return;
    }

    const lastUserMsg = [...history].reverse().find(
      (m) => m && m.role === "user"
    );

    const dims = findDims(history);                // { L, H } ou null
    const prot = findProtectionAnswer(history);    // "oui", "non" ou null
    const grut = findGrutageAnswer(history);       // "oui", "non" ou null

    // ---------------------------------------------
    // 1) Cas surface (m²) sans dimensions explicites
    // ---------------------------------------------
    if (lastUserMsg && mentionsSurface(lastUserMsg.content) && !dims) {
      res
        .status(200)
        .send(
          "Pour calculer correctement, donne-moi la longueur **ET** la hauteur que tu veux. Je ne les déduis jamais automatiquement à partir des m²."
        );
      return;
    }

    // ---------------------------------------------
    // 2) Si on n’a pas encore longueur / hauteur -> on demande
    // ---------------------------------------------
    if (!dims) {
      res
        .status(200)
        .send(
          "Pour que je calcule ton échafaudage, donne-moi la longueur **et** la hauteur de ta façade (en mètres). Exemple : 5 m de long par 6 m de haut."
        );
      return;
    }

    const { L, H } = dims;

    // ---------------------------------------------
    // 3) Question obligatoire : protection côté mur
    //    (une seule fois tant qu’on n’a pas la réponse)
    // ---------------------------------------------
    if (!prot) {
      res
        .status(200)
        .send(
          `OK, on part sur un échafaudage droit de façade de ${L} m de long et ${H} m de haut.\n\nSouhaites-tu protéger la façade côté mur ?\n⚠️ Obligatoire si l’espace entre l’échafaudage et le mur est supérieur à 20 cm.`
        );
      return;
    }

    // ---------------------------------------------
    // 4) Question grutage (une seule fois)
    // ---------------------------------------------
    if (!grut) {
      res
        .status(200)
        .send(
          "Parfait, j’ai noté ta réponse pour la protection côté mur.\n\nDernière question sécurité : souhaites-tu **gruter** ton échafaudage ?"
        );
      return;
    }

    // ---------------------------------------------
    // 5) Tous les paramètres sont connus -> on calcule la liste
    //    via OpenAI (une seule réponse, plus de questions)
    // ---------------------------------------------
    const systemMessage = {
      role: "system",
      content: `
Tu es ALTRAD Assistant, expert échafaudages terrain spécialisé dans la gamme ALTRAD METRIX.
Tu aides à préparer un échafaudage droit de façade complet, sécurisé et prêt à être commandé.

Tu appliques les règles suivantes (résumé) :

- Type : échafaudage droit de façade.
- Largeur par défaut : 1,00 m.
- Hauteur de niveau : 2,00 m.
- Travées = ceil(longueur / 2,5).
- Niveaux = ceil(hauteur / 2).
- Poteaux 1 m (ALTKPT1) au départ.
- Poteaux 2 m (ALTKPT2) pour les niveaux supérieurs.
- 1 plancher trappe ALTKPE5 par niveau.
- Planchers acier ALTKMC5 pour compléter chaque niveau.
- Garde-corps 2,50 m ALTKGH5, garde-corps 1,00 m ALTKGH2, plinthes ALTKPI5.
- Cales bois ALTL99P : 1 par socle + 1 par stabilisateur.
- Stabilisation : stabilisateurs ALT00S75 ou ancrages selon la hauteur.
- Protection façade côté mur : si OUI, on double garde-corps 2,50 m et plinthes 2,50 m côté mur.
- Grutage : si OUI, on ajoute crochets de levage ALTRLEV, boulons ALTKB12 et rappelle le verrouillage.

Tu réponds toujours en français, ton concret de collègue chantier.
Tu n’ajoutes plus de questions : tu calcules directement la liste pour les paramètres fournis.
Tu termines toujours par :
"Tu peux maintenant saisir ta commande sur ta tablette ou dans le back-office Peduzzi."
      `,
    };

    const userMessage = {
      role: "user",
      content: `
Paramètres d'échafaudage à traiter :

- Type : échafaudage droit de façade.
- Longueur : ${L} m.
- Hauteur : ${H} m.
- Largeur : 1,00 m.
- Protection façade côté mur : ${prot.toUpperCase()}.
- Grutage : ${grut.toUpperCase()}.

Tâche :

1. Rappelle brièvement la configuration (travées, niveaux, protection mur, grutage).
2. Calcule toutes les quantités de matériel conformément aux règles ALTRAD METRIX.
3. Affiche une "Liste complète de matériel" sous forme de tableau Markdown avec les colonnes :
   Référence | Désignation | Qté | Poids unitaire (kg) | Poids total (kg)
4. Calcule et affiche le TOTAL GÉNÉRAL en kg.
5. Si grutage = OUI, ajoute un rappel sécurité sur le verrouillage des embases (boulon 12×70) et des poteaux (boulon 12×60) avant levage.
6. Termine par :
   "Voici ta liste complète d’échafaudage ALTRAD METRIX droit de façade, conforme et prête à la commande.
   Tu peux maintenant saisir ta commande sur ta tablette ou dans le back-office Peduzzi."
      `.trim(),
    };

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [systemMessage, userMessage],
    });

    const answer = completion.choices[0].message.content || "";
    res.status(200).send(answer);
  } catch (err) {
    console.error("Erreur /api/chat :", err);
    res.status(500).json({ error: "Erreur interne API chat" });
  }
};

