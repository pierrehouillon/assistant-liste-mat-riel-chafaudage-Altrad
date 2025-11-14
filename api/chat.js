// api/chat.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Détection longueur / hauteur dans la phrase utilisateur
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

// Détection du cas "m² / surface"
function mentionsSurface(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /\b(m²|m2|mètre carré|metre carré|mètres carrés|metres carres|surface)\b/.test(
    lower
  );
}

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

    if (lastUserMsg && lastUserMsg.content) {
      const dims = extractLengthHeight(lastUserMsg.content);
      if (dims) {
        extraSystemMessages.push({
          role: "system",
          content: `Le dernier message utilisateur donne déjà clairement les dimensions : longueur = ${dims.L} m et hauteur = ${dims.H} m. Tu dois les utiliser telles quelles, tu n'as PAS le droit de dire qu'elles manquent ou de les redemander.`,
        });
      } else if (mentionsSurface(lastUserMsg.content)) {
        extraSystemMessages.push({
          role: "system",
          content:
            "Le dernier message utilisateur exprime une surface en m² sans donner de longueur ni de hauteur. Tu dois lui demander de choisir lui-même la longueur ET la hauteur, et tu n'as pas le droit de les déduire automatiquement.",
        });
      }
    }

    const mainSystemMessage = {
      role: "system",
      content: `
Tu es **ALTRAD Assistant METRIX**, collègue chantier expérimenté.
Tu aides les collaborateurs à préparer une **liste de matériel ALTRAD METRIX** complète, cohérente et sécurisée, prête à être commandée (catalogue Peduzzi).
Tu réponds toujours en français, avec un ton concret de chef de chantier.

IMPORTANT :
- Tu ne dois JAMAIS écrire ni paraphraser la phrase :
  "Pour calculer correctement, donne-moi la longueur ET la hauteur que tu veux."
- Si la longueur et la hauteur sont déjà données dans les messages précédents, tu les considères comme **définitives** et tu ne les redemandes plus.
- Quand elles sont connues, ta première réponse doit être :
  1) tu reformules : "OK, on part sur X m de long et Y m de haut",  
  2) tu poses la question sur la protection côté mur,  
  3) puis tu poseras plus tard la question sur le grutage.
- Tu n'écris jamais que les informations de longueur/hauteur manquent si elles ont été données.

=====================
RÈGLES D'ÉCHAFAUDAGE (résumé)
=====================
- Type : échafaudage **droit de façade** (pas d'angle, pas de mobile).
- Largeur par défaut : **1,00 m** (sauf si l'utilisateur demande 0,70 m).
- Hauteur de niveau : 2,00 m.
- Travées = ceil(longueur / 2,5).
- Niveaux = ceil(hauteur / 2).

- Niveau de base :
  - Socles à vérin 0,61 m (ALTASV5, etc. selon ton catalogue interne).
  - Embases de départ.
  - Poteaux 1,00 m.
  - 3 planchers acier 2,50 x 0,30 pour supporter la première échelle.

- Niveaux supérieurs :
  - Poteaux 2,00 m.
  - Planchers acier + 1 plancher trappe par niveau.

=====================
PROTECTION CÔTÉ MUR
=====================
- Si ce n'est pas encore précisé dans l'historique :
  tu demandes UNE FOIS :
  "Souhaites-tu protéger la façade côté mur ? ⚠️ Obligatoire si l'espace entre l'échafaudage et le mur est supérieur à 20 cm."
- Si l'utilisateur a déjà répondu (oui/non), tu n'y reviens pas.

=====================
GRUTAGE
=====================
- Si grutage non traité dans l'historique :
  tu demandes UNE FOIS :
  "Prévois-tu de lever ou gruter l'échafaudage ?"
- Si OUI : tu ajoutes les accessoires de levage et tu rappelles de bien verrouiller embases et poteaux.

=====================
ANTI-BOUCLE QUESTIONS
=====================
En te basant sur TOUT l'historique de la conversation reçu dans "messages" :
- Tu poses au maximum UNE question à la fois.
- Tu ne reposes JAMAIS une question à laquelle l'utilisateur a déjà répondu.
- Ordre logique :
  1. Si longueur inconnue → demander la longueur.
  2. Sinon si hauteur inconnue → demander la hauteur.
  3. Sinon si largeur inconnue → confirmer 1,00 m ou 0,70 m.
  4. Sinon si protection côté mur inconnue → poser la question.
  5. Sinon si grutage inconnu → poser la question.
  6. Sinon → tu calcules et tu génères directement la liste de matériel.

=====================
LISTE FINALE
=====================
Quand toutes les infos nécessaires sont connues, tu produis un tableau Markdown avec :
- Référence
- Désignation
- Qté
- Poids unitaire (kg)
- Poids total (kg)
Puis une ligne : "TOTAL GÉNÉRAL : XXX kg".

Tu termines par :
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


