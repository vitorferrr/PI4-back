import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import jwt from "jsonwebtoken";
import documentoRoutes from "../routes/documentoRoutes.js";
import errorHandler from "../middlewares/errorHandler.js";
import assinaturaService from "../services/assinaturaService.js";
import documentoService from "../services/documentoService.js";
import { waitUntil } from "@vercel/functions";

vi.mock("../services/authService.js", () => ({ default: { tokenRevogado: vi.fn(async () => false) } }));
vi.mock("../services/documentoService.js", () => ({
  default: {
    gerar: vi.fn(),
    finalizar: vi.fn(),
    enviarEmail: vi.fn(),
    gerarLinkPdf: vi.fn(),
  },
}));

vi.mock("../services/visitaService.js", () => ({ default: { buscarParaAcesso: vi.fn() } }));

vi.mock("@vercel/functions", () => ({ waitUntil: vi.fn() }));

vi.mock("../services/assinaturaService.js", () => ({
  default: {
    registrar: vi.fn(),
    remover: vi.fn(),
  },
}));

const SEGREDO = "segredo-de-teste";
const corpo = { assinante_tipo: "fiscalizador", imagem: "base64" };

let servidor;
let urlBase;

const requisitar = (caminho, role = "fiscalizador", id = 5, body = corpo, method = "POST") =>
  fetch(`${urlBase}${caminho}`, {
    method,
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
  app.use(errorHandler);

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

describe("POST /documentos/:id/finalizar", () => {
  it("repete o fechamento conferindo o usuário do token", async () => {
    const resultado = { situacao: "finalizado", documento_id: 7, pendentes: [], pdf_gerado: false, enviado_email: true };
    documentoService.finalizar.mockResolvedValue({ ...resultado, email_pendente: false });

    const resposta = await requisitar("/documentos/7/finalizar");

    expect(resposta.status).toBe(200);
    expect(documentoService.finalizar).toHaveBeenCalledWith(7, {
      usuario: expect.objectContaining({ id: 5, role: "fiscalizador" }),
    });
    expect(documentoService.enviarEmail).not.toHaveBeenCalled();
    expect(await resposta.json()).toEqual(resultado);
  });

  it("envia o e-mail pendente e responde com o resultado", async () => {
    documentoService.finalizar.mockResolvedValue({
      situacao: "finalizado", documento_id: 7, pendentes: [], pdf_gerado: false, enviado_email: false, email_pendente: true,
    });
    documentoService.enviarEmail.mockResolvedValue("enviado");

    const resposta = await requisitar("/documentos/7/finalizar");
    const corpo = await resposta.json();

    expect(documentoService.enviarEmail).toHaveBeenCalledWith(7);
    expect(corpo.enviado_email).toBe(true);
    expect(corpo.envio_email).toBeUndefined();
  });

  it("informa envio em andamento sem marcar como enviado", async () => {
    documentoService.finalizar.mockResolvedValue({
      situacao: "finalizado", documento_id: 7, pendentes: [], pdf_gerado: false, enviado_email: false, email_pendente: true,
    });
    documentoService.enviarEmail.mockResolvedValue("em_andamento");

    const corpo = await (await requisitar("/documentos/7/finalizar")).json();

    expect(corpo.enviado_email).toBe(false);
    expect(corpo.envio_email).toBe("em_andamento");
  });

  it("devolve o assinatura_id quando a assinatura precisa ser coletada de novo", async () => {
    documentoService.finalizar.mockRejectedValue(
      Object.assign(new Error("A assinatura do responsável Carlos não foi encontrada ou está ilegível."), {
        name: "ValidacaoError",
        assinatura_id: 2,
      })
    );

    const resposta = await requisitar("/documentos/7/finalizar");

    expect(resposta.status).toBe(400);
    expect(await resposta.json()).toEqual({
      mensagem: "Erro ao finalizar documento",
      erros: ["A assinatura do responsável Carlos não foi encontrada ou está ilegível."],
      assinatura_id: 2,
    });
  });

  it("responde 404 quando não há acesso ou o documento não existe", async () => {
    documentoService.finalizar.mockResolvedValue(null);

    expect((await requisitar("/documentos/7/finalizar")).status).toBe(404);
  });

  it("responde 403 para gestor", async () => {
    expect((await requisitar("/documentos/7/finalizar", "gestor", 1)).status).toBe(403);
    expect(documentoService.finalizar).not.toHaveBeenCalled();
  });

  it("responde 503 quando o Storage falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    documentoService.finalizar.mockRejectedValue(
      Object.assign(new Error("x"), { name: "StorageError", codigo: "STORAGE_UPLOAD_FALHOU" })
    );

    expect((await requisitar("/documentos/7/finalizar")).status).toBe(503);
    consoleError.mockRestore();
  });
});

