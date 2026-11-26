import { beforeEach, describe, expect, it, vi } from "vitest";
import models from "../models/index.js";
import documentoService from "../services/documentoService.js";
import { gerarUrlAssinada } from "../services/storageService.js";

vi.mock("../models/index.js", () => ({
  sequelize: { transaction: vi.fn() },
  default: {
    Assinatura: {},
    Documento: { findByPk: vi.fn() },
    PerguntaQuestionario: {},
    RespostaQuestionario: {},
    Visita: {},
  },
}));
vi.mock("../config/supabase.js", () => ({ getStorageContext: () => ({ bucket: "documentos" }) }));
vi.mock("../services/storageService.js", () => ({
  baixarArquivo: vi.fn(),
  gerarUrlAssinada: vi.fn(),
  removerArquivo: vi.fn(),
  uploadArquivo: vi.fn(),
}));
vi.mock("../services/emailService.js", () => ({ enviarDocumentoVisita: vi.fn() }));

const { Documento } = models;

beforeEach(() => {
  vi.clearAllMocks();
  Documento.findByPk.mockResolvedValue({ id: 7, url_arquivo_pdf: "visitas/10/documentos/a.pdf" });
  gerarUrlAssinada.mockResolvedValue("https://exemplo.supabase.co/assinado");
});

describe("link temporário do PDF", () => {
  it("gera um link de 5 minutos para o PDF do documento", async () => {
    const antes = Date.now();

    const resultado = await documentoService.gerarLinkPdf("7");

    expect(Documento.findByPk).toHaveBeenCalledWith("7", { attributes: ["id", "url_arquivo_pdf"] });
    expect(gerarUrlAssinada).toHaveBeenCalledWith(
      { bucket: "documentos", path: "visitas/10/documentos/a.pdf" },
      300
    );
    expect(resultado).toMatchObject({ gerado: true, url: "https://exemplo.supabase.co/assinado" });
    const expira = new Date(resultado.expira_em).getTime();
    expect(expira).toBeGreaterThanOrEqual(antes + 300000);
    expect(expira).toBeLessThanOrEqual(Date.now() + 300000);
  });

  it("devolve null quando o documento não existe, sem gerar link", async () => {
    Documento.findByPk.mockResolvedValue(null);

    expect(await documentoService.gerarLinkPdf("7")).toBeNull();
    expect(gerarUrlAssinada).not.toHaveBeenCalled();
  });

  it("avisa quando o PDF ainda não foi gerado, sem chamar o Storage", async () => {
    Documento.findByPk.mockResolvedValue({ id: 7, url_arquivo_pdf: null });

    expect(await documentoService.gerarLinkPdf("7")).toEqual({ gerado: false });
    expect(gerarUrlAssinada).not.toHaveBeenCalled();
  });

  it("repassa a falha do Storage", async () => {
    gerarUrlAssinada.mockRejectedValue(Object.assign(new Error("x"), { name: "StorageError" }));

    await expect(documentoService.gerarLinkPdf("7")).rejects.toMatchObject({
      name: "StorageError",
    });
  });
});
