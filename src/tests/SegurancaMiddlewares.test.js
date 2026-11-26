import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";

let servidor;

const subirApp = async (...middlewares) => {
  const { default: errorHandler } = await import("../middlewares/errorHandler.js");
  const app = express();
  app.use(...middlewares);
  // ?status=401 simula um login com senha errada.
  app.all("/teste", (req, res) => res.status(Number(req.query.status) || 200).json({ ok: true }));
  app.use(errorHandler);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  return `http://127.0.0.1:${servidor.address().port}/teste`;
};

afterEach(async () => {
  if (servidor) {
    await new Promise((resolve) => servidor.close(resolve));
    servidor = undefined;
  }
});

describe("corsMiddleware (DT-33)", () => {
  let corsMiddleware;

  beforeAll(async () => {
    // A lista é lida quando o arquivo é carregado; por isso o import vem depois do stub.
    vi.stubEnv("ALLOWED_ORIGINS", "http://localhost:8081, https://web.exemplo.com");
    vi.resetModules();
    ({ default: corsMiddleware } = await import("../middlewares/cors.js"));
  });

  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it("libera requisição sem Origin (app nativo, Postman) e expõe os headers do back", async () => {
    const url = await subirApp(corsMiddleware);

    const resposta = await fetch(url);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("access-control-expose-headers")).toBe(
      "X-Total-Count,X-Truncated,Content-Disposition"
    );
  });

  it.each(["http://localhost:8081", "https://web.exemplo.com"])(
    "libera a origem da lista (%s), mesmo com espaço depois da vírgula no .env",
    async (origem) => {
      const url = await subirApp(corsMiddleware);

      const resposta = await fetch(url, { headers: { Origin: origem } });

      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("access-control-allow-origin")).toBe(origem);
    }
  );

  it("responde o preflight (OPTIONS) de uma origem da lista", async () => {
    const url = await subirApp(corsMiddleware);

    const resposta = await fetch(url, {
      method: "OPTIONS",
      headers: {
        Origin: "https://web.exemplo.com",
        "Access-Control-Request-Method": "PATCH",
      },
    });

    expect(resposta.status).toBe(204);
    expect(resposta.headers.get("access-control-allow-origin")).toBe("https://web.exemplo.com");
  });

  it("barra com 403 a origem fora da lista, sem chegar na rota", async () => {
    const url = await subirApp(corsMiddleware);

    const resposta = await fetch(url, { headers: { Origin: "https://site-malicioso.com" } });

    expect(resposta.status).toBe(403);
    expect(resposta.headers.get("access-control-allow-origin")).toBeNull();
    expect((await resposta.json()).mensagem).toMatch(
      /^Bloqueio de CORS: Origem 'https:\/\/site-malicioso\.com' não autorizada/
    );
  });
});

describe("rateLimiter (DT-34)", () => {
  // Import novo a cada teste: o contador fica na memória do limitador.
  const carregarLimitadores = async () => {
    vi.resetModules();
    return import("../middlewares/rateLimiter.js");
  };

  it("logins que dão certo não contam para o limite", async () => {
    const { authLimiterMiddleware } = await carregarLimitadores();
    const url = await subirApp(authLimiterMiddleware);

    for (let login = 1; login <= 10; login++) {
      expect((await fetch(url, { method: "POST" })).status).toBe(200);
    }
  });

  it("deixa 5 tentativas erradas passarem e responde 429 na 6ª, mesmo com a senha certa", async () => {
    const { authLimiterMiddleware } = await carregarLimitadores();
    const url = await subirApp(authLimiterMiddleware);

    for (let tentativa = 1; tentativa <= 5; tentativa++) {
      expect((await fetch(`${url}?status=401`, { method: "POST" })).status).toBe(401);
    }
    const bloqueada = await fetch(url, { method: "POST" });

    expect(bloqueada.status).toBe(429);
    expect(await bloqueada.json()).toEqual({
      mensagem:
        "Muitas tentativas de autenticação originadas deste IP. Tente novamente em 15 minutos.",
    });
  });

  it("o limite geral é de 500 requisições a cada 15 minutos e avisa quanto falta", async () => {
    const { limiterMiddleware } = await carregarLimitadores();
    const url = await subirApp(limiterMiddleware);

    const resposta = await fetch(url);

    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("ratelimit-policy")).toBe("500;w=900");
    expect(resposta.headers.get("x-ratelimit-remaining")).toBe("499");
  });
});
