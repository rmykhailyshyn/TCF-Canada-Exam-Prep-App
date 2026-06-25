import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { eq, inArray, like } from "drizzle-orm";
import { db, client } from "../server/db";
import {
  explanations,
  options,
  passages,
  questionResults,
  questions,
} from "../server/db/schema";
import { getMediaDir } from "../server/config/env";
import { solidColorPng } from "./lib/png";

// Dev-only seed: a full 39-question reading section so the quiz UI and session API can be
// exercised end-to-end without a real import. NOT part of any spec — purely a developer
// convenience. All rows use source_file = 'dev-seed.pdf' and are wiped + re-inserted on each
// run (idempotent). Run with `npm run seed:dev`.
//
// This exists because the only real results PDF available during Milestone 2 was a listening
// sample (no reading passages); reading-import remains validated only for the shared PDF parser.

const SOURCE = "dev-seed.pdf";

type SeedQuestion = {
  passage: number;
  text: string;
  opts: [string, string, string, string];
  correct: "A" | "B" | "C" | "D";
};

const PASSAGES: { title: string; text: string }[] = [
  {
    title: "Le télétravail",
    text: `Le télétravail s'est imposé dans de nombreuses entreprises depuis 2020. Si certains employés y voient une liberté nouvelle — pas de trajet, des horaires souples, un meilleur équilibre entre vie privée et vie professionnelle —, d'autres regrettent le lien social du bureau et peinent à séparer le travail du domicile. Les directions, elles, hésitent encore entre productivité accrue et perte de cohésion d'équipe. La plupart des sociétés optent désormais pour un modèle hybride, où chacun vient au bureau deux ou trois jours par semaine.`,
  },
  {
    title: "Les marchés de producteurs",
    text: `Chaque samedi matin, la place du village accueille un marché de producteurs locaux. Les habitants viennent y acheter des légumes de saison, du fromage fermier et du pain cuit au feu de bois. Au-delà des achats, le marché est un lieu de rencontre où l'on échange des nouvelles et des recettes. Les producteurs, eux, apprécient le contact direct avec les clients, qui leur permet d'expliquer leur travail et de fixer un prix juste, sans intermédiaire.`,
  },
  {
    title: "La lecture chez les jeunes",
    text: `Contrairement aux idées reçues, les adolescents n'ont pas cessé de lire ; ils lisent autrement. Aux romans imprimés s'ajoutent désormais les fictions publiées en ligne, les bandes dessinées numériques et les articles partagés sur les réseaux. Une enquête récente montre que les jeunes qui lisent sur écran lisent aussi davantage sur papier : les deux pratiques se renforcent plutôt qu'elles ne s'opposent. Reste à accompagner cette curiosité pour qu'elle se transforme en goût durable.`,
  },
  {
    title: "La mobilité urbaine",
    text: `Pour réduire la pollution, plusieurs grandes villes encouragent les déplacements à vélo. Des pistes cyclables protégées ont été aménagées, et des vélos en libre-service sont disponibles à chaque coin de rue. Les premiers résultats sont encourageants : la circulation automobile a légèrement diminué et la qualité de l'air s'est améliorée. Cependant, les associations rappellent que la sécurité des cyclistes dépend aussi du comportement des automobilistes, qui doivent apprendre à partager la chaussée.`,
  },
  {
    title: "L'alimentation et le climat",
    text: `Notre manière de nous nourrir a un effet direct sur le climat. Produire de la viande exige beaucoup d'eau et de terres, et génère d'importantes émissions de gaz à effet de serre. De plus en plus de consommateurs réduisent donc leur consommation de viande, sans pour autant devenir végétariens. Les scientifiques parlent d'une alimentation « flexitarienne », fondée sur les légumineuses, les céréales complètes et les produits de saison, plus respectueuse de l'environnement et souvent meilleure pour la santé.`,
  },
  {
    title: "Le bénévolat",
    text: `Le bénévolat connaît un regain d'intérêt, en particulier chez les retraités et les étudiants. Donner de son temps à une association permet de se sentir utile, de rencontrer d'autres personnes et d'acquérir de nouvelles compétences. Les organisations, souvent à court de moyens, comptent sur ces volontaires pour mener à bien leurs projets. Certains employeurs encouragent même leurs salariés à consacrer quelques heures par mois à une cause, estimant que cet engagement renforce aussi la motivation au travail.`,
  },
];

