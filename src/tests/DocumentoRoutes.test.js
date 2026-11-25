import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import visitaRoutes from "../routes/visitaRoutes.js";
import documentoService from "../services/documentoService.js";
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

let servidor;
let urlBase;

const requisitar = (caminho, role = "fiscalizador", id = 5) =>
  fetch(`${urlBase}${caminho}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${jwt.sign({ id, role }, SEGREDO)}` },
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
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

describe("POST /visitas/:id/documento", () => {
  it("cria o documento para o fiscalizador da visita", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaDoFiscalizador5);
    documentoService.gerar.mockResolvedValue({ documento: { id: 7, visita_id: 10 }, criado: true });

    const resposta = await requisitar("/visitas/10/documento");

    expect(resposta.status).toBe(201);
    expect(visitaService.buscarParaAcesso).toHaveBeenCalledWith("10");
    expect(documentoService.gerar).toHaveBeenCalledWith(10);
    expect(await resposta.json()).toEqual({ id: 7, visita_id: 10 });
  });

  it("responde 200 com o documento que já existia", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaDoFiscalizador5);
    documentoService.gerar.mockResolvedValue({ documento: { id: 7, visita_id: 10 }, criado: false });

    const resposta = await requisitar("/visitas/10/documento");

    expect(resposta.status).toBe(200);
  });

  it("responde 404 para fiscalizador não associado, sem gerar", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visitaDoFiscalizador5);

    const resposta = await requisitar("/visitas/10/documento", "fiscalizador", 6);

    expect(resposta.status).toBe(404);
    expect(documentoService.gerar).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita não existe", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(null);

    const resposta = await requisitar("/visitas/99/documento");

    expect(resposta.status).toBe(404);
  });

  it.each(["gestor", "admin"])("responde 403 para o perfil %s", async (role) => {
    const resposta = await requisitar("/visitas/10/documento", role, 1);

    expect(resposta.status).toBe(403);
    expect(visitaService.buscarParaAcesso).not.toHaveBeenCalled();
  });

  it("responde 400 para id inválido", async () => {
    const resposta = await requisitar("/visitas/abc/documento");

    expect(resposta.status).toBe(400);
    expect(visitaService.buscarParaAcesso).not.toHaveBeenCalled();
  });

  it("responde 400 com as perguntas que faltam responder", async () => {
    const erro = new Error("Responda todas as perguntas antes de gerar o documento");
    erro.name = "ValidacaoError";
    erro.errors = [{ message: "A pergunta 3 não foi respondida" }];
    visitaService.buscarParaAcesso.mockResolvedValue(visitaDoFiscalizador5);
    documentoService.gerar.mockRejectedValue(erro);

    const resposta = await requisitar("/visitas/10/documento");

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao gerar documento",
      erros: ["A pergunta 3 não foi respondida"],
    });
  });

  it("responde 401 sem token", async () => {
    const resposta = await fetch(`${urlBase}/visitas/10/documento`, { method: "POST" });

    expect(resposta.status).toBe(401);
  });

  it("responde 500 quando o service falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    visitaService.buscarParaAcesso.mockResolvedValue(visitaDoFiscalizador5);
    documentoService.gerar.mockRejectedValue(new Error("falha no banco"));

    const resposta = await requisitar("/visitas/10/documento");

    expect(resposta.status).toBe(500);
    consoleError.mockRestore();
  });
});
