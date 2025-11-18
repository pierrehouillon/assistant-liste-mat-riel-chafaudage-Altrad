// api/chat.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/* ---------- UTILITAIRES ---------- */

// détecte une mention de surface (m²)
function mentionsSurface(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /\b(m²|m2|metre carré|mètre carré|mètres carrés|surface)\b/.test(lower);
}

// extrait longueur + hauteur depuis un texte utilisateur
// ex : "échafaudage de 5 m de long par 6 m de haut"
function extractDimsFromText(text) {
  if (!text) return null;
  const lower = text.toLowerCase();

  // on cherche 2 nombres + "m"
  const regex = /(\d+(?:[.,]\d+)?)\s*m\b/g;
  const matches = [...lower.matchAll(regex)];
  if (matches.length < 2) return null;

  const L = parseFloat(matches[0][1].replace(",", "."));
  const H = parseFloat(matches[1][1].replace(",", "."));
  if (isNaN(L) || isNaN(H)) return null;

  return { L, H };
}

// récupère les dernières dimensions connues dans tout l'historique
function findLastDims(messages) {
  let last = null;
  for (const m of messages) {
    if (!m || m.role !== "user" || !m.content) continue;
    const dims = extractDimsFromText(m.content);
    if (dims) last = dims;
  }
  return last;
}

// détecte si une question "protection façade côté mur" a déjà été posée
function isProtectionQuestion(msg) {
  if (!msg || msg.role !== "assistant" || !msg.content) return false;
  return /protéger la façade côté mur/i.test(msg.content);
}

// détecte si une question "grutage" a déjà été posée
function isGrutageQuestion(msg) {
  if (!msg || msg.role !== "assistant" || !msg.content) return false;
  return /gruter ton échafaudage/i.test(msg.content);
}

// dernière réponse OUI / NON après une certaine question
function getLastYesNoAfter(messages, questionPredicate) {
  let asked = false;
  let answer = null;

  for (const m of messages) {
    if (questionPredicate(m)) {
      asked = true;
      continue;
    }
    if (asked && m.role === "user" && m.content) {
      const t = m.content.toLowerCase();
      if (/\boui\b/.test(t)) answer = "OUI";
      else if (/\bnon\b/.test(t)) answer = "NON";
    }
  }
  return answer;
}

