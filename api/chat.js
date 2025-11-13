import OpenAI from "openai";
import { StreamingTextResponse, OpenAIStream } from "ai";

// ⚠️ Mets ici le nom EXACT de ton vector store OpenAI
const VECTOR_STORE_ID = "altrad-metrix-knowledge";

export const runtime = "edge";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Extraction d’état : on analyse tout l'historique de la conversation
 * pour récupérer longueur, hauteur, largeur, protection mur, grutage.
 */
function extractState(messages) {
  const state = {
    longueur: null,
    hauteur: null,
    largeur: null,
    protectionMur: null,
    grutage: null,
  };

  for (const m of messages) {
    const txt = m.content.toLowerCase();

    // LONGUEUR
    const lg = txt.match(/(\d+[.,]?\d*)\s*m(?:ètre)?s?\s*(?:de long|de façade|longueur)/);
    if (lg) state.longueur = parseFloat(lg[1].replace(",", "."));

    // HAUTEUR
    const ht = txt.match(/(\d+[.,]?\d*)\s*m(?:ètre)?s?\s*(?:de haut|hauteur)/);
    if (ht) state.hauteur = parseFloat(ht[1].replace(",", "."));

    // LARGEUR explicitée
    if (txt.includes("0,70") || txt.includes("0.70") || txt.includes("70cm")) state.largeur = 0.7;
    if (txt.includes("1m") || txt.includes("1 m") || txt.includes("1.00")) state.largeur = 1;

    // PROTECTION CÔTÉ MUR
    if (txt.includes("protection") && txt.includes("mur")) {
      if (txt.includes("oui")) state.protectionMur = true;
      if (txt.includes("non")) state.protectionMur = false;
    }

    // GRUTAGE
    if (txt.includes("grut")) {
      if (txt.includes("oui")) state.grutage = true;
      if (txt.includes("non")) state.grutage = false;
    }
  }

  return state;
}


/**
 * Génère le message système enrichi (instructions + état mémoire).
 */
function buildSystemPrompt(state) {
  return `
Tu es ALTRAD Assistant METRIX.
Tu dois utiliser les documents du vector store "${VECTOR_STORE_ID}" pour répondre.
Ton rôle : guider le collaborateur jusqu'à une liste complète de matériel METRIX Peduzzi.

ÉTAT ACTUEL :
- Longueur : ${state.longueur ?? "inconnue"}
- Hauteur : ${state.hauteur ?? "inconnue"}
- Largeur : ${state.largeur ?? "inconnue"}
- Protection côté mur : ${state.protectionMur ?? "inconnue"}
- Grutage : ${state.grutage ?? "inconnue"}

RÈGLES DE DIALOGUE :
- Ne JAMAIS reposer une question déjà répondue.
- Si l’utilisateur parle de m² : demander longueur + hauteur, sans proposer de valeurs.
- Toujours poser les questions restantes dans cet ordre :
  1) longueur
  2) hauteur
  3) largeur (si pas déjà donnée – par défaut 1 m)
  4) protection côté mur (rappeler que >20 cm = obligatoire)
  5) grutage
- Quand tout est connu : produire immédiatement la liste de matériel (format tableau HTML).

RAPPEL :
Tu t’appuies sur les documents du vector store pour toutes les règles (notice fabricant + catalogue Peduzzi + instructions).
Ne jamais inventer une référence.
Réponds toujours comme un collègue technique expérimenté.
`;
}


/**
 * ENDPOINT API /api/chat
 */
export async function POST(req) {
  try {
    const body = await req.json();
    const userMessages = body.messages || [];

    // 🔍 On reconstruit l'état depuis l'historique
    const state = extractState(userMessages);

    // 🔧 Création du message système enrichi
    const systemMessage = {
      role: "system",
      content: buildSystemPrompt(state),
    };

    // Construction du flux complet
    const finalMessages = [systemMessage, ...userMessages];

    // 🔥 Appel OpenAI avec récupération automatique dans ton vector store
    const response = await client.chat.completions.create({
      model: "gpt-4o-mini", // ou "gpt-4.1" si tu veux encore plus solide
      messages: finalMessages,
      stream: true,
      retrieval: {
        vector_store_ids: [VECTOR_STORE_ID],
      },
    });

    // Flux streaming vers le front
    const stream = OpenAIStream(response);
    return new StreamingTextResponse(stream);

  } catch (err) {
    console.error("❌ ERREUR API CHAT :", err);
    return new Response("Erreur interne", { status: 500 });
  }
}
