// api/chat.js
const OpenAI = require("openai");

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// --------- Utilitaires simples ---------

// extrait longueur + hauteur depuis un texte utilisateur
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

// dernière paire longueur / hauteur trouvée dans l’historique
function findLastDims(messages) {
  let last = null;
  for (const m of messages) {
    if (!m || m.role !== "user" || !m.content) continue;
    const dims = extractLengthHeight(m.content);
    if (dims) last = dims;
  }
  return last;
}

// détecte une réponse de l’utilisateur concernant la protection façade côté mur
function findProtectionAnswer(messages) {
  let last = null;
  for (const m of messages) {
    if (!m || m.role !== "user" || !m.content) continue;
    const t = m.content.toLowerCase();

    if (
      t.includes("protection") ||
      t.includes("façade") ||
      t.includes("facade") ||
      t.includes("côté mur") ||
      t.includes("cote mur")
    ) {
      last = m.content.trim();
    } else if ((t === "oui" || t === "non") && last === null) {
      // "oui"/"non" juste après la question
      last = m.content.trim();
    }
  }
  return last;
}

// l’utilisateur parle de m²
function mentionsSurface(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return /\b(m²|m2|metre carré|mètre carré|mètres carrés|surface)\b/.test(lower);
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

    // 1) On regarde tout l’historique pour récupérer longueur, hauteur, protection
    const dims = findLastDims(userMessages);
    const protAnswer = findProtectionAnswer(userMessages);

    // 2) Gros message système métier (rappel des règles)
    const baseSystem = {
      role: "system",
      content: `
Tu es **ALTRAD Assistant METRIX**, collègue chantier expérimenté.
Tu aides à préparer une **liste de matériel ALTRAD METRIX** prête à être commandée.
Tu réponds toujours en français, ton concret, simple et bienveillant.

IMPORTANT :
- Tu ne dois jamais dire : "donne-moi la longueur ET la hauteur" si ces informations sont déjà présentes dans l'historique.
- Tu ne dois jamais écrire "X m" ou "Y m" : utilise toujours les vraies valeurs en mètres.
- Si tu connais déjà la longueur et la hauteur depuis l'historique, tu les considères comme définitives.

Rappels techniques (résumé) :
- Échafaudage droit de façade uniquement.
- Largeur par défaut : 1,00 m (sauf demande explicite pour 0,70 m).
- Hauteur de niveau : 2,00 m.
- Travées = ceil(longueur / 2,5).
- Niveaux = ceil(hauteur / 2).
- 1 plancher trappe par niveau.
- Garde-corps, plinthes et stabilisation selon les règles ALTRAD METRIX.
- Protection façade côté mur : obligatoire si l'espace > 20 cm.

Affichage final :
- Tu produis un tableau **Markdown** :
  Référence | Désignation | Qté | Poids unitaire (kg) | Poids total (kg)
- Puis "TOTAL GÉNÉRAL : XXX kg".
- Tu termines par :
  "Voici ta liste complète. Tu peux maintenant saisir ta commande sur ta tablette ou dans le Back Office Peduzzi."
      `,
    };

    // 3) CAS 1 : l’utilisateur vient avec une surface en m²
    if (lastUserMsg && mentionsSurface(lastUserMsg.content)) {
      const messages = [
        baseSystem,
        {
          role: "user",
          content: `
L'utilisateur parle de surface : "${lastUserMsg.content}".

Ta réponse doit être uniquement :
- Une phrase courte où tu lui expliques que pour calculer l'échafaudage,
  il doit te donner lui-même la longueur ET la hauteur souhaitées.
- Tu ne proposes pas de valeurs par défaut, tu ne les déduis pas.
- Tu ne fais aucun calcul, pas de liste de matériel.
          `.trim(),
        },
      ];

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
      });

      res.status(200).send(completion.choices[0].message.content);
      return;
    }

    // 4) CAS 2 : on a déjà longueur + hauteur + réponse façade côté mur
    if (dims && protAnswer) {
      const L = dims.L;
      const H = dims.H;

      const synthUser = {
        role: "user",
        content: `
Configuration complète à traiter :

- Type : échafaudage droit de façade.
- Longueur : ${L} m.
- Hauteur : ${H} m.
- Largeur : 1,00 m (standard).
- Protection façade côté mur : ${protAnswer}.
- L'utilisateur a déjà donné ces informations plus haut dans la conversation.
- Tu dois maintenant arrêter de poser des questions répétitives
  et passer au calcul de la liste de matériel.

Consigne :
- Tu peux poser UNE SEULE question complémentaire courte si vraiment un point de sécurité est indispensable (par ex. grutage).
- Mais dans la même réponse, tu DOIS quand même proposer une liste de matériel complète basée sur les informations présentes.
- Tu ne redis pas "peux-tu me donner la longueur ou la hauteur".
- Tu calcules toutes les quantités et tu affiches le tableau Markdown demandé.
        `.trim(),
      };

      const messages = [baseSystem, synthUser];

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        messages,
      });

      res.status(200).send(completion.choices[0].message.content);
      return;
    }

    // 5) CAS 3 : flux normal (début de discussion ou infos manquantes)
    const messages = [baseSystem, ...userMessages];

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

