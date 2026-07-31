// Dev-only seed CONTENT for `npm run seed:dev`: the six French reading passages the seeded questions
// are drawn from. NOT part of any spec — purely a developer convenience, split out of
// scripts/seed-dev.ts so the seeding logic there stays readable next to its data.

export const PASSAGES: { title: string; text: string }[] = [
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
