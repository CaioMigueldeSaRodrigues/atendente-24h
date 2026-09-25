export type ManausCommercialRegion =
  | "Norte"
  | "Sul"
  | "Leste"
  | "Oeste";

export type ManausCommercialCluster = {
  region: ManausCommercialRegion;
  name: string;
  neighborhoods: string[];
};

export type ManausMappedBusiness = {
  name: string;
  region: ManausCommercialRegion;
  cluster: string;
  neighborhood: string;
  address: string;
  segments: string[];
  sourceKind: "PUBLIC_MAP_LISTING";
  mappedAt: string;
};

export const MANAUS_COMMERCIAL_REGIONS: ManausCommercialRegion[] = ["Norte", "Sul", "Leste", "Oeste"];

export const MANAUS_COMMERCIAL_CLUSTERS: ManausCommercialCluster[] = [
  { region: "Sul", name: "Praça 14 / Cachoeirinha / Centro", neighborhoods: ["Praça 14", "Cachoeirinha", "Centro"] },
  { region: "Sul", name: "Petrópolis / São Francisco / Raiz", neighborhoods: ["Petrópolis", "São Francisco", "Raiz"] },
  { region: "Sul", name: "Japiim / Educandos", neighborhoods: ["Japiim", "Educandos"] },
  { region: "Sul", name: "Adrianópolis / Nossa Senhora das Graças / São Geraldo", neighborhoods: ["Adrianópolis", "Nossa Senhora das Graças", "São Geraldo"] },
  { region: "Sul", name: "Parque 10 / Aleixo / Flores", neighborhoods: ["Parque 10", "Aleixo", "Flores"] },
  { region: "Oeste", name: "Alvorada / Dom Pedro / Redenção / Planalto", neighborhoods: ["Alvorada", "Dom Pedro", "Redenção", "Planalto"] },
  { region: "Oeste", name: "Compensa / Santo Antônio / São Jorge / São Raimundo", neighborhoods: ["Compensa", "Santo Antônio", "São Jorge", "São Raimundo"] },
  { region: "Oeste", name: "Lírio do Vale / Nova Esperança", neighborhoods: ["Lírio do Vale", "Nova Esperança"] },
  { region: "Oeste", name: "Ponta Negra / Tarumã", neighborhoods: ["Ponta Negra", "Tarumã"] },
  { region: "Norte", name: "Cidade Nova / Novo Aleixo / Cidade de Deus", neighborhoods: ["Cidade Nova", "Novo Aleixo", "Cidade de Deus"] },
  { region: "Norte", name: "Nova Cidade / Monte das Oliveiras / Novo Israel", neighborhoods: ["Nova Cidade", "Monte das Oliveiras", "Novo Israel"] },
  { region: "Norte", name: "Santa Etelvina / Lago Azul / Colônia Terra Nova", neighborhoods: ["Santa Etelvina", "Lago Azul", "Colônia Terra Nova"] },
  { region: "Leste", name: "Coroado / São José / Zumbi", neighborhoods: ["Coroado", "São José", "Zumbi"] },
  { region: "Leste", name: "Jorge Teixeira / Tancredo Neves / Gilberto Mestrinho", neighborhoods: ["Jorge Teixeira", "Tancredo Neves", "Gilberto Mestrinho"] },
  { region: "Leste", name: "Armando Mendes / Distrito Industrial II / Mauazinho", neighborhoods: ["Armando Mendes", "Distrito Industrial II", "Mauazinho"] },
  { region: "Leste", name: "Colônia Antônio Aleixo / Puraquequara", neighborhoods: ["Colônia Antônio Aleixo", "Puraquequara"] },
];

export const MANAUS_MAPPED_BUSINESSES: ManausMappedBusiness[] = [];
