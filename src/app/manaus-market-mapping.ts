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

export type ManausMarketVerificationStatus =
  | "PUBLIC_LISTING_ONLY"
  | "CNPJ_VALIDATED"
  | "CNPJ_NOT_FOUND"
  | "CNPJ_AMBIGUOUS";

type ManausMappedBusinessCommon = {
  name: string;
  region: ManausCommercialRegion;
  cluster: string;
  neighborhood: string;
  address: string;
  segments: string[];
  sourceKind: "PUBLIC_MAP_LISTING" | "PUBLIC_DIRECTORY";
  sourceName: string;
  sourceUrl?: string;
  mappedAt: string;
};

type CadastralValidationDate = `${number}${number}${number}${number}-${number}${number}-${number}${number}`;

export type ManausMappedBusiness =
  | (ManausMappedBusinessCommon & {
      verificationStatus: "PUBLIC_LISTING_ONLY";
      cnpj?: never;
      legalName?: never;
      cadastralStatus?: never;
      cadastralSourceName?: never;
      cadastralSourceUrl?: never;
      validatedAt?: never;
      validationNote?: never;
    })
  | (ManausMappedBusinessCommon & {
      verificationStatus: "CNPJ_VALIDATED";
      cnpj: string;
      legalName: string;
      cadastralStatus: string;
      cadastralSourceName: string;
      cadastralSourceUrl: string;
      validatedAt: CadastralValidationDate;
      validationNote?: never;
    })
  | (ManausMappedBusinessCommon & {
      verificationStatus: "CNPJ_NOT_FOUND";
      cnpj?: never;
      legalName?: never;
      cadastralStatus?: never;
      cadastralSourceName: string;
      cadastralSourceUrl?: string;
      validatedAt: CadastralValidationDate;
      validationNote?: string;
    })
  | (ManausMappedBusinessCommon & {
      verificationStatus: "CNPJ_AMBIGUOUS";
      cnpj?: never;
      legalName?: never;
      cadastralStatus?: never;
      cadastralSourceName: string;
      cadastralSourceUrl?: string;
      validatedAt: CadastralValidationDate;
      validationNote: string;
    });

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

type MappedBusinessInput = Omit<ManausMappedBusinessCommon, "sourceKind" | "sourceName" | "sourceUrl" | "mappedAt">;

const mappedAt = "2026-09-25";
const mapListing = (business: MappedBusinessInput): ManausMappedBusiness => ({
  ...business,
  sourceKind: "PUBLIC_MAP_LISTING",
  sourceName: "Listagem pública de mapa",
  verificationStatus: "PUBLIC_LISTING_ONLY",
  mappedAt,
});
const publicDirectory = (business: MappedBusinessInput, sourceUrl: string): ManausMappedBusiness => ({
  ...business,
  sourceKind: "PUBLIC_DIRECTORY",
  sourceName: "Solutudo",
  sourceUrl,
  verificationStatus: "PUBLIC_LISTING_ONLY",
  mappedAt,
});

