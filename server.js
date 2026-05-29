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

function containsAny(text, words) {
  return words.some(word => text.includes(word));
}

function detectThemes(texte) {
  const t = normalize(texte);
  const themes = [];

  if (containsAny(t, [
    "packaging", "pack", "emballage", "paquet", "sachet", "boite", "barquette",
    "ouvrir", "fermer", "ouverture", "format", "envase", "paquete"
  ])) themes.push("Packaging");

  if (containsAny(t, [
    "apparence", "aspect", "visuel", "couleur", "joli", "belle couleur",
    "appearance", "look", "color", "colour", "aspecto"
  ])) themes.push("Apparence");

  if (containsAny(t, [
    "odeur", "arome", "parfum", "sent", "odor", "odour", "smell", "aroma",
    "olor"
  ])) themes.push("Odeur/Arome");

  if (containsAny(t, [
    "gout", "saveur", "appetence", "taste", "flavour", "flavor", "sabor"
  ])) themes.push("Goût");

  if (containsAny(t, [
    "morceau", "morceaux", "bout", "pieces", "chunks", "trozos", "pedazos"
  ])) themes.push("Morceaux");

  if (containsAny(t, [
    "texture", "consistance", "cremeuse", "onctueuse", "lisse",
    "humide", "seche", "ferme", "moelleuse", "creamy", "smooth",
    "moist", "dry", "soft", "textura", "cremosa", "suave", "humeda"
  ])) themes.push("Texture");

  if (containsAny(t, [
    "arriere-gout", "arriere gout", "aftertaste", "regusto"
  ])) themes.push("Arrière-goût");

  if (containsAny(t, [
    "qualite", "qualitatif", "premium", "ingredient", "rassurant",
    "quality", "ingredients", "calidad", "ingredientes"
  ])) themes.push("Qualité");

  if (containsAny(t, [
    "sante", "digestion", "digere", "pelage", "mon chat", "chat a aime",
    "chat a tout mange", "gamelle", "leche", "health", "my cat",
    "bowl", "ate everything", "salud", "mi gato", "comio todo"
  ])) themes.push("Santé");

  if (containsAny(t, [
    "produit", "global", "general", "bon produit", "original",
    "product", "overall", "producto"
  ])) themes.push("Général");

  return [...new Set(themes)];
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
    "je ne sais pas",
    "rien ne m a plu",
    "aucun",
    "nothing",
    "no",
    "nada",
    "no se"
  ].some(value => t === value || t.includes(value));
}

async function analyseDetailsWithMistral(texte, themesDetectes) {
  const prompt = `
Tu analyses une réponse ouverte à propos d'une pâtée pour chat.

Réponse consommateur :
"${texte}"

Thèmes détectés automatiquement dans la réponse :
${themesDetectes.map(theme => "- " + theme).join("\n")}

TÂCHE :
Pour chacun des thèmes détectés automatiquement, dis seulement s'il est :
- "Oui - Détaillé"
- "Oui - Pas détaillé"

RÈGLES :
- Il est interdit de mettre "Non" pour un thème détecté automatiquement.
- Un thème est "Oui - Détaillé" s'il est accompagné d'un adjectif, d'une précision ou d'une caractéristique pertinente.
- Un thème est "Oui - Pas détaillé" s'il est seulement cité sans précision.
- Ne rédige pas la relance.

Exemples :
- "texture crémeuse" = Texture détaillée
- "texture onctueuse" = Texture détaillée
- "texture pas trop humide" = Texture détaillée
- "goût pas trop intense" = Goût détaillé
- "odeur naturelle" = Odeur/Arome détaillé
- "j'aime la texture" = Texture pas détaillée
- "j'aime l'odeur" = Odeur/Arome pas détaillé
- "j'aime le goût" = Goût pas détaillé
- "j'aime la texture et l'odeur" = Texture pas détaillée + Odeur/Arome pas détaillé

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
  }
}
`;

  const response = await callMistral([
    {
      role: "system",
      content: "Réponds uniquement avec un JSON valide. Aucun texte hors JSON."
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

async function buildRelanceWithMistral(texte, themesPasDetailles) {
  const prompt = `
Tu es un interviewer en test consommateur.

Réponse consommateur :
"${texte}"

Thèmes à faire préciser :
${themesPasDetailles.map(theme => "- " + theme).join("\n")}

TÂCHE :
Rédige UNE seule question courte pour demander au consommateur de préciser TOUS les thèmes listés.

RÈGLES :
- La question doit être dans la même langue que la réponse consommateur, quelle que soit cette langue.
- Ne traduis pas la réponse consommateur.
- Ne relance que sur les thèmes listés.
- Ne mentionne pas les thèmes non listés.
- Ne commence pas par "Q2.bis", "Relance", "Question" ou un préfixe technique.
- La question doit parler de cette pâtée pour chat / cat food / produit selon la langue de la réponse.
- Maximum 35 mots.

Réponds uniquement avec le texte de la question, sans JSON.
`;

  const response = await callMistral([
    {
      role: "system",
      content:
        "Tu rédiges uniquement la question de relance, dans la même langue que la réponse consommateur."
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

async function horsSujetRelanceWithMistral(texte) {
  const prompt = `
Réponse consommateur :
"${texte}"

La réponse ne parle pas clairement de la pâtée pour chat.

Rédige une seule question courte dans la même langue que la réponse consommateur pour demander de se concentrer sur la pâtée pour chat et de préciser ce qui a plu dans le produit.

Réponds uniquement avec la question.
`;

  const response = await callMistral([
    {
      role: "system",
      content:
        "Tu rédiges uniquement une question courte dans la même langue que la réponse consommateur."
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

    const themesDetectes = detectThemes(texte);

    if (themesDetectes.length === 0) {
      const relance = process.env.MISTRAL_API_KEY
        ? await horsSujetRelanceWithMistral(texte)
        : "Pouvez-vous vous concentrer sur la pâtée pour chat et préciser ce qui vous a plu dans ce produit ?";

      return res.json({
        analyse: emptyAnalyse(),
        relance
      });
    }

    const analyse = emptyAnalyse();

    if (!process.env.MISTRAL_API_KEY) {
      themesDetectes.forEach(theme => {
        analyse[theme] = "Oui - Pas détaillé";
      });

      return res.json({
        analyse,
        relance: "Pouvez-vous préciser ce que vous avez aimé dans les éléments mentionnés de cette pâtée pour chat ?"
      });
    }

    const jsonOutput = await analyseDetailsWithMistral(texte, themesDetectes);

    themesDetectes.forEach(theme => {
      const statut = jsonOutput?.analyse?.[theme];

      if (
        statut === "Oui - Détaillé" ||
        statut === "Oui - Pas détaillé"
      ) {
        analyse[theme] = statut;
      } else {
        analyse[theme] = "Oui - Pas détaillé";
      }
    });

    const themesPasDetailles = themesDetectes.filter(
      theme => analyse[theme] === "Oui - Pas détaillé"
    );

    if (themesPasDetailles.length === 0) {
      return res.json({
        analyse,
        relance: "Réponse suffisamment détaillée"
      });
    }

    const relance = await buildRelanceWithMistral(
      texte,
      themesPasDetailles
    );

    return res.json({
      analyse,
      relance
    });

  } catch (err) {
    console.error("Erreur Mistral :", err);

    return res.json({
      analyse: emptyAnalyse(),
      relance: "Réponse suffisamment détaillée"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log("Serveur prêt sur le port " + PORT);
});