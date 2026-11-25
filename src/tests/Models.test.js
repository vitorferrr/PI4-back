import { readdirSync, readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const pastaServices = new URL("../services/", import.meta.url);

const modelsUsadosPelosServices = () =>
  readdirSync(pastaServices)
    .filter((arquivo) => arquivo.endsWith(".js"))
    .flatMap((arquivo) => {
      const codigo = readFileSync(new URL(arquivo, pastaServices), "utf-8");
      const [, nomes = ""] = codigo.match(/const \{([^}]+)\} = models;/) ?? [];

      return nomes
        .split(",")
        .map((nome) => nome.trim())
        .filter(Boolean)
        .map((nome) => [arquivo, nome]);
    });

let models;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "postgres://teste:teste@127.0.0.1:5432/teste");
  ({ default: models } = await import("../models/index.js"));
});

afterAll(() => {
  vi.unstubAllEnvs();
});

describe("models/index.js de verdade", () => {
  it("encontra models usados nos services", () => {
    expect(modelsUsadosPelosServices().length).toBeGreaterThan(0);
  });

  it.each(modelsUsadosPelosServices())("%s usa %s, que está registrado", (_arquivo, nome) => {
    expect(models[nome]).toBeDefined();
  });

  it("registra a tabela de tokens revogados", () => {
    expect(models.TokenRevogado.getTableName()).toBe("tokens_revogados");
  });
});
