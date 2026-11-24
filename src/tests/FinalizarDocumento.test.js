import { beforeEach, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import models, { sequelize } from "../models/index.js";
import documentoService from "../services/documentoService.js";
import pdfService from "../services/pdfService.js";
import { enviarDocumentoVisita } from "../services/emailService.js";
import { baixarArquivo, removerArquivo, uploadArquivo } from "../services/storageService.js";

vi.mock("../models/index.js", () => {
  const transacao = { commit: vi.fn(), rollback: vi.fn(), LOCK: { UPDATE: "UPDATE" } };
  return {
    sequelize: { transaction: vi.fn(async () => transacao), transacao },
    default: {
      Assinatura: { findAll: vi.fn() },
      Documento: { findByPk: vi.fn() },
      PerguntaQuestionario: {},
      RespostaQuestionario: { findAll: vi.fn() },
      Visita: { findByPk: vi.fn(), update: vi.fn() },
    },
  };
});
vi.mock("../config/supabase.js", () => ({ getStorageContext: () => ({ bucket: "documentos" }) }));
vi.mock("../services/storageService.js", () => ({
  baixarArquivo: vi.fn(),
  removerArquivo: vi.fn(),
  uploadArquivo: vi.fn(),
}));
vi.mock("../services/emailService.js", () => ({ enviarDocumentoVisita: vi.fn() }));

const { Assinatura, Documento, RespostaQuestionario, Visita } = models;
const { transacao } = sequelize;

const imagem = new PNG({ width: 4, height: 2 });
imagem.data.fill(255);
const png = PNG.sync.write(imagem);
const arquivoPdf = { bucket: "documentos", path: "visitas/10/documentos/a.pdf" };

const fiscais = [
  { id: 5, nome: "Ana", matricula: "123" },
  { id: 6, nome: "Bruno", matricula: null },
];
const assinaturaFiscal = (id) => ({
  usuario_id: id,
  assinante_tipo: "fiscalizador",
  imagem_assinatura_url: `visitas/10/assinaturas/${id}.png`,
});
const responsavel = {
  usuario_id: null,
  assinante_tipo: "denunciado",
  assinante_nome: "Carlos",
  assinante_documento: "111",
  assinante_email: "carlos@loja.com",
  recusou: false,
  imagem_assinatura_url: "visitas/10/assinaturas/r.png",
  data_assinatura: "2026-11-22T12:00:00Z",
};
const completas = () => [assinaturaFiscal(5), assinaturaFiscal(6), responsavel];

let documento;
let visita;

beforeEach(() => {
  vi.clearAllMocks();
  delete transacao.finished;
  documento = { id: 7, visita_id: 10, url_arquivo_pdf: null, enviado_email: false, update: vi.fn() };
  visita = {
    id: 10,
    status: "em_andamento",
    denunciado: "Mercado",
    razao_social: "Mercado LTDA",
    nome_fantasia: "Bom Preço",
    data_realizacao: "2026-11-22T11:00:00Z",
    observacoes_livres: "Obs",
    getFiscalizadores: vi.fn().mockResolvedValue(fiscais),
  };
  Documento.findByPk.mockResolvedValue(documento);
  Visita.findByPk.mockResolvedValue(visita);
  Assinatura.findAll.mockResolvedValue(completas());
  RespostaQuestionario.findAll.mockResolvedValue([
    { resposta: "Sim", pergunta: { texto: "Preços afixados?" } },
  ]);
  baixarArquivo.mockResolvedValue(png);
  uploadArquivo.mockResolvedValue(arquivoPdf);
  removerArquivo.mockResolvedValue();
  enviarDocumentoVisita.mockResolvedValue({ redirecionado: false });
});

describe("finalizar documento", () => {
  it("gera o PDF, salva, conclui a visita e envia o e-mail", async () => {
    const resultado = await documentoService.finalizar(7);

    expect(Documento.findByPk).toHaveBeenCalledWith(7, { transaction: transacao, lock: "UPDATE" });
    expect(baixarArquivo).toHaveBeenCalledTimes(3);
    expect(uploadArquivo).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: "application/pdf", diretorio: "visitas/10/documentos" })
    );
    expect(uploadArquivo.mock.calls[0][0].conteudo.subarray(0, 5).toString()).toBe("%PDF-");
    expect(documento.update).toHaveBeenCalledWith(
      expect.objectContaining({ url_arquivo_pdf: arquivoPdf.path }),
      { transaction: transacao }
    );
    expect(Visita.update).toHaveBeenCalledWith(
      { status: "concluida" },
      { where: { id: 10 }, transaction: transacao }
    );
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(enviarDocumentoVisita).toHaveBeenCalledWith(
      expect.objectContaining({ para: "carlos@loja.com", numero: 7, estabelecimento: "Bom Preço" })
    );
    expect(documento.update).toHaveBeenCalledWith({ enviado_email: true });
    expect(resultado).toEqual({
      situacao: "finalizado",
      documento_id: 7,
      pendentes: [],
      pdf_gerado: true,
      enviado_email: true,
    });
  });

  it("monta o PDF como relatório com número, responsável e assinaturas exigidas", async () => {
    const gerar = vi.spyOn(pdfService, "gerarDocumentoVisita");

    await documentoService.finalizar(7);

    expect(gerar.mock.calls[0][0]).toMatchObject({
      numero: 7,
      tipo: "relatorio_visita",
      exigirAssinaturas: true,
      estabelecimento: { razao_social: "Mercado LTDA", responsavel: "Carlos", responsavel_documento: "111" },
      itens: [{ pergunta: "Preços afixados?", resposta: "Sim" }],
      recebimento: { nome: "Carlos", recusou: false },
    });
    gerar.mockRestore();
  });

  it("lista o que falta sem gerar PDF nem concluir", async () => {
    Assinatura.findAll.mockResolvedValue([assinaturaFiscal(5)]);

    expect(await documentoService.finalizar(7)).toEqual({
      situacao: "pendente",
      documento_id: 7,
      pendentes: ["Assinatura do fiscalizador Bruno", "Assinatura ou recusa do responsável"],
    });
    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(Visita.update).not.toHaveBeenCalled();
  });

  it("não finaliza visita sem fiscalizadores", async () => {
    visita.getFiscalizadores.mockResolvedValue([]);
    Assinatura.findAll.mockResolvedValue([responsavel]);

    const resultado = await documentoService.finalizar(7);

    expect(resultado.pendentes).toEqual(["Nenhum fiscalizador vinculado à visita"]);
  });

  it("aceita a recusa do responsável sem baixar imagem dele", async () => {
    Assinatura.findAll.mockResolvedValue([
      assinaturaFiscal(5),
      assinaturaFiscal(6),
      { ...responsavel, recusou: true, imagem_assinatura_url: null },
    ]);

    const resultado = await documentoService.finalizar(7);

    expect(baixarArquivo).toHaveBeenCalledTimes(2);
    expect(resultado.situacao).toBe("finalizado");
  });

  it("gera o PDF e não tenta enviar quando não há e-mail", async () => {
    Assinatura.findAll.mockResolvedValue([
      assinaturaFiscal(5),
      assinaturaFiscal(6),
      { ...responsavel, assinante_email: null },
    ]);

    const resultado = await documentoService.finalizar(7);

    expect(enviarDocumentoVisita).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ pdf_gerado: true, enviado_email: false });
  });

  it("mantém o PDF quando o e-mail falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    enviarDocumentoVisita.mockRejectedValue(
      Object.assign(new Error("x"), { codigo: "EMAIL_ENVIO_FALHOU" })
    );

    const resultado = await documentoService.finalizar(7);

    expect(resultado).toMatchObject({ situacao: "finalizado", enviado_email: false });
    expect(transacao.rollback).not.toHaveBeenCalled();
    expect(removerArquivo).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("não marca como enviado o e-mail desviado para teste", async () => {
    enviarDocumentoVisita.mockResolvedValue({ redirecionado: true });

    const resultado = await documentoService.finalizar(7);

    expect(documento.update).not.toHaveBeenCalledWith({ enviado_email: true });
    expect(resultado.enviado_email).toBe(false);
  });

  it("não gera nem envia de novo quando o PDF já existe", async () => {
    documento.url_arquivo_pdf = arquivoPdf.path;

    const resultado = await documentoService.finalizar(7);

    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(enviarDocumentoVisita).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ situacao: "finalizado", pdf_gerado: false, enviado_email: false });
  });

  it("reenvia o e-mail pendente baixando o PDF salvo", async () => {
    documento.url_arquivo_pdf = arquivoPdf.path;
    const pdf = Buffer.from("%PDF-salvo");
    baixarArquivo.mockResolvedValue(pdf);

    const resultado = await documentoService.finalizar(7, { reenviarEmail: true });

    expect(baixarArquivo).toHaveBeenCalledWith(arquivoPdf);
    expect(enviarDocumentoVisita).toHaveBeenCalledWith(expect.objectContaining({ pdf }));
    expect(resultado.enviado_email).toBe(true);
  });

  it("não reenvia e-mail que já foi entregue", async () => {
    Object.assign(documento, { url_arquivo_pdf: arquivoPdf.path, enviado_email: true });

    const resultado = await documentoService.finalizar(7, { reenviarEmail: true });

    expect(enviarDocumentoVisita).not.toHaveBeenCalled();
    expect(resultado.enviado_email).toBe(true);
  });

  it("não gera PDF se uma assinatura baixada estiver corrompida", async () => {
    baixarArquivo.mockResolvedValue(Buffer.from("nao-e-png"));

    await expect(documentoService.finalizar(7)).rejects.toMatchObject({ name: "ValidacaoError" });
    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(Visita.update).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("apaga o PDF enviado e não conclui quando a gravação falha", async () => {
    documento.update.mockRejectedValue(new Error("falha no banco"));

    await expect(documentoService.finalizar(7)).rejects.toThrow("falha no banco");
    expect(removerArquivo).toHaveBeenCalledWith(arquivoPdf);
    expect(Visita.update).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("rejeita visita que não está em andamento e sem PDF", async () => {
    visita.status = "concluida";

    await expect(documentoService.finalizar(7)).rejects.toThrow(
      "Só é possível finalizar documentos de visitas em andamento"
    );
  });

  it("retorna null para fiscal sem acesso, sem gerar o PDF", async () => {
    const resultado = await documentoService.finalizar(7, { usuario: { id: 99, role: "fiscalizador" } });

    expect(resultado).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it("finaliza para o fiscal da visita", async () => {
    const resultado = await documentoService.finalizar(7, { usuario: { id: 5, role: "fiscalizador" } });

    expect(resultado.situacao).toBe("finalizado");
  });

  it("retorna null quando o documento não existe", async () => {
    Documento.findByPk.mockResolvedValue(null);

    expect(await documentoService.finalizar(99)).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });
});

describe("PDF com assinaturas exigidas", () => {
  const dados = (assinatura) => ({
    numero: 7,
    fiscalizadores: [{ nome: "Ana", assinatura }],
    recebimento: { nome: "Carlos", recusou: true },
    exigirAssinaturas: true,
  });

  it.each([[null], [Buffer.from("nao-e-imagem")]])("recusa assinatura ausente ou ilegível", async (assinatura) => {
    await expect(pdfService.gerarDocumentoVisita(dados(assinatura))).rejects.toThrow();
  });

  it("gera com assinatura válida", async () => {
    const pdf = await pdfService.gerarDocumentoVisita(dados(png));

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("aceita PNG entrelaçado no documento final", async () => {
    const entrelacado = PNG.sync.write(imagem, { interlace: true });

    await expect(pdfService.gerarDocumentoVisita(dados(entrelacado))).resolves.toBeDefined();
  });
});
