import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import questionarioRoutes from "../routes/questionarioRoutes.js";
import visitaRoutes from "../routes/visitaRoutes.js";
import questionarioService from "../services/questionarioService.js";
import visitaService from "../services/visitaService.js";

vi.mock("../services/authService.js", () => ({ default: { tokenRevogado: vi.fn(async () => false) } }));
vi.mock("../services/documentoService.js", () => ({
  default: {
    gerar: vi.fn(),
  },
}));

vi.mock("../services/questionarioService.js", () => ({
  default: {
    listar: vi.fn(),
    salvarRespostas: vi.fn(),
  },
}));

vi.mock("../services/visitaService.js", () => ({
  default: {
    buscarParaAcesso: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const visitaDoFiscalizador5 = { id: 10, status: "em_andamento", fiscalizadores: [{ id: 5 }] };
const respostas = [{ pergunta_id: 1, resposta: "Sim" }];

let servidor;
let urlBase;

const requisitar = (metodo, caminho, role = "fiscalizador", id = 5, corpo) =>
  fetch(`${urlBase}${caminho}`, {
    method: metodo,
    headers: {
      Authorization: `Bearer ${jwt.sign({ id, role }, SEGREDO)}`,
      "Content-Type": "application/json",
    },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
  app.use("/questionario", questionarioRoutes);
  app.use("/visitas", visitaRoutes);

  await new Promise((resolve) => {
    servidor = app.listen(0, resolve);
  });
  urlBase = `http://127.0.0.1:${servidor.address().port}`;
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await new Promise((resolve) => servidor.close(resolve));
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /questionario", () => {
  it("continua respondendo no mesmo caminho", async () => {
    questionarioService.listar.mockResolvedValue([{ id: 1 }]);

    const resposta = await requisitar("GET", "/questionario", "gestor", 1);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual([{ id: 1 }]);
  });
});

describe("POST /visitas/:id/respostas", () => {
  it("salva as respostas do fiscalizador associado", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaDoFiscalizador5);
    questionarioService.salvarRespostas.mockResolvedValue([{ id: 1, pergunta_id: 1 }]);

    const resposta = await requisitar("POST", "/visitas/10/respostas", "fiscalizador", 5, {
      respostas,
    });

    expect(resposta.status).toBe(200);
    expect(visitaService.buscarParaAcesso).toHaveBeenCalledWith("10");
    expect(questionarioService.salvarRespostas).toHaveBeenCalledWith(10, respostas);
    expect(await resposta.json()).toEqual([{ id: 1, pergunta_id: 1 }]);
  });

  it("responde 404 para fiscalizador não associado, sem salvar", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaDoFiscalizador5);

    const resposta = await requisitar("POST", "/visitas/10/respostas", "fiscalizador", 6, {
      respostas,
    });

    expect(resposta.status).toBe(404);
    expect(questionarioService.salvarRespostas).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita não existe", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(null);

    const resposta = await requisitar("POST", "/visitas/99/respostas", "fiscalizador", 5, {
      respostas,
    });

    expect(resposta.status).toBe(404);
  });

  it.each(["gestor", "admin"])("responde 403 para o perfil %s", async (role) => {
    const resposta = await requisitar("POST", "/visitas/10/respostas", role, 1, { respostas });

    expect(resposta.status).toBe(403);
    expect(visitaService.buscarParaAcesso).not.toHaveBeenCalled();
  });

  it("responde 400 para id inválido", async () => {
    const resposta = await requisitar("POST", "/visitas/abc/respostas", "fiscalizador", 5, {
      respostas,
    });

    expect(resposta.status).toBe(400);
    expect(visitaService.buscarParaAcesso).not.toHaveBeenCalled();
  });

  it("responde 400 com a lista de erros de validação", async () => {
    const erro = new Error("Há respostas inválidas");
    erro.name = "ValidacaoError";
    erro.errors = [{ message: "A pergunta 99 não existe" }];
    visitaService.buscarParaAcesso.mockResolvedValue(visitaDoFiscalizador5);
    questionarioService.salvarRespostas.mockRejectedValue(erro);

    const resposta = await requisitar("POST", "/visitas/10/respostas", "fiscalizador", 5, {
      respostas,
    });

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao salvar respostas",
      erros: ["A pergunta 99 não existe"],
    });
  });

  it("responde 401 sem token", async () => {
    const resposta = await fetch(`${urlBase}/visitas/10/respostas`, { method: "POST" });

    expect(resposta.status).toBe(401);
  });

  it("responde 500 quando o service falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    visitaService.buscarParaAcesso.mockRejectedValue(new Error("falha no banco"));

    const resposta = await requisitar("POST", "/visitas/10/respostas", "fiscalizador", 5, {
      respostas,
    });

    expect(resposta.status).toBe(500);
    consoleError.mockRestore();
  });
});