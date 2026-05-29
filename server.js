```js
import express from "express";
import cors from "cors";
import { Mistral } from "@mistralai/mistralai";

const app = express();

app.use(cors());
app.use(express.json());

const client = new Mistral({
  apiKey: process.env.MISTRAL_API_KEY
});

const THEMES = [
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

function emptyAnalyse() {
  return Object.fromEntries(THEMES.map(theme => [theme, "Non"]));
}

function cleanText(txt) {
  return (txt || "")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalize(txt) {
  return cleanText(txt)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
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

function isNoRelanceAnswer(texte) {
  const t = normalize(texte);

  return [
    "rien",
    "ras",
    "aucun",
    "aucune",
    "je ne sais pas",
    "nothing",
    "none",
    "no",
    "nada"
  ].some(value => t === normalize(value));
}

function validateAnalyse(rawAnalyse) {
  const analyse = emptyAnalyse();

  THEMES.forEach(theme => {
    const value = rawAnalyse?.[theme];

    if (
      value === "Non" ||
      value === "Oui - Détaillé" ||
      value === "Oui - Pas détaillé"
    ) {
      analyse[theme] = value;
    }
  });

  return analyse;
}

function getThemesPasDetailles(analyse) {
  return THEMES.filter(theme => analyse[theme] === "Oui - Pas détaillé");
}

async function analyseAndRelanceWithMistral(texte) {
  const prompt = `
Tu analyses une réponse ouverte de consommateur à propos d'une pâtée pour chat.

Réponse consommateur :
"${texte}"

TA MISSION :
1. Identifier les thèmes présents dans la réponse.
2. Dire pour chaque thème s'il est :
   - "Non"
   - "Oui - Détaillé"
   - "Oui - Pas détaillé"
3. Rédiger une relance uniquement si au moins un thème est "Oui - Pas détaillé".

THÈMES À CODER :
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

DÉFINITIONS DES THÈMES :
- Packaging : emballage, format, ouverture, sachet, boîte, barquette, praticité du contenant.
- Apparence : aspect visuel, couleur, présentation, apparence du produit.
- Odeur/Arome : odeur, parfum, arôme senti par le consommateur.
- Goût : goût, saveur, appétence, plaisir gustatif.
- Morceaux : morceaux, bouts, chunks, taille ou quantité des morceaux.
- Texture : texture, consistance, crémeux, onctueux, lisse, humide, sec, ferme.
- Arrière-goût : arrière-goût, goût qui reste après consommation.
- Qualité : qualité perçue, ingrédients, naturel, premium, confiance dans le produit.
- Santé : digestion, bénéfice santé, effet sur le chat, bien-être du chat.
- Général : avis global sur le produit sans thème précis.

RÈGLE TRÈS IMPORTANTE SUR LE NIVEAU DE DÉTAIL :
La simple mention d'un thème n'est JAMAIS détaillée.

Exemples PAS DÉTAILLÉS :
- "J'aime la texture" → Texture = "Oui - Pas détaillé"
- "J'aime l'odeur" → Odeur/Arome = "Oui - Pas détaillé"
- "J'aime l'apparence" → Apparence = "Oui - Pas détaillé"
- "J'aime les morceaux" → Morceaux = "Oui - Pas détaillé"
- "J'aime la quantité de morceaux" → Morceaux = "Oui - Pas détaillé"
- "J'aime la texture, l'apparence et la quantité de morceaux" → les 3 thèmes sont "Oui - Pas détaillé"

Exemples DÉTAILLÉS :
- "J'aime la texture crémeuse" → Texture = "Oui - Détaillé"
- "J'aime la texture parce qu'elle est facile à manger" → Texture = "Oui - Détaillé"
- "J'aime l'odeur naturelle" → Odeur/Arome = "Oui - Détaillé"
- "J'aime l'apparence appétissante" → Apparence = "Oui - Détaillé"
- "J'aime les petits morceaux" → Morceaux = "Oui - Détaillé"
- "J'aime les morceaux bien répartis" → Morceaux = "Oui - Détaillé"

