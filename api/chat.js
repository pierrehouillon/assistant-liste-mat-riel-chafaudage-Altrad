// api/chat.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --- Utilitaires -----------------------------------------

// Cherche longueur + hauteur dans un texte
function extractLengthHeight(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

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

// Dernières dimensions trouvées dans l’HISTORIQUE complet
function findLastDims(messages) {
  let last = null;
  for (const m of messages) {
    if (!m || m.role !== "user" || !m.content) continue;
    const dims = extractLengthHeight(m.content);
    if (dims) last = dims;
  }
  return last;
}

// Détection si on parle de surface (m²)
function mentionsSurface(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /\b(m²|m2|mètre carré|metre carré|mètres carrés|metres carres|surface)\b/.test(
    lower
  );
}

// Détection d’une réponse sur la protection côté mur
function detectProtectionAnswer(messages) {
  let lastAnswer = null;
  for (const m of messages) {
    if (!m || m.role !== "user" || !m.content) continue;
    const txt = m.content.toLowerCase();
    if (
      txt.includes("protection") ||
      txt.includes("façade") ||
      txt.includes("facade") ||
      txt.includes("côté mur") ||
      txt.includes("cote mur")
    ) {
      lastAnswer = m.content.trim();
    } else if (
      (txt === "oui" || txt === "non") &&
      lastAnswer === null // réponse courte juste après la question
    ) {
      lastAnswer = m.content.trim();
    }
  }
  return lastAnswer;
}

// ----------------------------------------------------------

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const userMessages = body.messages || [];

    if (!Array.isArray(userMessages) || userMessages.length === 0) {
      res.status(400).json({ error: "messages manquants" });
      return;
    }

    const lastUserMsg = [...userMessages].reverse().find(
      (m) => m && m.role === "user"
    );

    const extraSystemMessages = [];

    // 1) Dernières dimensions connues dans TOUT l'historique
    const dimsHist = findLastDims(userMessages);
    if (dimsHist) {
      extraSystemMessages.push({
        role: "system",
        content: `Dans l'historique, l'utilisateur a déjà donné les dimensions suivantes : longueur = ${dimsHist.L} m et hauteur = ${dimsHist.H} m. 
Ce sont les dimensions de référence pour toute la suite de la conversation. 
Tu ne dois plus prétendre qu'elles manquent ni les redemander, même si le dernier message utilisateur est juste "oui" ou "non".`,
      });
    }

    // 2) Si le dernier message parle de surface en m²
    if (lastUserMsg && mentionsSurface(lastUserMsg.content)) {
      extraSystemMessages.push({
        role: "system",
        content:
          "Le dernier message utilisateur parle de surface (m²). Tu dois lui demander de CHOISIR lui-même la longueur ET la hauteur, et tu n'as pas le droit de les déduire automatiquement.",
      });
    }

    // 3) Réponse à la question 'protection façade côté mur'
    const prot = detectProtectionAnswer(userMessages);
    if (prot) {
      extraSystemMessages.push({
        role: "system",
        content: `L'utilisateur a déjà répondu à la question sur la protection de la façade côté mur avec : "${prot}". 
Tu ne dois plus reposer cette question et tu dois configurer l'échafaudage en respectant cette réponse.`,
      });
    }

    // --- GROS system prompt métier ---------------------------------
    const mainSystemMessage = {
      role: "system",
      content: `
Tu es **ALTRAD Assistant METRIX**, collègue chantier expérimenté.
Tu aides les collaborateurs à préparer une **liste de matériel ALTRAD METRIX** complète, cohérente et sécurisée, prête à être commandée (catalogue Peduzzi).
Tu réponds toujours en français, ton concret et bienveillant.

INTERDICTIONS IMPORTANTES :
- Tu ne dois JAMAIS écrire ni paraphraser la phrase :
  "Pour calculer correctement, donne-moi la longueur ET la hauteur que tu veux."
- Tu ne dois JAMAIS écrire "X m de long" ou "Y m de haut". 
  Tu dois toujours utiliser de vraies valeurs chiffrées (par ex. "5 m de long et 6 m de haut") ou reformuler sans ces placeholders.
- Si des dimensions (longueur et hauteur) existent déjà dans l'historique, tu les considères comme **définitives** et tu ne dis plus qu'elles manquent.

=====================
RÈGLES D'ÉCHAFAUDAGE (résumé)
=====================
- Type : échafaudage **droit de façade** uniquement.
- Largeur par défaut : **1,00 m**, sauf si l'utilisateur demande explicitement 0,70 m.
- Hauteur de niveau : 2,00 m.
- Travées = ceil(longueur / 2,5).
- Niveaux = ceil(hauteur / 2).

- Niveau de base :
  - Socles à vérin 0,61 m.
  - Embases de départ.
  - Poteaux 1,00 m.
  - 3 planchers acier 2,50 x 0,30 m pour supporter la première échelle.

- Niveaux supérieurs :
  - Poteaux 2,00 m.
  - 1 plancher trappe par niveau.
  - Planchers acier pour compléter la largeur (1,00 m ou 0,70 m).

=====================
PROTECTION CÔTÉ MUR
=====================
- Tant que la réponse n'est pas connue, tu demandes UNE SEULE FOIS :
  "Souhaites-tu protéger la façade côté mur ? ⚠️ Obligatoire si l'espace entre l'échafaudage et le mur est supérieur à 20 cm."
- Si l'utilisateur a déjà répondu (ex. "oui", "non pas de protection façade"), tu n'y reviens plus.

=====================
GRUTAGE
=====================
- Si le besoin de grutage n'a pas encore été traité, tu demandes UNE SEULE FOIS :
  "Prévois-tu de lever ou gruter l'échafaudage ?"
- Si OUI : tu ajoutes les accessoires de levage adaptés et tu rappelles de bien verrouiller embases et poteaux.

=====================
ANTI-BOUCLE QUESTIONS
=====================
En te basant sur TOUT l'historique reçu dans "messages" :
1. Si aucune longueur n'est connue, tu demandes la longueur.
2. Sinon si aucune hauteur n'est connue, tu demandes la hauteur.
3. Sinon si la largeur n'est pas précisée, tu proposes 1,00 m par défaut ou 0,70 m si besoin.
4. Sinon si la protection côté mur n'est pas connue, tu poses la question.
5. Sinon si le grutage n'est pas connu, tu poses la question.
6. Sinon, tu arrêtes de poser des questions et tu calcules directement la liste de matériel.

=====================
LISTE FINALE
=====================
Quand toutes les infos nécessaires sont connues :
- Tu produis un tableau **Markdown** avec les colonnes :
  Référence | Désignation | Qté | Poids unitaire (kg) | Poids total (kg)
- Puis une ligne : "TOTAL GÉNÉRAL : XXX kg".
- Tu termines par :
  "Voici ta liste complète. Tu peux maintenant saisir ta commande sur ta tablette ou dans le Back Office Peduzzi."
      `,
    };

    const messages = [mainSystemMessage, ...extraSystemMessages, ...userMessages];

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
    });

    const answer = completion.choices[0].message.content;
    res.status(200).send(answer);
  } catch (err) {
    console.error("Erreur /api/chat :", err);
    res.status(500).json({ error: "Erreur interne API chat" });
  }
};



