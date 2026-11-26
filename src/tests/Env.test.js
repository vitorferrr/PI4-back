import { afterEach, describe, expect, it, vi } from "vitest";
import { env, validarEnv } from "../config/env.js";

const obrigatorias = {
  DATABASE_URL: "postgresql://usuario:senha@localhost:5432/pi4?sslmode=no-verify",
  JWT_SECRET: "segredo-de-teste",
};

const erroDe = (fonte) => {
  try {
    validarEnv(fonte);
  } catch (erro) {
    return erro;
  }
  throw new Error("validarEnv deveria ter falhado");
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validarEnv", () => {
  it("aceita só as obrigatórias e aplica os padrões", () => {
    expect(validarEnv(obrigatorias)).toMatchObject({
      DATABASE_URL: obrigatorias.DATABASE_URL,
      JWT_SECRET: obrigatorias.JWT_SECRET,
      PORT: 3000,
      NODE_ENV: "development",
      VERCEL: false,
      ERASE_DATABASE_ON_SYNC: false,
      EMAIL_ENVIO_REAL: false,
    });
  });

  it("lista todas as obrigatórias que faltam numa mensagem só", () => {
    const erro = erroDe({});

    expect(erro.name).toBe("ConfiguracaoAmbienteError");
    expect(erro.problemas).toEqual(["- DATABASE_URL: é obrigatória", "- JWT_SECRET: é obrigatória"]);
    expect(erro.message).toContain("Variáveis de ambiente ausentes ou inválidas:");
    expect(erro.message).toContain(".env.example");
  });

  it("trata texto vazio ou só com espaços como ausente", () => {
    const erro = erroDe({ DATABASE_URL: "   ", JWT_SECRET: "" });

    expect(erro.problemas).toEqual(["- DATABASE_URL: é obrigatória", "- JWT_SECRET: é obrigatória"]);
  });

  it("exige que a DATABASE_URL seja do Postgres, sem mostrar o valor", () => {
    const erro = erroDe({ ...obrigatorias, DATABASE_URL: "mysql://usuario:senhaSecreta@servidor/banco" });

    expect(erro.problemas).toEqual([
      "- DATABASE_URL: deve ser uma URL do Postgres (postgres:// ou postgresql://)",
    ]);
    expect(erro.message).not.toContain("senhaSecreta");
  });

  it("converte PORT em número e recusa porta inválida", () => {
    expect(validarEnv({ ...obrigatorias, PORT: " 8080 " }).PORT).toBe(8080);

    for (const PORT of ["porta", "0", "70000", "3.5"]) {
      expect(erroDe({ ...obrigatorias, PORT }).problemas).toEqual([
        "- PORT: deve ser um número de porta entre 1 e 65535",
      ]);
    }
  });

  it("liga as flags só com o texto true", () => {
    expect(validarEnv({ ...obrigatorias, ERASE_DATABASE_ON_SYNC: "true", EMAIL_ENVIO_REAL: " true " }))
      .toMatchObject({ ERASE_DATABASE_ON_SYNC: true, EMAIL_ENVIO_REAL: true });

    for (const valor of ["false", "1", "TRUE", ""]) {
      expect(validarEnv({ ...obrigatorias, ERASE_DATABASE_ON_SYNC: valor }).ERASE_DATABASE_ON_SYNC).toBe(false);
    }
  });

  it("considera VERCEL ligada com qualquer valor preenchido, como a Vercel faz", () => {
    expect(validarEnv({ ...obrigatorias, VERCEL: "1" }).VERCEL).toBe(true);
    expect(validarEnv({ ...obrigatorias, VERCEL: "" }).VERCEL).toBe(false);
  });

  it("não exige Supabase nem SMTP, e tira os espaços das pontas", () => {
    const resultado = validarEnv({
      ...obrigatorias,
      SUPABASE_URL: "  https://projeto.supabase.co  ",
      SMTP_PORT: " 587 ",
    });

    expect(resultado.SUPABASE_URL).toBe("https://projeto.supabase.co");
    expect(resultado.SMTP_PORT).toBe("587");
    expect(resultado.SMTP_HOST).toBeUndefined();
  });
});

describe("env", () => {
  it("lê o process.env atual a cada acesso, já convertido", () => {
    vi.stubEnv("PORT", "4000");
    expect(env.PORT).toBe(4000);

    vi.stubEnv("PORT", "5000");
    expect(env.PORT).toBe(5000);

    vi.stubEnv("EMAIL_ENVIO_REAL", "true");
    expect(env.EMAIL_ENVIO_REAL).toBe(true);
  });

  it("devolve undefined para valor inválido em vez de quebrar quem usa", () => {
    vi.stubEnv("PORT", "porta");
    vi.stubEnv("DATABASE_URL", "");

    expect(env.PORT).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
  });

  it("não pode ser alterado pelo código", () => {
    expect(Object.isFrozen(env)).toBe(true);
    expect(() => {
      "use strict";
      env.JWT_SECRET = "outro";
    }).toThrow();
  });
});
