import { readdirSync, readFileSync, statSync } from "node:fs";
import argon2 from "argon2";
import { describe, expect, it } from "vitest";
import gerarHashSenha from "../utils/hashSenha.js";

const SRC = new URL("../", import.meta.url);

const arquivosJs = (pasta) =>
  readdirSync(pasta).flatMap((nome) => {
    const caminho = new URL(nome, pasta);
    if (statSync(caminho).isDirectory()) return nome === "tests" ? [] : arquivosJs(new URL(`${nome}/`, pasta));
    return nome.endsWith(".js") ? [caminho] : [];
  });

describe("gerarHashSenha", () => {
  it("gera um hash argon2id que confere com a senha certa e recusa a errada", async () => {
    const hash = await gerarHashSenha("senha-de-teste");

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(hash, "senha-de-teste")).toBe(true);
    expect(await argon2.verify(hash, "outra")).toBe(false);
  });

  // O hash fictício do login depende disso: se alguma senha real for gerada com
  // outros parâmetros, o tempo do login volta a revelar quais e-mails existem.
  it("é o único lugar do código que chama argon2.hash", () => {
    const fora = arquivosJs(SRC)
      .filter((caminho) => !caminho.pathname.endsWith("/utils/hashSenha.js"))
      .filter((caminho) => /argon2\s*\.\s*hash\s*\(/.test(readFileSync(caminho, "utf8")))
      .map((caminho) => caminho.pathname.split("/src/")[1]);

    expect(fora, "use gerarHashSenha (utils/hashSenha.js) em vez de argon2.hash").toEqual([]);
  });
});
