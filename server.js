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
  return Object.fromEntries(THEMES.map(t => [t, "Non"]));
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

function detectLanguage(texte) {
  const t = normalize(texte);

  if (/\b(i like|i liked|taste|smell|texture|cat food|packaging|my cat)\b/.test(t)) {
    return "en";
  }

  if (/\b(me gusta|me gusto|sabor|olor|textura|comida para gatos|envase|mi gato)\b/.test(t)) {
    return "es";
  }

  return "fr";
}

function containsAny(t, words) {
  return words.some(w => t.includes(w));
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
    "appearance", "look", "color", "colour", "aspecto", "color"
  ])) themes.push("Apparence");

  if (containsAny(t, [
    "odeur", "arome", "parfum", "sent", "odor", "odour", "smell", "aroma",
    "olor", "aroma"
  ])) themes.push("Odeur/Arome");

  if (containsAny(t, [
    "gout", "saveur", "appetence", "taste", "flavour", "flavor", "sabor"
  ])) themes.push("Goût");

  if (containsAny(t, [
    "morceau", "morceaux", "bout", "pieces", "chunks", "trozos", "pedazos"
  ])) themes.push("Morceaux");

  if (containsAny(t, [
    "texture", "consistance", "cremeuse", "crémeuse", "onctueuse", "lisse",
    "humide", "seche", "sèche", "ferme", "moelleuse", "creamy", "smooth",
    "moist", "dry", "soft", "textura", "cremosa", "suave", "humeda", "húmeda"
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
    "chat a tout mange", "gamelle", "leche", "health", "digestion", "my cat",
    "bowl", "ate everything", "salud", "mi gato", "digestion", "comio todo"
  ])) themes.push("Santé");

  if (containsAny(t, [
    "produit", "global", "general", "bien", "bon produit", "original",
    "product", "overall", "producto", "general"
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

function isValidPartial(obj) {
  if (!obj || typeof obj !== "object") return false;
  if (!obj.analyse || typeof obj.analyse !== "object") return false;
  return true;
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

function themeLabel(theme, lang) {
  const labels = {
    fr: {
      "Packaging": "le packaging",
      "Apparence": "l'apparence",
      "Odeur/Arome": "l'odeur",
      "Goût": "le goût",
      "Morceaux": "les morceaux",
      "Texture": "la texture",
      "Arrière-goût": "l'arrière-goût",
      "Qualité": "la qualité",
      "Santé": "la réaction ou le bien-être de votre chat",
      "Général": "votre impression générale"
    },
    en: {
      "Packaging": "the packaging",
      "Apparence": "the appearance",
      "Odeur/Arome": "the smell",
      "Goût": "the taste",
      "Morceaux": "the pieces",
      "Texture": "the texture",
      "Arrière-goût": "the aftertaste",
      "Qualité": "the quality",
      "Santé": "your cat's reaction or wellbeing",
      "Général": "your overall impression"
    },
    es: {
      "Packaging": "el envase",
      "Apparence": "el aspecto",
      "Odeur/Arome": "el olor",
      "Goût": "el sabor",
      "Morceaux": "los trozos",
      "Texture": "la textura",
      "Arrière-goût": "el regusto",
      "Qualité": "la calidad",
      "Santé": "la reacción o el bienestar de su gato",
      "Général": "su impresión general"
    }
  };

  return labels[lang]?.[theme] || theme;
}

function joinLabels(labels, lang) {
  if (labels.length === 1) return labels[0];

  const sep = lang === "en" ? " and " : lang === "es" ? " y " : " et ";

  return labels.slice(0, -1).join(", ") + sep + labels[labels.length - 1];
}

function buildRelance(themesPasDetailles, lang) {
  const labels = themesPasDetailles.map(theme => themeLabel(theme, lang));
  const joined = joinLabels(labels, lang);

  if (lang === "en") {
    return `Could you specify what you liked about ${joined} of this cat food?`;
  }

  if (lang === "es") {
    return `¿Puede precisar qué le gustó de ${joined} de esta comida para gatos?`;
  }

  return `Pouvez-vous préciser ce que vous avez aimé dans ${joined} de cette pâtée pour chat ?`;
}

function horsSujetRelance(lang) {
  if (lang === "en") {
    return "Could you focus on the cat food and specify what you liked about this product?";
  }

  if (lang === "es") {
    return "¿Puede centrarse en la comida para gatos y precisar qué le gustó de este producto?";
  }

  return "Pouvez-vous vous concentrer sur la pâtée pour chat et préciser ce qui vous a plu dans ce produit ?";
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
  ].some(x => t === x || t.includes(x));
}

async function analyseDetailsWithMistral(texte, themesDetectes) {
  const prompt = `
Tu analyses une réponse ouverte à propos d'une pâtée pour chat.

Réponse consommateur :
"${texte}"

Thèmes détectés automatiquement dans la réponse :
${themesDetectes.map(t => "- " + t).join("\n")}

TÂCHE :
Pour chacun des thèmes détectés automatiquement, dis seulement s'il est :
- "Oui - Détaillé"
- "Oui - Pas détaillé"

IMPORTANT :
- Il est interdit de mettre "Non" pour un thème de la liste détectée.
- Un thème est "Oui - Détaillé" s'il est accompagné d'un adjectif, d'une précision ou d'une caractéristique pertinente.
- Un thème est "Oui - Pas détaillé" s'il est seulement cité sans précision.
- Ne rédige pas la relance. La relance sera générée par le serveur.

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
      content:
        "Réponds uniquement avec un JSON valide. Aucun texte hors JSON."
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

app.post("/analyseIA", async (req, res) => {
  const texte = cleanText(req.body.texte || "");
  const lang = detectLanguage(texte);

  try {
    if (!texte) {
      return res.json({
        analyse: emptyAnalyse(),
        relance: horsSujetRelance(lang)
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
      return res.json({
        analyse: emptyAnalyse(),
        relance: horsSujetRelance(lang)
      });
    }

    if (!process.env.MISTRAL_API_KEY) {
      const analyse = emptyAnalyse();
      themesDetectes.forEach(theme => {
        analyse[theme] = "Oui - Pas détaillé";
      });

      return res.json({
        analyse,
        relance: buildRelance(themesDetectes, lang)
      });
    }

    const jsonOutput = await analyseDetailsWithMistral(texte, themesDetectes);

    const analyse = emptyAnalyse();

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

    const relance =
      themesPasDetailles.length > 0
        ? buildRelance(themesPasDetailles, lang)
        : "Réponse suffisamment détaillée";

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