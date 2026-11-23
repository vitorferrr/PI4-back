import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import documentoRoutes from "../routes/documentoRoutes.js";
import assinaturaService from "../services/assinaturaService.js";

vi.mock("../services/assinaturaService.js", () => ({
  default: {
    buscarParaAcesso: vi.fn(),
    registrar: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const documentoDoFiscalizador5 = { id: 7, visita_id: 10, visita: { id: 10, fiscalizadores: [{ id: 5 }] } };
const corpo = { assinante_tipo: "fiscalizador", usuario_id: 5, imagem: "base64" };

let servidor;
let urlBase;

const requisitar = (caminho, role = "fiscalizador", id = 5, body = corpo) =>
  fetch(`${urlBase}${caminho}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${jwt.sign({ id, role }, SEGREDO)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

beforeAll(async () => {
  vi.stubEnv("JWT_SECRET", SEGREDO);

  const app = express();
  app.use(express.json());
  app.use("/documentos", documentoRoutes);

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

describe("POST /documentos/:id/assinaturas", () => {
  it("registra a assinatura para o fiscalizador da visita", async () => {
    assinaturaService.buscarParaAcesso.mockResolvedValue(documentoDoFiscalizador5);
    assinaturaService.registrar.mockResolvedValue({ id: 1, documento_id: 7 });

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(201);
    expect(assinaturaService.buscarParaAcesso).toHaveBeenCalledWith("7");
    expect(assinaturaService.registrar).toHaveBeenCalledWith(7, corpo);
    expect(await resposta.json()).toEqual({ id: 1, documento_id: 7 });
  });

  it("responde 404 para fiscalizador que não é da visita, sem registrar", async () => {
    assinaturaService.buscarParaAcesso.mockResolvedValue(documentoDoFiscalizador5);

    const resposta = await requisitar("/documentos/7/assinaturas", "fiscalizador", 6);

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Documento não encontrado" });
    expect(assinaturaService.registrar).not.toHaveBeenCalled();
  });

  it("responde 404 quando o documento não existe", async () => {
    assinaturaService.buscarParaAcesso.mockResolvedValue(null);

    const resposta = await requisitar("/documentos/99/assinaturas");

    expect(resposta.status).toBe(404);
  });

  it("responde 404 quando o documento some antes de registrar", async () => {
    assinaturaService.buscarParaAcesso.mockResolvedValue(documentoDoFiscalizador5);
    assinaturaService.registrar.mockResolvedValue(null);

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(404);
  });

  it.each(["gestor", "admin"])("responde 403 para o perfil %s", async (role) => {
    const resposta = await requisitar("/documentos/7/assinaturas", role, 1);

    expect(resposta.status).toBe(403);
    expect(assinaturaService.buscarParaAcesso).not.toHaveBeenCalled();
  });

  it("responde 400 para id inválido", async () => {
    const resposta = await requisitar("/documentos/abc/assinaturas");

    expect(resposta.status).toBe(400);
    expect(assinaturaService.buscarParaAcesso).not.toHaveBeenCalled();
  });

  it("responde 400 com a mensagem da regra violada", async () => {
    const erro = new Error("Este fiscalizador já assinou o documento");
    erro.name = "ValidacaoError";
    assinaturaService.buscarParaAcesso.mockResolvedValue(documentoDoFiscalizador5);
    assinaturaService.registrar.mockRejectedValue(erro);

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao registrar assinatura",
      erros: ["Este fiscalizador já assinou o documento"],
    });
  });

  it("responde 401 sem token", async () => {
    const resposta = await fetch(`${urlBase}/documentos/7/assinaturas`, { method: "POST" });

    expect(resposta.status).toBe(401);
  });

  it("responde 500 quando o Storage falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const erro = new Error("Não foi possível enviar o arquivo ao armazenamento.");
    erro.name = "StorageError";
    assinaturaService.buscarParaAcesso.mockResolvedValue(documentoDoFiscalizador5);
    assinaturaService.registrar.mockRejectedValue(erro);

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ mensagem: "Erro ao registrar assinatura" });
    consoleError.mockRestore();
  });
});