export const MANAUS_MAPPED_BUSINESSES: ManausMappedBusiness[] = [
  mapListing({ name: "Oficina Mecânica do Adão", region: "Sul", cluster: "Praça 14 / Cachoeirinha / Centro", neighborhood: "Praça 14 de Janeiro", address: "Av. Tarumã, 1830 - Praça 14 de Janeiro, Manaus - AM, 69020-000", segments: ["WORKSHOP"] }),
  mapListing({ name: "Auto Center News", region: "Sul", cluster: "Praça 14 / Cachoeirinha / Centro", neighborhood: "Cachoeirinha", address: "Av. Maués, 452 - Cachoeirinha, Manaus - AM, 69065-070", segments: ["AUTO_CENTER", "WORKSHOP"] }),
  mapListing({ name: "Oficina Mecânica JustTec em Manaus", region: "Sul", cluster: "Petrópolis / São Francisco / Raiz", neighborhood: "Petrópolis", address: "R. João Mendonça - Petrópolis, Manaus - AM, 69063-490", segments: ["WORKSHOP"] }),
  mapListing({ name: "Oficina Manauara Diesel - Raiz", region: "Sul", cluster: "Petrópolis / São Francisco / Raiz", neighborhood: "Raiz", address: "Av. Atlântica, 28 - Raiz, Manaus - AM, 69068-020", segments: ["WORKSHOP"] }),
  mapListing({ name: "Alan Oficina", region: "Sul", cluster: "Japiim / Educandos", neighborhood: "Japiim", address: "R. Padre Miguel Hidalgo, 406 - Japiim, Manaus - AM, 69078-490", segments: ["WORKSHOP"] }),
  mapListing({ name: "Oficina Souza Auto Peças", region: "Sul", cluster: "Adrianópolis / Nossa Senhora das Graças / São Geraldo", neighborhood: "Adrianópolis", address: "R. Belo Horizonte, 1140 - Adrianópolis, Manaus - AM, 69060-601", segments: ["WORKSHOP", "ACCESSORIES"] }),
  mapListing({ name: "Oficina NB", region: "Sul", cluster: "Adrianópolis / Nossa Senhora das Graças / São Geraldo", neighborhood: "São Geraldo", address: "R. São Geraldo, 80 - São Geraldo, Manaus - AM, 69053-370", segments: ["WORKSHOP"] }),
  mapListing({ name: "Saba Auto Center", region: "Sul", cluster: "Parque 10 / Aleixo / Flores", neighborhood: "Parque 10 de Novembro", address: "Av. Tancredo Neves, 1279 - Parque 10 de Novembro, Manaus - AM, 69054-700", segments: ["AUTO_CENTER", "WORKSHOP"] }),
  mapListing({ name: "Oficina Mecânica em Manaus - M.M. Auto Center", region: "Sul", cluster: "Parque 10 / Aleixo / Flores", neighborhood: "Aleixo", address: "R. Gabriel Gonçalves, 193 - Aleixo, Manaus - AM, 69060-170", segments: ["AUTO_CENTER", "WORKSHOP"] }),
  mapListing({ name: "Oficina mecânica do ferrugem", region: "Sul", cluster: "Parque 10 / Aleixo / Flores", neighborhood: "Flores", address: "R. Formosa, 25 - AME 386 - Flores, Manaus - AM, 69028-120", segments: ["WORKSHOP"] }),
  mapListing({ name: "Auto Mecânica & Elétrica Oficina PSP", region: "Oeste", cluster: "Alvorada / Dom Pedro / Redenção / Planalto", neighborhood: "Alvorada", address: "Rua 8, 106 - Alvorada 1, Manaus - AM, 69043-170", segments: ["WORKSHOP", "AUTO_ELECTRICAL"] }),
  mapListing({ name: "Auto Center Pascoal", region: "Oeste", cluster: "Alvorada / Dom Pedro / Redenção / Planalto", neighborhood: "Dom Pedro", address: "Av. Domingos Jorge Velho, 18 - Dom Pedro, Manaus - AM, 69042-470", segments: ["AUTO_CENTER", "WORKSHOP", "AIR_CONDITIONING"] }),
  mapListing({ name: "Oficina Mecânica Bosch Service", region: "Oeste", cluster: "Alvorada / Dom Pedro / Redenção / Planalto", neighborhood: "Redenção", address: "R. Cmte. Noberto Von Gal, 13-A - Redenção, Manaus - AM, 69049-100", segments: ["WORKSHOP"] }),
  mapListing({ name: "JR Oficina Mecânica e Eletrica", region: "Oeste", cluster: "Alvorada / Dom Pedro / Redenção / Planalto", neighborhood: "Planalto", address: "R. Ângelo Bitencourt, 100 - Planalto, Manaus - AM, 69044-410", segments: ["WORKSHOP", "AUTO_ELECTRICAL"] }),
  mapListing({ name: "TRZ Pneus Auto Center Compensa", region: "Oeste", cluster: "Compensa / Santo Antônio / São Jorge / São Raimundo", neighborhood: "Compensa", address: "Av. Compensa, 255 - Compensa, Manaus - AM, 69036-115", segments: ["AUTO_CENTER", "WORKSHOP", "TIRES_WHEELS", "BATTERY"] }),
  mapListing({ name: "Oficina Mecânica Viana", region: "Oeste", cluster: "Lírio do Vale / Nova Esperança", neighborhood: "Lírio do Vale", address: "R. Jequié, S/N - Lírio do Vale, Manaus - AM, 69038-490", segments: ["WORKSHOP"] }),
  mapListing({ name: "Mecânica automotiva oficina Carvalho", region: "Oeste", cluster: "Ponta Negra / Tarumã", neighborhood: "Tarumã", address: "R. Goiania Pq, Av. São Pedro, 172 - Tarumã, Manaus - AM, 69021-185", segments: ["WORKSHOP"] }),
  mapListing({ name: "TD Diesel - Oficina Mecânica Manaus", region: "Norte", cluster: "Cidade Nova / Novo Aleixo / Cidade de Deus", neighborhood: "Novo Aleixo", address: "R. Abraham Benzion - Novo Aleixo, Manaus - AM, 69098-025", segments: ["WORKSHOP"] }),
  mapListing({ name: "New Box Oficina Mecânica", region: "Norte", cluster: "Nova Cidade / Monte das Oliveiras / Novo Israel", neighborhood: "Nova Cidade", address: "R. Kenya - Nova Cidade, Manaus - AM, 69092-395", segments: ["WORKSHOP"] }),
  mapListing({ name: "JK Auto Center", region: "Norte", cluster: "Nova Cidade / Monte das Oliveiras / Novo Israel", neighborhood: "Monte das Oliveiras", address: "Av. Gov. José Lindoso, 5801 - Monte das Oliveiras, Manaus - AM", segments: ["AUTO_CENTER", "WORKSHOP"] }),
  mapListing({ name: "Ricardinho Oficina Mecânica", region: "Norte", cluster: "Nova Cidade / Monte das Oliveiras / Novo Israel", neighborhood: "Novo Israel", address: "R. Rodrigo Guedes, 24 - Novo Israel, Manaus - AM, 69039-180", segments: ["WORKSHOP"] }),
  mapListing({ name: "OFICINA MECANICA", region: "Norte", cluster: "Santa Etelvina / Lago Azul / Colônia Terra Nova", neighborhood: "Santa Etelvina", address: "Av. 7 de Maio, 728 - Santa Etelvina, Manaus - AM, 69008-270", segments: ["WORKSHOP"] }),
  mapListing({ name: "Stop Car Oficina Mecânica", region: "Norte", cluster: "Santa Etelvina / Lago Azul / Colônia Terra Nova", neighborhood: "Colônia Terra Nova", address: "Av. José Henrique Bentes Rodrigues, 1860 - Colônia Terra Nova, Manaus - AM, 69015-615", segments: ["WORKSHOP"] }),
  mapListing({ name: "LOURIVAL AUTO CENTER", region: "Leste", cluster: "Coroado / São José / Zumbi", neighborhood: "Coroado", address: "Av. Cosme Ferreira, 8714 - Coroado, Manaus - AM, 69075-805", segments: ["AUTO_CENTER", "WORKSHOP"] }),
  mapListing({ name: "Jg Mecanica Multimarcas", region: "Leste", cluster: "Coroado / São José / Zumbi", neighborhood: "Zumbi dos Palmares", address: "R. Quixandá, 7 - Zumbi dos Palmares, Manaus - AM, 69084-425", segments: ["WORKSHOP"] }),
  mapListing({ name: "Eletrocar - Oficina Mecânica e Elétrica", region: "Leste", cluster: "Jorge Teixeira / Tancredo Neves / Gilberto Mestrinho", neighborhood: "Jorge Teixeira", address: "R. dos Lírios, 33 - Jorge Teixeira, Manaus - AM, 69088-270", segments: ["WORKSHOP", "AUTO_ELECTRICAL"] }),
  mapListing({ name: "Oficina KAIZEN", region: "Leste", cluster: "Jorge Teixeira / Tancredo Neves / Gilberto Mestrinho", neighborhood: "Gilberto Mestrinho", address: "R. dos Açaizeiros, 1931 - Gilberto Mestrinho, Manaus - AM, 69086-666", segments: ["WORKSHOP"] }),
  mapListing({ name: "Oficina mecânica em Manaus - CAR-TECH MANUTENÇÃO VEICULAR", region: "Leste", cluster: "Armando Mendes / Distrito Industrial II / Mauazinho", neighborhood: "Armando Mendes", address: "Av. Autaz Mirim, 2704 - Armando Mendes, Manaus - AM, 69089-000", segments: ["WORKSHOP"] }),
  mapListing({ name: "Garagem 21 Mecânica Automotiva", region: "Leste", cluster: "Armando Mendes / Distrito Industrial II / Mauazinho", neighborhood: "Armando Mendes", address: "R. Rio Mutuzinho, 21 - Armando Mendes, Manaus - AM, 69089-050", segments: ["WORKSHOP"] }),
  publicDirectory({ name: "Gezivan Xavier De Sena", region: "Leste", cluster: "Colônia Antônio Aleixo / Puraquequara", neighborhood: "Puraquequara", address: "Rua Daniela Peres, 56 - Puraquequara, Manaus - AM", segments: ["WORKSHOP"] }, "https://www.solutudo.com.br/empresas/am/manaus/oficinas%20de%20carros%20e%20centros%20automotivos?cartoes_elo=1&cidade=manaus&estado=am&mais_bem_avaliadas=1&pagina=6&q="),
  publicDirectory({ name: "Tayguara Almeida Melo", region: "Leste", cluster: "Colônia Antônio Aleixo / Puraquequara", neighborhood: "Colônia Antônio Aleixo", address: "Rua Doutor Geraldo Rocha, 65 - Colônia Antônio Aleixo, Manaus - AM", segments: ["WORKSHOP"] }, "https://www.solutudo.com.br/empresas/am/manaus/oficinas%20de%20carros%20e%20centros%20automotivos?cartoes_elo=1&cidade=manaus&estado=am&mais_bem_avaliadas=1&pagina=8&q="),
];
