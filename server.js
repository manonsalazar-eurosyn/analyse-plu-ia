```js
import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import axios from "axios";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const PORT = process.env.PORT || 3000;
const MISTRAL_API_KEY = process.env.MISTRAL_API_KEY;

if (!MISTRAL_API_KEY) {
  console.error("MISTRAL_API_KEY manquante dans les variables d'environnement.");
  process.exit(1);
}

function cleanText(value) {
  return String(value || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildPrompt(texte) {
  return `
Tu es un expert en analyse de verbatims consommateurs pour des études sur l'alimentation animale.

Tu dois analyser une réponse concernant une pâtée pour chat.

Réponse du participant :
"${texte}"

Ta mission :
1. Identifier les thèmes mentionnés.
2. Classer chaque thème en :
- "Non"
- "Oui - Pas détaillé"
- "Oui - Détaillé"
3. Générer une seule relance naturelle uniquement sur les thèmes mentionnés mais insuffisamment détaillés.

Thèmes obligatoires à analyser :
- Packaging
- Apparence
- Odeur/Arome
- Goût
- Morceaux
- Texture
- Arrière-goût
- Qualité
- Santé
- Général

Définitions :

"Non" :
Le thème n'est pas mentionné.

"Oui - Pas détaillé" :
Le thème est mentionné, mais sans caractéristique précise, sans explication concrète, sans adjectif descriptif suffisant.

Attention :
Une simple appréciation ne constitue jamais un détail.

Les verbes ou formulations suivantes ne suffisent jamais pour classer un thème en "Oui - Détaillé" :
- j'aime
- j'ai aimé
- j'apprécie
- j'ai apprécié
- j'adore
- c'est bien
- c'est bon
- c'est agréable
- je suis satisfait
- ça me plaît

Exemples à classer impérativement en "Oui - Pas détaillé" :
- "J'ai aimé la texture."
- "J'ai apprécié l'apparence."
- "J'ai aimé les morceaux."
- "J'ai aimé la quantité de morceaux."
- "L'odeur était bien."
- "Le goût était bon."
- "Bonne qualité."
- "C'était sain."

"Oui - Détaillé" :
Le participant apporte une précision descriptive, sensorielle ou explicative claire.

Exemples :
- "La texture était crémeuse."
- "La texture était fondante."
- "La texture était onctueuse."
- "L'apparence était appétissante."
- "L'apparence semblait naturelle."
- "Les morceaux étaient nombreux."
- "Les morceaux étaient bien visibles."
- "Les morceaux avaient une taille adaptée."
- "L'odeur était fraîche."
- "L'odeur était agréable et naturelle."
- "Le goût semblait apprécié par mon chat."
- "La qualité semblait premium."

Règle critique :
Si le participant dit seulement qu'il a aimé un thème, sans dire pourquoi ni donner de caractéristique précise, ce thème doit être classé "Oui - Pas détaillé".

Exemple très important :

Réponse :
"J'ai aimé la texture, l'apparence et la quantité de morceaux."

Analyse attendue :
- Texture : "Oui - Pas détaillé"
- Apparence : "Oui - Pas détaillé"
- Morceaux : "Oui - Pas détaillé"

Relance attendue :
"Pourriez-vous préciser ce que vous avez particulièrement apprécié dans la texture, l'apparence et la quantité de morceaux de cette pâtée pour chat ?"

Construction de la relance :
- Relancer uniquement sur les thèmes classés "Oui - Pas détaillé".
- Ne jamais relancer sur les thèmes "Non".
- Ne jamais relancer sur les thèmes "Oui - Détaillé".
- Si plusieurs thèmes sont insuffisamment détaillés, les regrouper dans une seule question naturelle.
- La relance doit être dans la même langue que la réponse du participant.
- Si la réponse est en français, répondre en français.
- Si la réponse est en anglais, répondre en anglais.
- Si la réponse est dans une autre langue, répondre dans cette même langue.

Si aucun thème mentionné ne nécessite de relance, retourner exactement :
"Réponse suffisamment détaillée ✅"

Format de sortie obligatoire :
Tu dois retourner uniquement un JSON valide, sans texte avant ni après.

Structure exacte :