ATTENTION :
- "J'aime" ou "j'ai aimé" ne rend PAS un thème détaillé.
- "Bon", "bien", "agréable", "joli" seuls sont souvent trop vagues.
- Un thème est détaillé seulement si le consommateur donne une caractéristique, une raison, une précision concrète ou une description utile.
- Si plusieurs thèmes sont cités mais non détaillés, ils doivent tous être relancés.
- Ne considère jamais qu'un thème est détaillé juste parce qu'il est positif.

LANGUE :
- Détecte automatiquement la langue de la réponse consommateur.
- La relance doit être dans la même langue que la réponse, quelle qu'elle soit.
- Cela peut être français, anglais, espagnol, italien, allemand, néerlandais, portugais, arabe, chinois, japonais, etc.
- Ne traduis pas la réponse consommateur.
- Ne limite pas ton analyse à quelques langues.

RELANCE :
- Si tous les thèmes présents sont détaillés, écris exactement : "Réponse suffisamment détaillée"
- Si aucun thème clair n'est présent, demande de se concentrer sur la pâtée pour chat, dans la langue détectée.
- Sinon, rédige UNE seule question courte.
- La question doit relancer uniquement les thèmes en "Oui - Pas détaillé".
- Ne relance jamais les thèmes déjà "Oui - Détaillé".
- Ne mentionne jamais les thèmes en "Non".
- Maximum 35 mots.
- Pas de préfixe technique.

FORMAT JSON STRICT :
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

  const response = await callMistral([
    {
      role: "system",
      content: `
Tu es un expert en codage de réponses ouvertes en études consommateurs.
Tu dois répondre uniquement avec un JSON valide.
Aucun texte hors JSON.
Tu respectes strictement les catégories et les libellés demandés.
`
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

  return extractJson(output);
}

async function repairRelanceWithMistral(texte, analyse) {
  const themesPasDetailles = getThemesPasDetailles(analyse);

  if (themesPasDetailles.length === 0) {
    return "Réponse suffisamment détaillée";
  }

  const prompt = `
Réponse consommateur :
"${texte}"

Analyse validée :
${JSON.stringify(analyse, null, 2)}

Thèmes à relancer :
${themesPasDetailles.map(t => "- " + t).join("\n")}

Rédige UNE seule question courte dans la même langue que la réponse consommateur.
La question doit relancer uniquement les thèmes listés.
Maximum 35 mots.
Réponds uniquement avec la question.
`;

  const response = await callMistral([
    {
      role: "system",
      content:
        "Tu rédiges uniquement une question de relance dans la même langue que la réponse consommateur."
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

  return cleanText(output)
    .replace(/^["“”]+|["“”]+$/g, "")
    .trim();
}

app.get("/", (req, res) => {
  res.send("Serveur Mistral opérationnel ✅");
});

app.post("/analyseIA", async (req, res) => {
  const texte = cleanText(req.body.texte || "");

  try {
    if (!texte) {
      return res.json({
        analyse: emptyAnalyse(),
        relance: "Pouvez-vous vous concentrer sur la pâtée pour chat et préciser ce qui vous a plu dans ce produit ?"
      });
    }

    if (isNoRelanceAnswer(texte)) {
      return res.json({
        analyse: emptyAnalyse(),
        relance: "Réponse suffisamment détaillée"
      });
    }

    if (!process.env.MISTRAL_API_KEY) {
      return res.json({
        analyse: emptyAnalyse(),
        relance: "Erreur : clé Mistral manquante."
      });
    }

    const jsonOutput = await analyseAndRelanceWithMistral(texte);

    const analyse = validateAnalyse(jsonOutput?.analyse);
    let relance = cleanText(jsonOutput?.relance || "");

    const themesPasDetailles = getThemesPasDetailles(analyse);

    if (themesPasDetailles.length === 0) {
      relance = "Réponse suffisamment détaillée";
    }

    if (themesPasDetailles.length > 0 && !relance) {
      relance = await repairRelanceWithMistral(texte, analyse);
    }

    return res.json({
      analyse,
      relance
    });

  } catch (err) {
    console.error("Erreur analyseIA :", err);

    return res.json({
      analyse: emptyAnalyse(),
      relance: "Erreur lors de l'analyse IA."
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Serveur prêt sur le port " + PORT);
});
```
