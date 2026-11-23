import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { sync } = vi.hoisted(() => ({ sync: vi.fn() }));

vi.mock("../models/index.js", () => ({
  sequelize: { sync },
  default: {},
}));

let servidor;

const carregarApp = async () => {
  vi.resetModules();
  const modulo = await import("../index.js");
  await modulo.ready.catch(() => {});
  return modulo.default;
};

const requisitar = async (app, caminho) => {
  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  return fetch(`http://127.0.0.1:${servidor.address().port}${caminho}`);
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (servidor) {
    await new Promise((resolve) => servidor.close(resolve));
    servidor = undefined;
  }
});

describe("inicialização na Vercel", () => {
  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
  });

  it("responde normalmente quando o banco conecta", async () => {
    sync.mockResolvedValue();
    const app = await carregarApp();

    const resposta = await requisitar(app, "/");

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe("Servidor express executando...");
  });

  it.each(["/", "/usuarios", "/visitas/1", "/auth/login"])(
    "responde 503 em %s quando o banco está indisponível",
    async (caminho) => {
      sync.mockRejectedValue(new Error("conexão recusada"));
      const app = await carregarApp();

      const resposta = await requisitar(app, caminho);

      expect(resposta.status).toBe(503);
      expect(await resposta.json()).toEqual({ mensagem: "Banco de dados indisponível" });
    }
  );

  it("nunca apaga o banco, mesmo com ERASE_DATABASE_ON_SYNC=true", async () => {
    vi.stubEnv("ERASE_DATABASE_ON_SYNC", "true");
    sync.mockResolvedValue();

    await carregarApp();

    expect(sync).toHaveBeenCalledWith({ force: false });
  });
});

describe("corpo das requisições", () => {
  const enviarCorpo = async (app, tamanho) => {
    await new Promise((resolve) => {
      servidor = app.listen(0, resolve);
    });
    return fetch(`http://127.0.0.1:${servidor.address().port}/documentos/1/assinaturas`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imagem: "A".repeat(tamanho) }),
    });
  };

  beforeEach(() => {
    vi.stubEnv("VERCEL", "1");
    sync.mockResolvedValue();
  });

  it("aceita o JSON de uma assinatura de 512 KiB em base64", async () => {
    const app = await carregarApp();

    const resposta = await enviarCorpo(app, 700 * 1024);

    expect(resposta.status).toBe(401);
  });

  it("recusa corpo acima de 1 MB", async () => {
    const app = await carregarApp();

    const resposta = await enviarCorpo(app, 1100 * 1024);

    expect(resposta.status).toBe(413);
    expect(await resposta.json()).toEqual({
      mensagem: "O corpo da requisição deve ter no máximo 1 MB",
    });
  });
});

describe("inicialização local", () => {
  it("encerra o processo com código 1 quando o banco está indisponível", async () => {
    vi.stubEnv("VERCEL", "");
    const exit = vi.spyOn(process, "exit").mockImplementation(() => {});
    sync.mockRejectedValue(new Error("conexão recusada"));

    await carregarApp();

    expect(exit).toHaveBeenCalledWith(1);
  });

  it("apaga o banco no sync quando ERASE_DATABASE_ON_SYNC=true", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("ERASE_DATABASE_ON_SYNC", "true");
    vi.spyOn(process, "exit").mockImplementation(() => {});
    sync.mockRejectedValue(new Error("conexão recusada"));

    await carregarApp();

    expect(sync).toHaveBeenCalledWith({ force: true });
  });
});
