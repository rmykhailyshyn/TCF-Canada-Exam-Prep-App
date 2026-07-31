// Dev-only seed CONTENT for `npm run seed:dev`: the 39 reading questions, each referencing one of the
// passages in ./seed-dev-passages by index and distributed across the full sequence range. NOT part
// of any spec — purely a developer convenience.

export type SeedQuestion = {
  passage: number;
  text: string;
  opts: [string, string, string, string];
  correct: "A" | "B" | "C" | "D";
};

export const QUESTIONS: SeedQuestion[] = [
  {
    passage: 0,
    text: "Quel est le principal avantage du télétravail cité par certains employés ?",
    opts: [
      "Un salaire plus élevé",
      "Une plus grande liberté",
      "Plus de promotions",
      "De nouveaux collègues",
    ],
    correct: "B",
  },
  {
    passage: 0,
    text: "Que regrettent les employés opposés au télétravail ?",
    opts: [
      "Le lien social du bureau",
      "Les horaires fixes",
      "Les trajets quotidiens",
      "Le salaire",
    ],
    correct: "A",
  },
  {
    passage: 0,
    text: "Quel modèle la plupart des entreprises adoptent-elles ?",
    opts: [
      "Tout à distance",
      "Tout au bureau",
      "Un modèle hybride",
      "Aucun changement",
    ],
    correct: "C",
  },
  {
    passage: 0,
    text: "Quelle est l'hésitation des directions ?",
    opts: [
      "Productivité ou cohésion",
      "Embaucher ou licencier",
      "Vendre ou acheter",
      "Ouvrir ou fermer",
    ],
    correct: "A",
  },
  {
    passage: 1,
    text: "Quand a lieu le marché de producteurs ?",
    opts: [
      "Le dimanche soir",
      "Le samedi matin",
      "Le lundi midi",
      "Le vendredi",
    ],
    correct: "B",
  },
  {
    passage: 1,
    text: "Que viennent acheter les habitants ?",
    opts: ["Des vêtements", "Des outils", "Des produits locaux", "Des livres"],
    correct: "C",
  },
  {
    passage: 1,
    text: "Qu'apprécient les producteurs ?",
    opts: [
      "Les intermédiaires",
      "Le contact direct",
      "Les grandes surfaces",
      "La publicité",
    ],
    correct: "B",
  },
  {
    passage: 1,
    text: "Au-delà des achats, le marché est surtout… ?",
    opts: ["Un lieu de rencontre", "Un musée", "Une école", "Un bureau"],
    correct: "A",
  },
  {
    passage: 1,
    text: "Comment est cuit le pain vendu ?",
    opts: ["Au micro-ondes", "Au feu de bois", "À la vapeur", "Au gaz"],
    correct: "B",
  },
  {
    passage: 1,
    text: "Quel prix les producteurs peuvent-ils fixer ?",
    opts: [
      "Un prix imposé",
      "Un prix juste",
      "Un prix élevé",
      "Un prix secret",
    ],
    correct: "B",
  },
  {
    passage: 2,
    text: "Selon le texte, les adolescents… ?",
    opts: [
      "ont cessé de lire",
      "lisent autrement",
      "détestent lire",
      "n'écrivent plus",
    ],
    correct: "B",
  },
  {
    passage: 2,
    text: "Que montre l'enquête récente ?",
    opts: [
      "L'écran remplace le papier",
      "Les deux pratiques se renforcent",
      "Personne ne lit",
      "Le papier disparaît",
    ],
    correct: "B",
  },
  {
    passage: 2,
    text: "Que faut-il faire de cette curiosité ?",
    opts: ["La décourager", "L'accompagner", "L'ignorer", "La punir"],
    correct: "B",
  },
  {
    passage: 2,
    text: "Quel nouveau format est mentionné ?",
    opts: [
      "Les fictions en ligne",
      "Les manuscrits",
      "Les journaux télévisés",
      "Les affiches",
    ],
    correct: "A",
  },
  {
    passage: 2,
    text: "L'idée reçue contredite par le texte est que… ?",
    opts: [
      "les jeunes lisent trop",
      "les jeunes ne lisent plus",
      "les jeunes écrivent trop",
      "les jeunes lisent sur papier",
    ],
    correct: "B",
  },
  {
    passage: 3,
    text: "Pourquoi les villes encouragent-elles le vélo ?",
    opts: [
      "Pour gagner de l'argent",
      "Pour réduire la pollution",
      "Pour le sport",
      "Pour le tourisme",
    ],
    correct: "B",
  },
  {
    passage: 3,
    text: "Qu'a-t-on aménagé pour les cyclistes ?",
    opts: [
      "Des parkings",
      "Des pistes cyclables protégées",
      "Des autoroutes",
      "Des tunnels",
    ],
    correct: "B",
  },
  {
    passage: 3,
    text: "Quel premier résultat est observé ?",
    opts: [
      "L'air s'est amélioré",
      "Plus d'accidents",
      "Plus de voitures",
      "Moins de vélos",
    ],
    correct: "A",
  },
  {
    passage: 3,
    text: "De quoi dépend aussi la sécurité des cyclistes ?",
    opts: [
      "De la météo",
      "Du comportement des automobilistes",
      "Du prix du vélo",
      "De la saison",
    ],
    correct: "B",
  },
  {
    passage: 3,
    text: "Que doivent apprendre les automobilistes ?",
    opts: [
      "À rouler plus vite",
      "À partager la chaussée",
      "À klaxonner",
      "À se garer",
    ],
    correct: "B",
  },
  {
    passage: 4,
    text: "Quel aliment exige beaucoup d'eau et de terres ?",
    opts: ["Les légumes", "La viande", "Les céréales", "Les fruits"],
    correct: "B",
  },
  {
    passage: 4,
    text: "Que font de plus en plus de consommateurs ?",
    opts: [
      "Ils mangent plus de viande",
      "Ils réduisent la viande",
      "Ils arrêtent de manger",
      "Ils cuisinent moins",
    ],
    correct: "B",
  },
  {
    passage: 4,
    text: "Comment les scientifiques nomment-ils ce régime ?",
    opts: ["Carnivore", "Flexitarien", "Industriel", "Express"],
    correct: "B",
  },
  {
    passage: 4,
    text: "Sur quoi repose ce régime ?",
    opts: [
      "Les légumineuses et céréales",
      "Les plats préparés",
      "Les boissons sucrées",
      "Les conserves",
    ],
    correct: "A",
  },
  {
    passage: 4,
    text: "Ce régime est souvent… pour la santé ?",
    opts: ["Mauvais", "Meilleur", "Sans effet", "Dangereux"],
    correct: "B",
  },
  {
    passage: 4,
    text: "Les consommateurs deviennent-ils végétariens ?",
    opts: ["Oui, tous", "Pas nécessairement", "Jamais", "Obligatoirement"],
    correct: "B",
  },
  {
    passage: 4,
    text: "Quel gaz est mentionné ?",
    opts: ["Gaz à effet de serre", "Gaz noble", "Gaz hilarant", "Gaz naturel"],
    correct: "A",
  },
  {
    passage: 5,
    text: "Qui s'intéresse de nouveau au bénévolat ?",
    opts: [
      "Les enfants",
      "Les retraités et étudiants",
      "Les touristes",
      "Les sportifs",
    ],
    correct: "B",
  },
  {
    passage: 5,
    text: "Que permet le bénévolat ?",
    opts: [
      "De gagner un salaire",
      "De se sentir utile",
      "De voyager gratuitement",
      "D'éviter les impôts",
    ],
    correct: "B",
  },
  {
    passage: 5,
    text: "Pourquoi les associations comptent-elles sur les volontaires ?",
    opts: [
      "Elles sont riches",
      "Elles manquent de moyens",
      "Elles ferment",
      "Elles recrutent peu",
    ],
    correct: "B",
  },
  {
    passage: 5,
    text: "Que font certains employeurs ?",
    opts: [
      "Ils interdisent le bénévolat",
      "Ils l'encouragent",
      "Ils le sanctionnent",
      "Ils l'ignorent",
    ],
    correct: "B",
  },
  {
    passage: 5,
    text: "Selon ces employeurs, l'engagement renforce… ?",
    opts: [
      "La fatigue",
      "La motivation au travail",
      "Les conflits",
      "Les absences",
    ],
    correct: "B",
  },
  {
    passage: 0,
    text: "Le modèle hybride implique de venir au bureau… ?",
    opts: ["tous les jours", "jamais", "deux ou trois jours", "le week-end"],
    correct: "C",
  },
  {
    passage: 2,
    text: "Les bandes dessinées numériques sont citées comme… ?",
    opts: ["un format de lecture", "un jeu vidéo", "un film", "un cours"],
    correct: "A",
  },
  {
    passage: 3,
    text: "Les vélos en libre-service se trouvent… ?",
    opts: [
      "à chaque coin de rue",
      "uniquement en gare",
      "dans les musées",
      "à la campagne",
    ],
    correct: "A",
  },
  {
    passage: 1,
    text: "Le marché se tient sur… ?",
    opts: [
      "la place du village",
      "la plage",
      "un parking souterrain",
      "une autoroute",
    ],
    correct: "A",
  },
  {
    passage: 4,
    text: "Produire de la viande génère d'importantes… ?",
    opts: ["économies", "émissions", "récoltes", "pluies"],
    correct: "B",
  },
  {
    passage: 5,
    text: "Le bénévolat permet d'acquérir… ?",
    opts: [
      "de nouvelles compétences",
      "des dettes",
      "des congés",
      "une voiture",
    ],
    correct: "A",
  },
  {
    passage: 0,
    text: "Pour les employés favorables, le télétravail supprime… ?",
    opts: ["le salaire", "le trajet", "les vacances", "les réunions"],
    correct: "B",
  },
];