describe("DELETE /documentos/:id/assinaturas/:assinaturaId", () => {
  it("remove a assinatura e responde 204", async () => {
    assinaturaService.remover.mockResolvedValue(true);

    const resposta = await requisitar("/documentos/7/assinaturas/3", "fiscalizador", 5, undefined, "DELETE");

    expect(resposta.status).toBe(204);
    expect(assinaturaService.remover).toHaveBeenCalledWith(
      7,
      3,
      expect.objectContaining({ id: 5, role: "fiscalizador" })
    );
  });

  it("responde 404 quando a assinatura não existe ou não é acessível", async () => {
    assinaturaService.remover.mockResolvedValue(null);

    const resposta = await requisitar("/documentos/7/assinaturas/3", "fiscalizador", 5, undefined, "DELETE");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Assinatura não encontrada" });
  });

  it.each(["abc", "0"])("responde 400 para id de assinatura inválido (%s)", async (id) => {
    const resposta = await requisitar(`/documentos/7/assinaturas/${id}`, "fiscalizador", 5, undefined, "DELETE");

    expect(resposta.status).toBe(400);
    expect(assinaturaService.remover).not.toHaveBeenCalled();
  });

  it("responde 400 quando o PDF já foi gerado", async () => {
    assinaturaService.remover.mockRejectedValue(
      Object.assign(new Error("O PDF do documento já foi gerado; a assinatura não pode ser removida"), {
        name: "ValidacaoError",
      })
    );

    const resposta = await requisitar("/documentos/7/assinaturas/3", "fiscalizador", 5, undefined, "DELETE");

    expect(resposta.status).toBe(400);
  });

  it("responde 403 para gestor", async () => {
    const resposta = await requisitar("/documentos/7/assinaturas/3", "gestor", 1, undefined, "DELETE");

    expect(resposta.status).toBe(403);
  });
});

describe("POST /documentos/:id/assinaturas", () => {
  it("registra a assinatura em nome do usuário do token", async () => {
    assinaturaService.registrar.mockResolvedValue({ id: 1, documento_id: 7 });
    documentoService.finalizar.mockResolvedValue({ situacao: "pendente", documento_id: 7, pendentes: ["x"] });

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(201);
    expect(assinaturaService.registrar).toHaveBeenCalledWith(
      "7",
      corpo,
      expect.objectContaining({ id: 5, role: "fiscalizador" })
    );
    expect(documentoService.finalizar).toHaveBeenCalledWith(7);
    expect(await resposta.json()).toEqual({
      id: 1,
      documento_id: 7,
      finalizacao: { situacao: "pendente", documento_id: 7, pendentes: ["x"] },
    });
  });

  it("mantém o 201 quando a finalização falha depois de salvar a assinatura", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    assinaturaService.registrar.mockResolvedValue({ id: 1, documento_id: 7 });
    documentoService.finalizar.mockRejectedValue(new Error("Storage fora"));

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(201);
    expect((await resposta.json()).finalizacao).toEqual({
      situacao: "erro",
      documento_id: 7,
      mensagem: "Não foi possível gerar o PDF. Tente finalizar novamente.",
    });
    expect(consoleError).toHaveBeenCalledWith("Falha ao finalizar o documento:", 7, "Error", "Storage fora");
    consoleError.mockRestore();
  });

  it("informa qual assinatura não pôde ser lida", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    assinaturaService.registrar.mockResolvedValue({ id: 1, documento_id: 7 });
    documentoService.finalizar.mockRejectedValue(
      Object.assign(new Error("Não foi possível ler a assinatura do fiscalizador Ana."), {
        name: "ValidacaoError",
        assinatura_id: 3,
      })
    );

    const finalizacao = (await (await requisitar("/documentos/7/assinaturas")).json()).finalizacao;

    expect(finalizacao).toEqual({
      situacao: "erro",
      documento_id: 7,
      mensagem: "Não foi possível ler a assinatura do fiscalizador Ana.",
      assinatura_id: 3,
    });
  });

  it("responde com o PDF gerado e deixa o e-mail para depois da resposta", async () => {
    assinaturaService.registrar.mockResolvedValue({ id: 1, documento_id: 7 });
    documentoService.finalizar.mockResolvedValue({
      situacao: "finalizado",
      documento_id: 7,
      pendentes: [],
      pdf_gerado: true,
      enviado_email: false,
      email_pendente: true,
    });
    documentoService.enviarEmail.mockResolvedValue(true);

    const resposta = await requisitar("/documentos/7/assinaturas");

    expect(resposta.status).toBe(201);
    expect((await resposta.json()).finalizacao).toEqual({
      situacao: "finalizado",
      documento_id: 7,
      pendentes: [],
      pdf_gerado: true,
      enviado_email: false,
      envio_email: "em_andamento",
    });
    expect(documentoService.enviarEmail).toHaveBeenCalledWith(7);
    expect(waitUntil).toHaveBeenCalledWith(expect.any(Promise));
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
      mensagem: "Este fiscalizador já assinou o documento",
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
    expect(await resposta.json()).toEqual({ mensagem: "Erro interno do servidor" });
    consoleError.mockRestore();
  });
});

