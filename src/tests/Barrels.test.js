import { readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

// DT-30: todo arquivo de cada pasta precisa sair pelo index.js (barrel) dela.
// Sem este teste, um arquivo novo esquecido no barrel só quebra quando alguém
// tenta importá-lo por lá, ou o padrão se perde com imports diretos.
const PASTAS = ["controllers", "services", "routes", "middlewares", "utils", "config"];

const arquivosDa = (pasta) =>
  readdirSync(new URL(`../${pasta}/`, import.meta.url)).filter(
    (arquivo) => arquivo.endsWith(".js") && arquivo !== "index.js"
  );

describe.each(PASTAS)("barrel de src/%s", (pasta) => {
  it.each(arquivosDa(pasta))("reexporta tudo o que %s exporta", async (arquivo) => {
    const barrel = await import(`../${pasta}/index.js`);
    const modulo = await import(`../${pasta}/${arquivo}`);
    const exportadosPeloBarrel = new Set(Object.values(barrel));

    const fora = Object.entries(modulo)
      .filter(([, valor]) => !exportadosPeloBarrel.has(valor))
      .map(([nome]) => nome);

    expect(fora, `adicione ao src/${pasta}/index.js: ${fora.join(", ")}`).toEqual([]);
  });
});
