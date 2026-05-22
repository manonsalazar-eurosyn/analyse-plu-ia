import express from "express";
import cors from "cors";
import { Mistral } from "@mistralai/mistralai";

const app = express();

app.use(cors());
app.use(express.json());

const client = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY
});

app.get("/", (req, res) => {
  res.send("Serveur Mistral opérationnel ✅");
});

function emptyAnalyse() {
  return {
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
  };
}

function extractJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = String(text).match(/\{[\s\S]*\}/);
    if (!match) return null;

    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function isValidResponse(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (!obj.analyse || typeof obj.analyse !== "object") return false;
  if (typeof obj.relance !== "string") return false;

  const expectedThemes = [
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

  return expectedThemes.every(
    theme => typeof obj.analyse[theme] === "string"
  );
}

async function callMistral(messages, retries = 2) {
  try {
    return await client.chat.complete({
      model: "open-mistral-nemo",
      messages,
      temperature: 0
    });
  } catch (err) {
    const msg = String(err?.message || "");

    if (retries > 0 && msg.includes("429")) {
      await new Promise(resolve => setTimeout(resolve, 1200));
      return callMistral(messages, retries - 1);
    }

    throw err;
  }
}

app.post("/analyseIA", async (req, res) => {
  const texte = (req.body.texte || "").trim();

  try {
    if (!process.env.MISTRAL_API_KEY) {
      return res.json({
        analyse: emptyAnalyse(),
        relance: "Réponse suffisamment détaillée ✅"
      });
    }

    const prompt = `
Tu analyses une réponse ouverte à propos d'une pâtée pour chat.

QUESTION :
Qu'avez-vous aimé dans cette pâtée pour chat ?

RÉPONSE À ANALYSER :
"${texte}"

OBJECTIF :
Tu dois identifier les thèmes mentionnés, dire s'ils sont détaillés ou non, puis faire une relance uniquement si nécessaire.

RÈGLE DE LANGUE :
- Détecte la langue de la réponse.
- Si une relance est nécessaire, elle doit être dans la même langue que la réponse.
- Si la réponse est en français, relance en français.
- Si la réponse est en anglais, relance en anglais.
- Si la réponse est en espagnol, relance en espagnol.

THÈMES POSSIBLES :
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

STATUTS POSSIBLES :
- "Oui - Détaillé"
- "Oui - Pas détaillé"
- "Non"

RÈGLE PRINCIPALE :
Un thème est "Oui - Détaillé" dès qu'il est accompagné d'un adjectif, d'une précision ou d'une caractéristique pertinente.

La longueur de la réponse ne compte pas.
Une réponse courte peut être suffisante.

Exemples :
- "texture crémeuse" = Texture détaillée
- "texture onctueuse" = Texture détaillée
- "texture pas trop humide" = Texture détaillée
- "goût pas trop intense" = Goût détaillé
- "goût naturel" = Goût détaillé
- "odeur légère" = Odeur/Arome détaillé
- "morceaux tendres" = Morceaux détaillé
- "pack pratique" = Packaging détaillé
- "mon chat était en meilleure santé" = Santé détaillé
- "mon chat a tout mangé" = Santé détaillé

À l'inverse, un thème est "Oui - Pas détaillé" s'il est seulement cité sans adjectif, sans précision ou sans caractéristique.

Exemples :
- "j'aime le goût" = Goût pas détaillé
- "j'aime la texture" = Texture pas détaillée
- "j'aime l'odeur" = Odeur/Arome pas détaillé
- "j'aime les morceaux" = Morceaux pas détaillé
- "mon chat a aimé" = Santé pas détaillé
- "bonne qualité" = Qualité pas détaillée
- "bon produit" = Général pas détaillé

RÈGLE DE RELANCE :
- Si aucun thème n'est "Oui - Pas détaillé", la relance doit être exactement :
"Réponse suffisamment détaillée ✅"

- Si un ou plusieurs thèmes sont "Oui - Pas détaillé", fais UNE SEULE relance.
- Cette relance doit demander de préciser TOUS les thèmes pas détaillés.
- Ne relance jamais sur un thème déjà détaillé.

EXEMPLES DE COMPORTEMENT :

Réponse :
"J'ai aimé le goût et la texture onctueuse et crémeuse."

Analyse :
- Goût = "Oui - Pas détaillé"
- Texture = "Oui - Détaillé"

Relance :
"Pouvez-vous préciser ce que vous avez aimé dans le goût de cette pâtée pour chat ?"

Réponse :
"J'ai aimé le goût pas trop intense, et aussi la texture et mon chat était en meilleure santé."

Analyse :
- Goût = "Oui - Détaillé"
- Texture = "Oui - Pas détaillé"
- Santé = "Oui - Détaillé"

Relance :
"Pouvez-vous préciser ce que vous avez aimé dans la texture de cette pâtée pour chat ?"

Réponse :
"I liked the creamy but not too wet texture, as well as the smell and the taste."

Analyse :
- Texture = "Oui - Détaillé"
- Odeur/Arome = "Oui - Pas détaillé"
- Goût = "Oui - Pas détaillé"

Relance :
"Could you specify what you liked about the smell and taste of this cat food?"

Réponse :
"Me gustó la textura cremosa pero no demasiado húmeda, así como el olor y el sabor."

Analyse :
- Texture = "Oui - Détaillé"
- Odeur/Arome = "Oui - Pas détaillé"
- Goût = "Oui - Pas détaillé"

Relance :
"¿Puede precisar qué le gustó del olor y del sabor de esta comida para gatos?"

RÈGLE HORS SUJET :
Si la réponse ne parle pas du produit, de la pâtée pour chat, du chat ou d'une caractéristique du produit :
- tous les thèmes = "Non"
- relance dans la même langue
- demander de se concentrer sur la pâtée pour chat et de préciser ce qui a plu dans le produit.

RÈGLE PAS DE RELANCE :
Si le répondant dit qu'il n'a rien aimé ou ne sait pas :
- rien
- RAS
- je ne sais pas
- rien ne m'a plu
- aucun
- nothing
- no
- nada
- no sé

Alors :
relance = "Réponse suffisamment détaillée ✅"

FORMAT JSON STRICT :
{
  "analyse": {
    "Packaging": "",
    "Apparence": "",
    "Odeur/Arome": "",
    "Goût": "",
    "Morceaux": "",
    "Texture": "",
    "Arrière-goût": "",
    "Qualité": "",
    "Santé": "",
    "Général": ""
  },
  "relance": ""
}
`;

    const response = await callMistral([
      {
        role: "system",
        content:
          "Réponds uniquement avec un JSON valide. Aucun texte hors JSON. La relance doit être dans la même langue que la réponse analysée."
      },
      {
        role: "user",
        content: prompt
      }
    ]);

    let output = response.choices?.[0]?.message?.content || "";

    if (Array.isArray(output)) {
      output = output.map(x => x.text || "").join("").trim();
    } else {
      output = String(output).trim();
    }

    const jsonOutput = extractJson(output);

    if (!jsonOutput || !isValidResponse(jsonOutput)) {
      return res.json({
        analyse: emptyAnalyse(),
        relance: "Réponse suffisamment détaillée ✅"
      });
    }

    return res.json(jsonOutput);

  } catch (err) {
    console.error("Erreur Mistral :", err);

    return res.json({
      analyse: emptyAnalyse(),
      relance: "Réponse suffisamment détaillée ✅"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Serveur prêt sur le port " + PORT);
});