describe("GET /documentos/:id/pdf", () => {
  const abrirPdf = (caminho, role = "gestor", id = 2) =>
    fetch(`${urlBase}${caminho}`, {
      headers: { Authorization: `Bearer ${jwt.sign({ id, role }, SEGREDO)}` },
    });

  it.each(["admin", "gestor"])("devolve o link temporário para %s", async (role) => {
    documentoService.gerarLinkPdf.mockResolvedValue({
      gerado: true,
      url: "https://exemplo.supabase.co/storage/v1/object/sign/documentos/a.pdf?token=x",
      expira_em: "2026-11-26T15:05:00.000Z",
    });

    const resposta = await abrirPdf("/documentos/7/pdf", role, 2);

    expect(resposta.status).toBe(200);
    expect(await resposta.json()).toEqual({
      url: "https://exemplo.supabase.co/storage/v1/object/sign/documentos/a.pdf?token=x",
      expira_em: "2026-11-26T15:05:00.000Z",
    });
    expect(documentoService.gerarLinkPdf).toHaveBeenCalledWith("7");
  });

  it("responde 403 para o fiscalizador, sem gerar link", async () => {
    const resposta = await abrirPdf("/documentos/7/pdf", "fiscalizador", 5);

    expect(resposta.status).toBe(403);
    expect(documentoService.gerarLinkPdf).not.toHaveBeenCalled();
  });

  it("responde 404 quando o documento não existe", async () => {
    documentoService.gerarLinkPdf.mockResolvedValue(null);

    const resposta = await abrirPdf("/documentos/7/pdf");

    expect(resposta.status).toBe(404);
    expect(await resposta.json()).toEqual({ mensagem: "Documento não encontrado" });
  });

  it("responde 409 quando o PDF ainda não foi gerado", async () => {
    documentoService.gerarLinkPdf.mockResolvedValue({ gerado: false });

    const resposta = await abrirPdf("/documentos/7/pdf");

    expect(resposta.status).toBe(409);
    expect(await resposta.json()).toEqual({ mensagem: "O PDF deste documento ainda não foi gerado" });
  });

  it("responde 503 quando o armazenamento está indisponível", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    documentoService.gerarLinkPdf.mockRejectedValue(
      Object.assign(new Error("x"), { name: "StorageError", codigo: "STORAGE_URL_ASSINADA_FALHOU" })
    );

    const resposta = await abrirPdf("/documentos/7/pdf");

    expect(resposta.status).toBe(503);
    consoleError.mockRestore();
  });

  it("responde 400 para id inválido e 401 sem token", async () => {
    expect((await abrirPdf("/documentos/abc/pdf")).status).toBe(400);
    expect((await fetch(`${urlBase}/documentos/7/pdf`)).status).toBe(401);
    expect(documentoService.gerarLinkPdf).not.toHaveBeenCalled();
  });
});
