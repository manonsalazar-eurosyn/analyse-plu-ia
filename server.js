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
Tu analyses une réponse ouverte à la question :
"Qu’avez-vous aimé dans cette pâtée pour chat ?"

Réponse consommateur :
"${texte}"

TÂCHE :
1. Détecte la langue de la réponse.
2. Réponds avec une relance dans la même langue.
3. Identifie uniquement les thèmes mentionnés parmi :
Packaging, Apparence, Odeur/Arome, Goût, Morceaux, Texture, Arrière-goût, Qualité, Santé, Général.
4. Pour chaque thème mentionné, décide :
- "Oui - Détaillé" si le thème est caractérisé par un mot précis.
- "Oui - Pas détaillé" si le thème est seulement cité sans précision.
- "Non" si le thème n’est pas mentionné.
5. Si au moins un thème est "Oui - Pas détaillé", fais UNE seule relance qui demande de détailler TOUS ces thèmes.
6. Si tous les thèmes mentionnés sont détaillés, mets exactement :
"Réponse suffisamment détaillée ✅"

RÈGLE ESSENTIELLE :
La longueur de la réponse ne compte pas.
Seul le niveau de détail des thèmes mentionnés compte.

EXEMPLES :
"J’aime le goût pas trop intense" :
Goût = "Oui - Détaillé"

"J’aime le goût" :
Goût = "Oui - Pas détaillé"

"J’aime la texture crémeuse" :
Texture = "Oui - Détaillé"

"J’aime la texture" :
Texture = "Oui - Pas détaillé"

"Mon chat était en meilleure santé" :
Santé = "Oui - Détaillé"

"Mon chat a aimé" :
Santé = "Oui - Pas détaillé"

"J'ai aimé le goût pas trop intense, et aussi la texture et mon chat était en meilleure santé." :
Goût = "Oui - Détaillé"
Texture = "Oui - Pas détaillé"
Santé = "Oui - Détaillé"
Relance = "Pouvez-vous préciser ce que vous avez aimé dans la texture de cette pâtée pour chat ?"

RÈGLE HORS SUJET :
Si la réponse ne parle pas de la pâtée, du produit ou du chat :
- tous les thèmes = "Non"
- demande dans la même langue de se concentrer sur la pâtée pour chat et de préciser ce qui a plu dans le produit.

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
        content: "Réponds UNIQUEMENT avec un JSON valide. Aucun texte hors JSON."
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