/* ---------- HANDLER PRINCIPAL ---------- */

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  try {
    const body = req.body || {};
    const allMessages = body.messages || [];

    if (!Array.isArray(allMessages) || allMessages.length === 0) {
      res.status(400).json({ error: "messages manquants" });
      return;
    }

    // on ne garde que les messages user/assistant (on ignore le system du front)
    const convo = allMessages.filter(
      (m) => m && (m.role === "user" || m.role === "assistant")
    );

    const lastUserMsg = [...convo].reverse().find((m) => m.role === "user");

    // 1) dimensions (longueur / hauteur)
    const dims = findLastDims(convo);
    const protectionAsked = convo.some(isProtectionQuestion);
    const grutageAsked = convo.some(isGrutageQuestion);

    const protectionAnswer = getLastYesNoAfter(convo, isProtectionQuestion);
    const grutageAnswer = getLastYesNoAfter(convo, isGrutageQuestion);

    // --- ETAPE 1 : l’utilisateur parle en m² sans dimensions ---
    if (!dims && lastUserMsg && mentionsSurface(lastUserMsg.content)) {
      res.status(200).send(
        "Pour calculer correctement l’échafaudage à partir d’une surface en m², " +
          "donne-moi la **longueur** en mètres ET la **hauteur** en mètres que tu veux. " +
          "Je ne les déduis jamais automatiquement."
      );
      return;
    }

    // --- ETAPE 2 : si aucune dimension connue → on les demande ---
    if (!dims) {
      res.status(200).send(
        "Pour commencer, donne-moi la longueur **et** la hauteur de l’échafaudage droit de façade que tu prépares " +
          "(ex. : 5 m de long par 6 m de haut)."
      );
      return;
    }

    const { L, H } = dims;

    // --- ETAPE 3 : question sécurité façade côté mur ---
    if (!protectionAsked) {
      res.status(200).send(
        `OK, on part sur un échafaudage droit de façade de ${L} m de long et ${H} m de haut.\n\n` +
          "Souhaites-tu protéger la façade côté mur ?\n" +
          "⚠️ Obligatoire si l’espace entre l’échafaudage et le mur est supérieur à 20 cm."
      );
      return;
    }

    if (protectionAsked && !protectionAnswer) {
      res.status(200).send(
        "Merci de me confirmer la protection façade côté mur par **OUI** ou **NON**, " +
          "pour que je puisse continuer la configuration."
      );
      return;
    }

    // --- ETAPE 4 : question grutage ---
    if (!grutageAsked) {
      res.status(200).send(
        "Parfait, j’ai noté la réponse pour la protection côté mur.\n\n" +
          "Dernière question sécurité : **souhaites-tu gruter ton échafaudage ?**"
      );
      return;
    }

    if (grutageAsked && !grutageAnswer) {
      res.status(200).send(
        "Peux-tu me confirmer si tu souhaites **gruter** ton échafaudage ? Réponds simplement par **OUI** ou **NON**."
      );
      return;
    }

    // --- ETAPE 5 : toutes les infos sont connues → génération de la liste de matériel ---
    const systemPrompt = `
Tu es ALTRAD Assistant, expert échafaudages terrain spécialisé dans la gamme ALTRAD METRIX.
Tu aides un collaborateur à préparer un échafaudage **droit de façade** complet, sécurisé et prêt à être commandé.

Tu appliques les règles suivantes (ne les réexplique pas en détail, applique-les) :

- Largeur par défaut : 1,00 m.
- Hauteur de niveau : 2,00 m.
- travées = ceil(longueur / 2.5)
- niveaux = ceil(hauteur / 2)

Structure de base (références ALTRAD METRIX) :
- Socles à vérin ALTASV5 : 3 × travées
- Embases ALTKEMB : 3 × travées
- Cales bois ALTL99P : 1 par socle + 1 par stabilisateur
- Lisses perpendiculaires 1,00 m ALTKLC2 : 3 + 3 × niveaux
- Poteaux 1,00 m ALTKPT1 : 3 × travées (départ)
- Poteaux 2,00 m ALTKPT2 : 3 × travées × niveaux

Planchers et accès :
- Plancher trappe 2,50 × 0,60 m ALTKPE5 : 1 par niveau
- Plancher acier 2,50 × 0,30 m ALTKMC5 : niveaux × [3 × (travées − 1) + 1] + 3

Garde-corps & plinthes :
- Garde-corps 2,50 m ALTKGH5 : 3 × travées (×2 si protection mur = OUI)
- Garde-corps 1,00 m avec plinthe intégrée ALTKGH2 : 2 × niveaux
- Plinthes 2,50 m ALTKPI5 : = ALTKGH5 (×2 si protection mur = OUI)

Autres éléments :
- Lisse 2,50 m protection échelle ALTKLC5 : = niveaux
- Diagonale verticale ALTKDV5 : 1
- Stabilisateurs ALT00S75 : selon la hauteur (≤ 6 m → 3 stabilisateurs)
- Cales bois sup. ALTL99P : +1 par stabilisateur

Grutage (si OUI) :
- 4 × ALTRLEV (crochet de levage)
- ALTKFSV = nombre de socles
- ALTKB12 = boulons 12 × 60 mm pour les poteaux
- Boulons 12 × 70 mm pour les embases (tu les indiques dans le texte, pas dans le tableau si tu n’as pas de référence précise).

Affichage demandé :
1. Un récapitulatif très court des paramètres retenus (longueur, hauteur, travées, niveaux, protection mur OUI/NON, grutage OUI/NON).
2. Un **tableau Markdown** avec les colonnes :
   Référence | Désignation | Qté | Poids unitaire (kg) | Poids total (kg)

3. Une ligne "TOTAL" avec le poids total estimé.
4. Si grutage = OUI, un petit rappel texte de verrouillage des boulons.
5. Tu termines toujours par :
   "Tu peux maintenant saisir ta commande sur ta tablette ou dans le back-office Peduzzi."

Tu ne poses **aucune question** : toutes les informations nécessaires ont déjà été fournies.
Ta réponse est autonome et définitive pour cette configuration.
    `.trim();

    const userPrompt = `
Configuration à traiter :

- Type : échafaudage droit de façade.
- Longueur : ${L} m.
- Hauteur : ${H} m.
- Largeur : 1,00 m.
- Protection façade côté mur : ${protectionAnswer}.
- Grutage : ${grutageAnswer}.

Applique strictement les règles données dans le message système pour calculer la liste de matériel ALTRAD METRIX et le poids total estimé.
    `.trim();

    const completion = await client.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
    });

    const answer = completion.choices[0].message.content || "";
    res.status(200).send(answer);
  } catch (err) {
    console.error("Erreur /api/chat :", err);
    res.status(500).json({ error: "Erreur interne API chat" });
  }
};
