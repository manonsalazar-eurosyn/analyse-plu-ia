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
      temperature: 0.1
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

    if (!texte) {
      return res.json({
        analyse: emptyAnalyse(),
        relance:
          "Pouvez-vous vous concentrer sur la pâtée pour chat et préciser ce qui vous a plu dans ce produit ?"
      });
    }

    const prompt = `
Tu es un interviewer senior expert en tests consommateurs, spécialisé dans les produits alimentaires pour chats.

Tu analyses une réponse ouverte d’un consommateur à propos d’une pâtée pour chat.

QUESTION POSÉE AU CONSOMMATEUR :
Qu’avez-vous aimé dans cette pâtée pour chat ?

OBJECTIF :
- Vérifier si la réponse parle réellement de la pâtée pour chat.
- Identifier les thèmes mentionnés.
- Dire si chaque thème est détaillé ou pas.
- Si nécessaire, poser UNE seule relance utile.
- La relance doit porter sur TOUS les thèmes mentionnés mais pas assez détaillés.

RÈGLE DE LANGUE OBLIGATOIRE :
- Détecte la langue principale de la réponse consommateur.
- La relance doit être rédigée STRICTEMENT dans la même langue.
- Si la réponse est en espagnol, relance en espagnol.
- Si la réponse est en français, relance en français.
- Si la réponse est en anglais, relance en anglais.
- Ne jamais répondre en français si la réponse consommateur est en espagnol.
- Ne jamais ajouter de préfixe comme "Q2.bis", "Question complémentaire", "Relance" ou autre.

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
- "Oui - Détaillé" : thème mentionné avec une information concrète, observable ou actionnable.
- "Oui - Pas détaillé" : thème mentionné, mais formulation trop vague.
- "Non" : thème non mentionné.

RÈGLE PRODUIT :
La réponse doit parler de la pâtée pour chat, du produit, ou de l’expérience du chat avec cette pâtée.

Si la réponse ne parle pas du produit, du chat, de la pâtée, de son goût, son odeur, sa texture, ses morceaux, son apparence, sa qualité, son packaging, sa santé ou une appréciation produit :
- tous les thèmes = "Non"
- relance dans la langue de la réponse
- demander au répondant de se concentrer sur la pâtée pour chat et de préciser ce qui lui a plu dans le produit.

Exemples hors sujet :
- J’ai aimé le niveau d’ensoleillement.
- La pièce était agréable.
- Le questionnaire était simple.
- Me gusta el sol.
- La habitación era bonita.

RÈGLE ANTI-SURINTERPRÉTATION :
Ne jamais associer un mot à un thème par approximation.
- "ensoleillement" n’est pas une apparence du produit.
- "ambiance" n’est pas une odeur du produit.
- "moment agréable" n’est pas un goût du produit.

DÉFINITION DES THÈMES :

Packaging :
Mention de l’emballage, du paquet, du format, de l’ouverture, de la fermeture, du rangement, des informations sur le pack.
Pas détaillé :
- j’aime le packaging
- le paquet est bien
Détaillé :
- facile à ouvrir
- pratique
- bonne quantité
- facile à lire
- facile à ranger
- bien renseigné

Apparence :
Mention de l’aspect visuel de la pâtée.
Pas détaillé :
- belle apparence
- joli aspect
- appétissant
Détaillé :
- belle couleur
- couleur naturelle
- homogène
- riche
- pas sèche
- pas trop humide
- aspect naturel

Odeur/Arome :
Mention de l’odeur ou de l’arôme.
Pas détaillé :
- bonne odeur
- sent bon
- odeur agréable
Détaillé :
- odeur appétissante
- odeur naturelle
- odeur fraîche
- odeur légère
- pas trop forte
- odeur riche
- odeur qui ne reste pas sur les mains

Goût :
Mention du goût ou de la saveur.
Pas détaillé :
- j’aime le goût
- bon goût
- goût agréable
- me gusta el sabor
Détaillé :
- goût savoureux
- goût naturel
- riche en goût
- goût équilibré
- pas trop fort
- appétent
- sabor natural
- sabor equilibrado
- sabor intenso pero agradable

Texture :
Mention de la texture de la pâtée.
Pas détaillé :
- j’aime la texture
- bonne texture
- textura agradable
Détaillé :
- texture crémeuse
- texture onctueuse
- texture lisse
- texture ferme
- texture moelleuse
- assez humide
- pas sèche
- textura cremosa
- textura suave
- textura húmeda
- textura firme

Morceaux :
Mention des morceaux dans la pâtée.
Pas détaillé :
- bons morceaux
- morceaux bien
Détaillé :
- morceaux tendres
- morceaux réguliers
- morceaux naturels
- morceaux moelleux
- morceaux trop gros
- morceaux trop petits
- bonne taille
- bonne forme

Arrière-goût :
Mention du goût qui reste après consommation.
Pas détaillé :
- bon arrière-goût
- arrière-goût agréable
Détaillé :
- arrière-goût léger
- ne reste pas trop longtemps
- persistant mais plaisant
- pas désagréable après coup

Qualité :
Jugement sur la qualité perçue du produit.
Pas détaillé :
- bonne qualité
- qualitatif
- ça a l’air bien
Détaillé :
- ingrédients de qualité
- produit premium
- produit rassurant
- inspire confiance
- composition rassurante

Santé :
Mention d’un bénéfice santé ou du comportement du chat.
Pas détaillé :
- mon chat a aimé
- c’est bon pour mon chat
Détaillé :
- mon chat a tout mangé
- il a léché la gamelle
- il en redemandait
- bonne digestion
- pelage plus brillant
- chat plus joueur
- chat intéressé

Général :
Perception globale du produit.
Pas détaillé :
- j’aime ce produit
- c’est bien
- bon produit
Détaillé :
- produit original
- produit rassurant
- produit frais
- bonne impression globale
- produit classique mais efficace

RÈGLE IMPORTANTE SUR LES ITEMS DÉTAILLÉS :
Si un thème est déjà détaillé, ne pas relancer dessus.

Exemple :
Réponse : "J’aime le goût et la texture crémeuse"
Analyse :
- Goût = "Oui - Pas détaillé"
- Texture = "Oui - Détaillé"
Relance :
"Pouvez-vous préciser ce que vous avez aimé dans le goût de cette pâtée pour chat ?"

Exemple :
Réponse : "Me gusta el sabor y la textura cremosa."
Analyse :
- Goût = "Oui - Pas détaillé"
- Texture = "Oui - Détaillé"
Relance :
"¿Puede precisar qué le gustó del sabor de esta comida para gatos?"

RÈGLE MULTI-ITEMS PAS ASSEZ DÉTAILLÉS :
Si plusieurs thèmes sont "Oui - Pas détaillé", la relance doit citer tous ces thèmes.

Exemple :
Réponse : "J’aime le goût, l’odeur et la texture"
Analyse :
- Goût = "Oui - Pas détaillé"
- Odeur/Arome = "Oui - Pas détaillé"
- Texture = "Oui - Pas détaillé"
Relance :
"Pouvez-vous préciser ce que vous avez aimé dans le goût, l’odeur et la texture de cette pâtée pour chat ?"

Exemple :
Réponse : "Me gusta el sabor, el olor y la textura"
Analyse :
- Goût = "Oui - Pas détaillé"
- Odeur/Arome = "Oui - Pas détaillé"
- Texture = "Oui - Pas détaillé"
Relance :
"¿Puede precisar qué le gustó del sabor, el olor y la textura de esta comida para gatos?"

RÈGLE PAS DE RELANCE :
Si le répondant dit qu’il n’a rien aimé ou ne sait pas :
- rien
- je ne sais pas
- rien ne m’a plu
- aucun
- nothing
- nada
- no sé

Alors :
- relance = "Réponse suffisamment détaillée ✅"

RÈGLE FINALE :
- Si au moins un thème est "Oui - Pas détaillé", génère UNE seule relance courte sur tous les thèmes pas assez détaillés.
- Si aucun thème n’est "Oui - Pas détaillé", mets exactement :
"Réponse suffisamment détaillée ✅"

CONTRAINTES DE RELANCE :
- Une seule phrase.
- Courte.
- Neutre.
- Maximum 35 mots.
- Même langue que la réponse consommateur.
- Aucun préfixe technique.

FORMAT DE SORTIE JSON STRICT :
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
          'Réponds uniquement avec un JSON valide. Aucun texte hors JSON. La relance doit être dans la même langue que la réponse consommateur. Ne jamais ajouter de préfixe comme "Q2.bis", "Question complémentaire" ou "Relance".'
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
  console.log(`Serveur prêt sur le port ${PORT} ✅`);
});