// 39 questions distributed across the six passages and the full sequence range.
const QUESTIONS: SeedQuestion[] = [
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

async function main(): Promise<void> {
  if (QUESTIONS.length !== 39) {
    throw new Error(`Expected 39 seed questions, got ${QUESTIONS.length}`);
  }

  await db.transaction(async (tx) => {
    // Wipe any previous dev-seed rows (children first, FK order).
    const existing = await tx
      .select({ id: questions.id })
      .from(questions)
      .where(eq(questions.sourceFile, SOURCE));
    const existingIds = existing.map((q) => q.id);
    if (existingIds.length > 0) {
      // Children that reference questions must go first (M7 explanations + any recorded answers
      // from sessions run against the previous seed), otherwise the FK blocks the question delete.
      await tx
        .delete(questionResults)
        .where(inArray(questionResults.questionId, existingIds));
      await tx
        .delete(explanations)
        .where(inArray(explanations.questionId, existingIds));
      await tx.delete(options).where(inArray(options.questionId, existingIds));
      await tx.delete(questions).where(eq(questions.sourceFile, SOURCE));
    }
    await tx
      .delete(passages)
      .where(like(passages.sourceFile, "%dev-seed-passage-%"));

    // Generate a real, browser-renderable placeholder image per passage into MEDIA_DIR/reading/, so
    // the reading UI's "image on top, OCR text below" path (reading-quiz-ui §Layout.3a) is exercised
    // without a real OCR import. Distinct hue per passage; sourceFile stores the path RELATIVE to
    // MEDIA_DIR that the passage-image route resolves and serves (matching the real OCR import).
    const mediaDir = getMediaDir();
    mkdirSync(resolve(mediaDir, "reading"), { recursive: true });
    const HUES: [number, number, number][] = [
      [219, 234, 254], // blue
      [220, 252, 231], // green
      [254, 243, 199], // amber
      [243, 232, 255], // violet
      [254, 226, 226], // rose
      [204, 251, 241], // teal
    ];

    // Insert passages.
    const passageIds: number[] = [];
    for (let i = 0; i < PASSAGES.length; i += 1) {
      const relImagePath = join("reading", `dev-seed-passage-${i}.png`);
      writeFileSync(
        resolve(mediaDir, relImagePath),
        solidColorPng(640, 360, HUES[i % HUES.length]),
      );
      const [row] = await tx
        .insert(passages)
        .values({ sourceFile: relImagePath, text: PASSAGES[i].text })
        .returning({ id: passages.id });
      passageIds.push(row.id);
    }

    // Insert questions + options.
    for (let i = 0; i < QUESTIONS.length; i += 1) {
      const q = QUESTIONS[i];
      const [qRow] = await tx
        .insert(questions)
        .values({
          passageId: passageIds[q.passage],
          sourceFile: SOURCE,
          sequence: i + 1,
          text: q.text,
          section: "reading",
        })
        .returning({ id: questions.id });

      const labels: ("A" | "B" | "C" | "D")[] = ["A", "B", "C", "D"];
      await tx.insert(options).values(
        labels.map((label, idx) => ({
          questionId: qRow.id,
          label,
          text: q.opts[idx],
          isCorrect: label === q.correct,
        })),
      );
    }
  });

  console.log(
    `Seeded ${PASSAGES.length} passages (+ placeholder images in ${getMediaDir()}) and ` +
      `${QUESTIONS.length} reading questions.`,
  );
  client.close();
}

main().catch((error: unknown) => {
  console.error("Seed failed:", error);
  process.exit(1);
});
