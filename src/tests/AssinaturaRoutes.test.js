import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import documentoRoutes from "../routes/documentoRoutes.js";
import assinaturaService from "../services/assinaturaService.js";

vi.mock("../services/assinaturaService.js", () => ({
  default: {
    registrar: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const corpo = { assinante_tipo: "fiscalizador", imagem: "base64" };

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
  it("registra a assinatura em nome do usuário do token", async () => {
    assinaturaService.registrar.mockResolvedValue({ id: 1, documento_id: 7 });

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(201);
    expect(assinaturaService.registrar).toHaveBeenCalledWith(
      "7",
      corpo,
      expect.objectContaining({ id: 5, role: "fiscalizador" })
    );
    expect(await resposta.json()).toEqual({ id: 1, documento_id: 7 });
  });

  it("responde 404 quando o documento não existe ou não é do fiscal", async () => {
    assinaturaService.registrar.mockResolvedValue(null);

    const resposta = await requisitar("/documentos/99/assinaturas");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Documento não encontrado" });
  });

  it.each(["gestor", "admin"])("responde 403 para o perfil %s", async (role) => {
    const resposta = await requisitar("/documentos/7/assinaturas", role, 1);

    expect(resposta.status).toBe(403);
    expect(assinaturaService.registrar).not.toHaveBeenCalled();
  });

  it("responde 400 para id inválido", async () => {
    const resposta = await requisitar("/documentos/abc/assinaturas");

    expect(resposta.status).toBe(400);
    expect(assinaturaService.registrar).not.toHaveBeenCalled();
  });

  it("responde 400 com a mensagem da regra violada", async () => {
    const erro = new Error("Este fiscalizador já assinou o documento");
    erro.name = "ValidacaoError";
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

  it("responde 503 quando o Storage falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const erro = new Error("Não foi possível enviar o arquivo ao armazenamento.");
    erro.name = "StorageError";
    erro.codigo = "STORAGE_UPLOAD_FALHOU";
    assinaturaService.registrar.mockRejectedValue(erro);

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(503);
    expect(await resposta.json()).toEqual({
      mensagem: "Serviço de armazenamento indisponível. Tente novamente mais tarde.",
    });
    consoleError.mockRestore();
  });

  it("responde 500 em falha inesperada", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    assinaturaService.registrar.mockRejectedValue(new Error("falha no banco"));

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(500);
    expect(await resposta.json()).toEqual({ mensagem: "Erro ao registrar assinatura" });
    consoleError.mockRestore();
  });
});
