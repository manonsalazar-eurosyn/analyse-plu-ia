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

  if (!obj.analyse || typeof obj.analyse !== "object") {
    return false;
  }

  if (typeof obj.relance !== "string") {
    return false;
  }

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

      await new Promise(resolve =>
        setTimeout(resolve, 1200)
      );

      return callMistral(
        messages,
        retries - 1
      );
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
        relance:
          "Réponse suffisamment détaillée ✅"
      });
    }

    const prompt = `
Tu es un interviewer senior expert en tests consommateurs spécialisés dans les produits alimentaires pour chats.

Tu analyses une réponse ouverte d’un consommateur à propos d’une pâtée pour chat.

QUESTION POSÉE :
Qu’avez-vous aimé dans cette pâtée pour chat ?

OBJECTIF :
- Vérifier si la réponse parle bien du produit.
- Identifier les thèmes mentionnés.
- Déterminer si chaque thème est détaillé ou non.
- Générer UNE seule relance si nécessaire.
- Relancer UNIQUEMENT sur les thèmes insuffisamment détaillés.

IMPORTANT :
Tu n’es PAS un chatbot.
Tu ne remercies jamais.
Tu ne résumes jamais.
Tu ne commentes jamais.
Tu produis UNIQUEMENT le JSON demandé.

RÈGLE DE LANGUE OBLIGATOIRE :

La langue de la relance doit dépendre UNIQUEMENT de la langue de la réponse consommateur,
et PAS de la langue du prompt.

Exemples :
- "I like the taste" → relance en anglais
- "Me gusta el sabor" → relance en espagnol
- "J’aime le goût" → relance en français

Ne jamais répondre en français si la réponse est en anglais ou en espagnol.

Ne jamais ajouter :
- "Q2.bis"
- "Question complémentaire"
- "Relance"
- ou tout autre préfixe.

RÉPONSE CONSOMMATEUR :
"${texte}"

THÈMES À ANALYSER :
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

RÈGLE CRITIQUE PRIORITAIRE :

Le niveau de détail dépend UNIQUEMENT
de la précision des caractéristiques mentionnées,
ET JAMAIS de la longueur de la réponse.

Une réponse très courte peut être totalement suffisante.

Si un thème contient au moins un descripteur :
- concret
- observable
- spécifique

alors ce thème doit être :
"Oui - Détaillé"

et il ne faut JAMAIS relancer dessus.

Exemples SUFFISAMMENT détaillés :
- texture crémeuse
- texture onctueuse
- texture lisse
- texture humide
- texture ferme
- goût naturel
- goût équilibré
- goût riche
- odeur appétissante
- odeur naturelle
- morceaux tendres
- morceaux trop gros
- emballage pratique
- facile à ouvrir
- mon chat a tout mangé
- il a léché la gamelle

Même si la réponse est très courte,
elle doit être considérée comme suffisamment détaillée
si un descripteur précis est présent.

EXEMPLES :

Réponse :
"J’aime la texture crémeuse"

Analyse correcte :
- Texture = "Oui - Détaillé"

Relance correcte :
"Réponse suffisamment détaillée ✅"

Réponse :
"I like the creamy texture"

Analyse correcte :
- Texture = "Oui - Détaillé"

Relance correcte :
"Réponse suffisamment détaillée ✅"

Réponse :
"Me gusta la textura cremosa"

Analyse correcte :
- Texture = "Oui - Détaillé"

Relance correcte :
"Réponse suffisamment détaillée ✅"

À L’INVERSE :

Exemples PAS assez détaillés :
- bonne texture
- j’aime la texture
- texture agréable
- bon goût
- j’aime le goût
- bonne odeur
- bon produit
- bonne qualité

Ces réponses doivent être :
"Oui - Pas détaillé"

RÈGLE PRODUIT :

La réponse doit parler :
- du produit
- de la pâtée pour chat
- du chat
- de l’expérience du chat
- ou des caractéristiques du produit.

Si la réponse ne parle PAS du produit :

ALORS :
- tous les thèmes = "Non"
- relance dans la langue du répondant
- demander de se concentrer sur la pâtée pour chat
- demander ce qui lui a plu dans le produit

Exemples hors sujet :
- J’ai aimé le soleil
- La pièce était agréable
- Le questionnaire était simple
- Me gusta el clima
- I liked the room

RÈGLE ANTI-SURINTERPRÉTATION :

Ne jamais associer des mots à des thèmes par approximation.

Exemples :
- "soleil" ≠ apparence produit
- "ambiance" ≠ odeur
- "moment agréable" ≠ goût

DÉFINITIONS DES THÈMES :

Packaging :
emballage, paquet, ouverture, fermeture, rangement, lisibilité.

Apparence :
aspect visuel, couleur, homogénéité, aspect naturel.

Odeur/Arome :
odeur, arôme, parfum.

Goût :
goût, saveur, appétence.

Texture :
texture, consistance, humidité, onctuosité.

Morceaux :
taille, forme, tendreté, homogénéité des morceaux.

Arrière-goût :
goût persistant après consommation.

Qualité :
qualité perçue, premium, confiance.

Santé :
effets sur le chat, digestion, comportement du chat.

Général :
impression générale du produit.

RÈGLE DE RELANCE :

Si plusieurs thèmes sont :
"Oui - Pas détaillé"

ALORS :
la relance doit mentionner TOUS ces thèmes.

Exemple :
"J’aime le goût et l’odeur"

Analyse :
- Goût = "Oui - Pas détaillé"
- Odeur/Arome = "Oui - Pas détaillé"

Relance :
"Pouvez-vous préciser ce que vous avez aimé dans le goût et l’odeur de cette pâtée pour chat ?"

Exemple :
"I like the taste and smell"

Relance :
"Could you specify what you liked about the taste and smell of this cat food?"

Exemple :
"Me gusta el sabor y el olor"

Relance :
"¿Puede precisar qué le gustó del sabor y del olor de esta comida para gatos?"

RÈGLE IMPORTANTE :

Si un thème est déjà détaillé,
il ne doit JAMAIS apparaître dans la relance.

Exemple :
"J’aime le goût et la texture crémeuse"

Analyse correcte :
- Goût = "Oui - Pas détaillé"
- Texture = "Oui - Détaillé"

Relance correcte :
"Pouvez-vous préciser ce que vous avez aimé dans le goût de cette pâtée pour chat ?"

RÈGLE PAS DE RELANCE :

Si le répondant dit :
- rien
- je ne sais pas
- rien ne m’a plu
- aucun
- nothing
- no
- nada
- no sé

ALORS :
relance =
"Réponse suffisamment détaillée ✅"

RÈGLE FINALE :

- Si au moins un thème =
"Oui - Pas détaillé"

→ générer UNE seule relance.

- Si aucun thème n’est :
"Oui - Pas détaillé"

→ mettre EXACTEMENT :
"Réponse suffisamment détaillée ✅"

CONTRAINTES DE RELANCE :
- une seule phrase
- courte
- neutre
- maximum 35 mots
- même langue que le répondant

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
          "Réponds UNIQUEMENT avec un JSON valide. Aucun texte hors JSON."
      },
      {
        role: "user",
        content: prompt
      }
    ]);

    let output =
      response.choices?.[0]?.message?.content || "";

    if (Array.isArray(output)) {

      output = output
        .map(x => x.text || "")
        .join("")
        .trim();

    } else {

      output = String(output).trim();
    }

    const jsonOutput = extractJson(output);

    if (
      !jsonOutput ||
      !isValidResponse(jsonOutput)
    ) {

      return res.json({
        analyse: emptyAnalyse(),
        relance:
          "Réponse suffisamment détaillée ✅"
      });
    }

    return res.json(jsonOutput);

  } catch (err) {

    console.error("Erreur Mistral :", err);

    return res.json({
      analyse: emptyAnalyse(),
      relance:
        "Réponse suffisamment détaillée ✅"
    });
  }
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {

  console.log(
    \`Serveur prêt sur le port \${PORT} ✅\`
  );
});