{
  "analyse": {
    "Packaging": "Non",
    "Apparence": "Non",
    "Odeur/Arome": "Non",
    "Goût": "Non",
    "Morceaux": "Non",
    "Texture": "Non",
    "Arrière-goût": "Non",
    "Qualité": "Non",
    "Santé": "Non",
    "Général": "Non"
  },
  "relance": ""
}
`;
}

function extractJson(rawText) {
  const cleaned = cleanText(rawText);

  try {
    return JSON.parse(cleaned);
  } catch (_) {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Aucun JSON détecté dans la réponse IA.");
    return JSON.parse(match[0]);
  }
}

function normalizeAnalyse(analyse = {}) {
  const themes = [
    "Packaging",
    "Apparence",
    "Odeur/Arome",
    "Goût",
    "Morceaux",
    "Texture",
    "Arrière-goût",
    "Qualité",
    "Santé",
    "Général"
  ];

  const allowed = ["Non", "Oui - Pas détaillé", "Oui - Détaillé"];

  const normalized = {};

  for (const theme of themes) {
    const value = cleanText(analyse[theme]);
    normalized[theme] = allowed.includes(value) ? value : "Non";
  }

  return normalized;
}

function fallbackRelanceFromAnalyse(analyse, participantText) {
  const themesToAsk = Object.entries(analyse)
    .filter(([, value]) => value === "Oui - Pas détaillé")
    .map(([theme]) => theme);

  if (themesToAsk.length === 0) {
    return "Réponse suffisamment détaillée ✅";
  }

  const lower = cleanText(participantText).toLowerCase();

  const isFrench =
    lower.includes("j'ai") ||
    lower.includes("j’aime") ||
    lower.includes("j'aime") ||
    lower.includes("aimé") ||
    lower.includes("apprécié") ||
    lower.includes("texture") ||
    lower.includes("apparence") ||
    lower.includes("morceaux");

  const list =
    themesToAsk.length === 1
      ? themesToAsk[0].toLowerCase()
      : themesToAsk
          .slice(0, -1)
          .map(t => t.toLowerCase())
          .join(", ") +
        " et " +
        themesToAsk[themesToAsk.length - 1].toLowerCase();

  if (isFrench) {
    return `Pourriez-vous préciser ce que vous avez particulièrement apprécié dans ${list} de cette pâtée pour chat ?`;
  }

  return `Could you please specify what you particularly liked about the ${list} of this cat food?`;
}

app.get("/", (req, res) => {
  res.json({
    status: "ok",
    service: "analyseIA",
    message: "Server is running"
  });
});

app.post("/analyseIA", async (req, res) => {
  try {
    const texte = cleanText(req.body?.texte);

    if (!texte) {
      return res.status(400).json({
        error: "Texte manquant"
      });
    }

    const prompt = buildPrompt(texte);

    const mistralResponse = await axios.post(
      "https://api.mistral.ai/v1/chat/completions",
      {
        model: process.env.MISTRAL_MODEL || "mistral-small-latest",
        temperature: 0,
        response_format: {
          type: "json_object"
        },
        messages: [
          {
            role: "system",
            content:
              "Tu es un moteur strict d'analyse de verbatims. Tu retournes uniquement du JSON valide."
          },
          {
            role: "user",
            content: prompt
          }
        ]
      },
      {
        headers: {
          Authorization: `Bearer ${MISTRAL_API_KEY}`,
          "Content-Type": "application/json"
        },
        timeout: 30000
      }
    );

    const rawContent =
      mistralResponse.data?.choices?.[0]?.message?.content || "";

    const parsed = extractJson(rawContent);

    const analyse = normalizeAnalyse(parsed.analyse);

    let relance = cleanText(parsed.relance);

    if (!relance) {
      relance = fallbackRelanceFromAnalyse(analyse, texte);
    }

    const hasUndetailedTheme = Object.values(analyse).includes(
      "Oui - Pas détaillé"
    );

    if (!hasUndetailedTheme) {
      relance = "Réponse suffisamment détaillée ✅";
    }

    return res.json({
      analyse,
      relance
    });
  } catch (error) {
    console.error("Erreur analyseIA :", error?.response?.data || error.message);

    return res.status(500).json({
      error: "Erreur serveur analyseIA",
      details: error.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`Serveur analyseIA lancé sur le port ${PORT}`);
});
```
