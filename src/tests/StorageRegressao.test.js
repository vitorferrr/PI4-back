import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

vi.mock("@supabase/supabase-js", () => ({ createClient: vi.fn() }));
vi.mock("../models/index.js", () => ({
  sequelize: { sync: vi.fn().mockResolvedValue(undefined) },
  default: {
    Usuario: {}, Visita: {}, Documento: {}, RespostaQuestionario: {},
    PerguntaQuestionario: { findAll: vi.fn().mockResolvedValue([]) },
  },
}));

let servidor;
let urlBase;
const segredo = "segredo-local-do-teste-sem-storage";

beforeAll(async () => {
  vi.stubEnv("VERCEL", "1");
  vi.stubEnv("JWT_SECRET", segredo);
  vi.stubEnv("DATABASE_URL", "postgres://teste:teste@localhost:5432/teste");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  vi.stubEnv("SUPABASE_STORAGE_BUCKET", "");
  const { default: app, ready } = await import("../index.js");
  await ready;
  await new Promise((resolve) => { servidor = app.listen(0, "127.0.0.1", resolve); });
  urlBase = `http://127.0.0.1:${servidor.address().port}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  if (servidor) await new Promise((resolve) => servidor.close(resolve));
});

describe("funcionalidades existentes sem configuração Storage", () => {
  it("inicializa aplicação e atende rota existente sem cliente Supabase", async () => {
    const resposta = await fetch(`${urlBase}/`);
    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toContain("Servidor express");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("mantém autenticação e consulta do questionário", async () => {
    const semToken = await fetch(`${urlBase}/questionario`);
    expect(semToken.status).toBe(401);
    const token = jwt.sign({ id: 5, role: "fiscalizador" }, segredo);
    const resposta = await fetch(`${urlBase}/questionario`, { headers: { Authorization: `Bearer ${token}` } });
    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([]);
    expect(createClient).not.toHaveBeenCalled();
  });
});
