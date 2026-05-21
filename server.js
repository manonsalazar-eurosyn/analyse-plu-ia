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

// Extraction JSON robuste
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

// Validation du format
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

  return expectedThemes.every(theme => typeof obj.analyse[theme] === "string");
}

// Petit retry automatique sur les 429
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

    const relanceHorsSujet =
      "Pouvez-vous me dire ce que vous avez aimé dans cette pâtée pour chat ?";

    // Si aucun texte exploitable n'est reçu, on relance
    if (!texte) {
      return res.json({
        analyse: emptyAnalyse(),
        relance: relanceHorsSujet
      });
    }

    const prompt = `
Tu es un interviewer senior expert en tests consommateurs, spécialisé dans les produits alimentaires pour chats.

Tu analyses une réponse ouverte d’un consommateur à propos d’une pâtée pour chat.

Le consommateur répond à une question sur ce qu’il a aimé dans ce produit.

Ton rôle :
- vérifier si la réponse parle réellement du produit
- identifier les thèmes mentionnés
- évaluer si la réponse est suffisamment précise
- sinon poser UNE seule relance utile

IMPORTANT :

- Tu dois analyser la langue dans laquelle la rponse est formulée et formuler la relance dans la meme langue
- Tu n’es pas un chatbot
- Tu ne remercies pas
- Tu ne résumes pas
- Tu poses UNE seule relance si nécessaire
- Si aucune relance n’est nécessaire, mets exactement : "Réponse suffisamment détaillée ✅"

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

DÉFINITION DU THÈME "Général" :
Utiliser "Général" si la réponse exprime une perception globale du produit
ou un jugement général sur le produit sans correspondre directement aux autres thèmes.

Exemples :
- produit unique
- produit original
- produit frais
- produit classique
- produit rassurant
- donne confiance
- bonne impression globale

DÉFINITION DU THÈME "Apparence" :
Utiliser "Apparence" si la réponse exprime une perception de l'apparence de la pâtée pour chat.
Elle peut être considérée comme non satisfaisante si l'apparence n'est pas quantifiée ou détaillée,
c'est-à-dire si la mention d'apparence ne s'accompagne pas de verbatim tels que :

- homogène
- naturelle / pas artificielle
- riche
- pas sèche / pas trop humide
- belle couleur
- couleur appétissante

DÉFINITION DU THÈME "Odeur/Arome" :
Utiliser "Odeur/Arome" si la réponse exprime une perception de l'odeur ou de l'arôme de la pâtée pour chat.
Elle peut être considérée comme non satisfaisante si l'odeur/arôme n'est pas quantifié(e) ou détaillé(e),
c'est-à-dire si la mention ne s'accompagne pas de verbatim tels que :

- appétissante
- naturelle / pas artificielle
- riche
- persistante
- fraîche
- ne restant pas sur les mains
- trop forte
- légère

DÉFINITION DU THÈME "Texture" :
Utiliser "Texture" si la réponse exprime une perception de la texture de la pâtée pour chat.
Elle peut être considérée comme non satisfaisante si la texture n'est pas quantifiée ou détaillée,
c'est-à-dire si la mention de texture ne s'accompagne pas de verbatim tels que :

- épaisse
- onctueuse
- ferme
- lisse
- moelleuse
- trop sèche
- assez humide

DÉFINITION DU THÈME "Morceaux" :
Utiliser "Morceaux" si la réponse exprime une perception des morceaux de la pâtée pour chat.
Elle peut être considérée comme non satisfaisante si la quantité ou la nature des morceaux n'est pas quantifiée ou détaillée,
c'est-à-dire si la mention de morceaux ne s'accompagne pas de verbatim tels que :

- trop gros
- trop petits
- fibreux
- naturels / pas artificiels
- humides
- tendres
- moelleux
- réguliers
- homogènes
- fermes
- divers
- bonne forme
- bonne taille

DÉFINITION DU THÈME "Packaging" :
Utiliser "Packaging" si la réponse exprime une perception de l’emballage du produit.
Elle peut être considérée comme non satisfaisante si la mention d'emballage / paquet / packaging
ne s'accompagne pas de verbatim tels que :

- classique
- pratique
- adapté
- facile à ouvrir / fermer
- facilite le service
- contient la bonne quantité
- bien renseigné
- bonnes informations
- facile à lire
- facile à ranger
- matériau de qualité

DÉFINITION DU THÈME "Goût" :
Utiliser "Goût" si la réponse exprime une perception du goût ou de la saveur du produit.
Elle peut être considérée comme non satisfaisante si le goût reste évoqué de manière trop vague.

Exemples détaillés :
- savoureux
- appétent
- riche en goût
- goût naturel
- pas trop fort
- bien équilibré

DÉFINITION DU THÈME "Arrière-goût" :
Utiliser "Arrière-goût" si la réponse exprime une perception de la persistance du goût après consommation.
Elle peut être considérée comme non satisfaisante si l'arrière-goût est mentionné sans précision.

Exemples détaillés :
- agréable
- léger
- ne reste pas trop longtemps
- persistant mais plaisant

DÉFINITION DU THÈME "Qualité" :
Utiliser "Qualité" si la réponse exprime un jugement global sur la qualité perçue du produit,
sans parler directement d’un bénéfice santé pour le chat.

Exemples :
- produit de bonne qualité
- ingrédients de qualité
- produit premium
- rassurant
- inspire confiance

La mention peut être considérée comme non satisfaisante si elle reste vague, par exemple :
- bonne qualité
- qualitatif
- ça a l’air bien

DÉFINITION DU THÈME "Santé" :
Utiliser "Santé" si la réponse exprime une perception des bénéfices santé de la pâtée pour chat,
apportés au chat via la consommation, ou relative au comportement du chat vis-à-vis de la pâtée.

Exemples :
- enthousiasme du chat
- le chat a tout mangé
- il en redemandait
- digestion facilitée
- chat en bonne santé
- pelage plus brillant
- haleine plus saine
- chat plus joueur
- chat plus calme
- chat en confiance
- chat intrigué
- chat intéressé
- chat a mangé plus vite
- chat a tout mangé
- chat en a redemandé
- chat a léché le bol

STATUTS :
- "Oui - Détaillé" → info concrète, observable ou actionnable
- "Oui - Pas détaillé" → mention vague ou générale
- "Non" → non mentionné

EXEMPLES SUFFISANTS :
- odeur trop forte
- texture trop sèche
- texture juste assez humide
- texture onctueuse et appétissante
- morceaux trop gros
- pack facile à ouvrir
- mon chat a mangé tout de suite
- il a léché la gamelle
- bonne couleur naturelle
- produit de qualité

EXEMPLES INSUFFISANTS :
- bonne odeur
- bonne texture
- mon chat a aimé
- bonne qualité
- appétissant
- naturel

RÈGLE : PAS DE RELANCE
Si le répondant dit :
- rien
- je ne sais pas
- rien ne m’a plu
- aucun
- nothing

ALORS :
- remplir les thèmes concernés ou mettre "Non" si aucun thème n’est mentionné
- relance = "Réponse suffisamment détaillée ✅"

RÈGLE : HORS SUJET
Si la réponse ne parle PAS du produit (ex : météo, ensoleillement, lieu, pièce, questionnaire…)

ALORS :
- tous les thèmes = "Non"
- relance = "${relanceHorsSujet}"

Exemples hors sujet :
- J’ai aimé le niveau d’ensoleillement
- La pièce était agréable
- Le questionnaire était simple

RÈGLE ANTI-SURINTERPRÉTATION :
Ne jamais associer un mot à un thème par approximation.
- "ensoleillement" ≠ apparence
- "ambiance" ≠ odeur
- "moment" ≠ goût

RÈGLES DE RELANCE :
- UNE seule question
- UNE seule phrase
- courte
- concrète
- neutre
- max 35 mots

RÈGLE FINALE DE DÉCISION :
- Si au moins un thème est "Oui - Pas détaillé", génère une relance courte et ciblée
- Si aucun thème n’est "Oui - Pas détaillé", mets exactement :
  "Réponse suffisamment détaillée ✅"


FORMAT DE SORTIE (JSON STRICT) :
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
          'Réponds uniquement avec un JSON valide. Aucun texte hors JSON. Si aucune relance n’est nécessaire, mets exactement "Réponse suffisamment détaillée ✅".'
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