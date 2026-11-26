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

  it("tenta conectar de novo na próxima requisição depois de uma falha", async () => {
    sync.mockRejectedValueOnce(new Error("conexão recusada")).mockResolvedValue();
    const app = await carregarApp();

    const primeira = await requisitar(app, "/");
    const segunda = await fetch(`http://127.0.0.1:${servidor.address().port}/`);
    const terceira = await fetch(`http://127.0.0.1:${servidor.address().port}/`);

    expect(primeira.status).toBe(200);
    expect(segunda.status).toBe(200);
    expect(terceira.status).toBe(200);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it("continua respondendo 503 enquanto o banco segue indisponível e tenta a cada requisição", async () => {
    sync.mockRejectedValue(new Error("conexão recusada"));
    const app = await carregarApp();

    await requisitar(app, "/");
    const segunda = await fetch(`http://127.0.0.1:${servidor.address().port}/`);

    expect(segunda.status).toBe(503);
    expect(sync).toHaveBeenCalledTimes(3);
  });

  it("nunca apaga o banco, mesmo com ERASE_DATABASE_ON_SYNC=true", async () => {
    vi.stubEnv("ERASE_DATABASE_ON_SYNC", "true");
    sync.mockResolvedValue();

    await carregarApp();

    expect(sync).toHaveBeenCalledWith({ force: false });
  });
});

describe("corpo das requisições", () => {
  const enviar = async (app, contentType, corpo) => {
    await new Promise((resolve) => {
      servidor = app.listen(0, resolve);
    });
    return fetch(`http://127.0.0.1:${servidor.address().port}/documentos/1/assinaturas`, {
      method: "POST",
      headers: { "Content-Type": contentType },
      body: corpo,
    });
  };
  const enviarCorpo = (app, tamanho) =>
    enviar(app, "application/json", JSON.stringify({ imagem: "A".repeat(tamanho) }));

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

  it("recusa formulário acima de 1 MB em JSON", async () => {
    const app = await carregarApp();

    const resposta = await enviar(
      app,
      "application/x-www-form-urlencoded",
      `imagem=${"A".repeat(1100 * 1024)}`
    );

    expect(resposta.status).toBe(413);
    expect(await resposta.json()).toEqual({
      mensagem: "O corpo da requisição deve ter no máximo 1 MB",
    });
  });

  it("responde 400 em JSON quando o corpo está malformado", async () => {
    const app = await carregarApp();

    const resposta = await enviar(app, "application/json", '{"imagem":');

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({ mensagem: "JSON inválido no corpo da requisição" });
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
