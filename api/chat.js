// api/chat.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Détection longueur / hauteur dans la phrase utilisateur
function extractLengthHeight(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // il faut qu'il parle de longueur + hauteur
  const hasLong = lower.includes("long") || lower.includes("longueur");
  const hasHaut = lower.includes("haut") || lower.includes("hauteur");
  if (!hasLong || !hasHaut) return null;

  // on récupère tous les "nombre m"
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

    // on regarde le DERNIER message utilisateur
    const lastUserMsg = [...userMessages].reverse().find(
      (m) => m && m.role === "user"
    );

    const extraSystemMessages = [];

    if (lastUserMsg && lastUserMsg.content) {
      const dims = extractLengthHeight(lastUserMsg.content);
      if (dims) {
        // 👉 ici on force le modèle à considérer que L et H sont déjà connus
        extraSystemMessages.push({
          role: "system",
          content: `Le dernier message utilisateur donne déjà les dimensions : longueur = ${dims.L} m et hauteur = ${dims.H} m. Tu dois les utiliser telles quelles, ne PAS les redemander, et ne pas prétendre que la longueur ou la hauteur sont inconnues.`,
        });
      } else if (mentionsSurface(lastUserMsg.content)) {
        // Cas "40 m²" : tu DOIS demander L et H
        extraSystemMessages.push({
          role: "system",
          content:
            "Le dernier message utilisateur exprime une surface en m² sans donner de longueur ni de hauteur. Tu dois lui demander de choisir lui-même la longueur ET la hauteur, et tu n'as pas le droit de les déduire automatiquement.",
        });
      }
    }

    // Message système principal (règles métier et flow)
    const mainSystemMessage = {
      role: "system",
      content: `
Tu es **ALTRAD Assistant METRIX**, collègue chantier expérimenté.
Tu aides les collaborateurs à préparer une **liste de matériel ALTRAD METRIX** complète, cohérente et sécurisée, prête à être commandée (catalogue Peduzzi).

Tu vois toujours l'historique complet de la conversation.
Tu dois utiliser cet historique pour **ne JAMAIS reposer une question déjà posée ET répondue**.

=====================
🎯 OBJECTIF
=====================
- Configurer un **échafaudage droit de façade** (pas d'angle, pas de mobile).
- Obtenir : longueur, hauteur, largeur, protection côté mur (oui/non), grutage (oui/non).
- Quand tu as ces infos, tu passes directement au calcul des quantités et tu affiches la liste de matériel.

=====================
📏 LONGUEUR / HAUTEUR / M²
=====================
- Si la longueur ET la hauteur sont déjà exprimées clairement dans les messages précédents (par ex. "échafaudage de 5 m de long par 6 m de haut"), tu les considères comme **connues** et tu ne les redemandes jamais.
- La phrase "Pour calculer correctement, donne-moi la longueur ET la hauteur..." ne doit être utilisée **QUE** si l'utilisateur parle de surface (m², m2, mètres carrés, surface) sans donner de longueur et de hauteur.
- Tu ne choisis jamais toi-même longueur et hauteur : c'est toujours l'utilisateur qui décide.

=====================
⚙️ RÈGLES PAR DÉFAUT SIMPLIFIÉES
=====================
- Type : échafaudage **droit de façade**.
- Largeur par défaut : **1,00 m**. Tu pars toujours là-dessus, sauf si l'utilisateur précise 0,70 m.
- Hauteur de niveau : 2,00 m.
- Travées = ceil(longueur / 2,5).
- Niveaux = ceil(hauteur / 2).

- Niveau de base :
  - Socles à vérin 0,61 m.
  - Embases de départ.
  - Poteaux 1,00 m.
  - 3 planchers acier 2,50 x 0,30 pour supporter la première échelle.

- Niveaux supérieurs :
  - Poteaux 2,00 m.
  - Planchers acier + plancher trappe (1 par niveau).

=====================
🛡️ PROTECTION CÔTÉ MUR
=====================
- Si ce n'est pas encore précisé, tu demandes UNE FOIS :
  "Souhaites-tu protéger la façade côté mur ? ⚠️ Obligatoire si l'espace entre l'échafaudage et le mur est supérieur à 20 cm."
- Si OUI : tu ajoutes les garde-corps + plinthes côté mur.

=====================
🏗️ GRUTAGE
=====================
- Si ce n'est pas encore précisé, tu demandes UNE FOIS :
  "Prévois-tu de lever ou gruter l'échafaudage ?"
- Si OUI : tu ajoutes les accessoires de levage (crochets, boulons, etc.) et tu rappelles les consignes de verrouillage.

=====================
🟦 LOGIQUE DE DIALOGUE (ANTI-BOUCLE)
=====================
Tu poses au maximum **UNE question à la fois**, et seulement si l'info manque encore.

Ordre :
1. Si longueur inconnue → demander la longueur.
2. Sinon si hauteur inconnue → demander la hauteur.
3. Sinon si largeur inconnue → confirmer 1,00 m ou 0,70 m.
4. Sinon si protection côté mur inconnue → poser la question avec l'avertissement des 20 cm.
5. Sinon si grutage inconnu → poser la question sur le grutage.
6. Sinon (toutes les infos sont connues) → tu ne poses plus aucune question, tu calcules et tu génères directement la liste de matériel.

=====================
📋 LISTE FINALE
=====================
Quand tu as toutes les infos, tu produis une liste de matériel structurée (tableau Markdown) avec :
- Référence
- Désignation
- Quantité
- Poids unitaire (kg)
- Poids total (kg)
Puis une ligne "TOTAL GÉNÉRAL : XXX kg".

Tu termines par :
"Voici ta liste complète. Tu peux maintenant saisir ta commande sur ta tablette ou dans le Back Office Peduzzi."

Réponds toujours en français, ton concret de chef de chantier.
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

