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
      Documento: { findByPk: vi.fn(), update: vi.fn() },
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

const fiscais = [{ id: 5, nome: "Ana", matricula: "123" }];
const assinaturaFiscal = {
  id: 1,
  usuario_id: 5,
  assinante_tipo: "fiscalizador",
  assinante_nome: "Ana",
  imagem_assinatura_url: "visitas/10/assinaturas/5.png",
};
const responsavel = {
  id: 2,
  usuario_id: null,
  assinante_tipo: "denunciado",
  assinante_nome: "Carlos",
  assinante_documento: "111",
  assinante_email: "carlos@loja.com",
  recusou: false,
  imagem_assinatura_url: "visitas/10/assinaturas/r.png",
  data_assinatura: "2026-11-22T12:00:00Z",
};

let documento;
let travado;
let visita;

const novoDocumento = (dados = {}) => ({
  id: 7,
  visita_id: 10,
  url_arquivo_pdf: null,
  enviado_email: false,
  update: vi.fn(),
  ...dados,
});

beforeEach(() => {
  vi.clearAllMocks();
  delete transacao.finished;
  transacao.rollback.mockReset();
  transacao.commit.mockReset();
  documento = novoDocumento();
  travado = novoDocumento();
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
  Documento.findByPk.mockReset().mockResolvedValueOnce(documento).mockResolvedValue(travado);
  Documento.update.mockReset().mockResolvedValue([1]);
  Visita.findByPk.mockReset().mockResolvedValue(visita);
  Visita.update.mockReset().mockResolvedValue([1]);
  Assinatura.findAll.mockReset().mockResolvedValue([assinaturaFiscal, responsavel]);
  RespostaQuestionario.findAll.mockResolvedValue([
    { resposta: "Sim", pergunta: { texto: "Preços afixados?" } },
  ]);
  baixarArquivo.mockReset().mockResolvedValue(png);
  uploadArquivo.mockReset().mockResolvedValue(arquivoPdf);
  removerArquivo.mockReset().mockResolvedValue();
  enviarDocumentoVisita.mockReset().mockResolvedValue({ redirecionado: false });
});

describe("finalizar documento", () => {
  it("gera o PDF sem travas e grava numa transação curta", async () => {
    const resultado = await documentoService.finalizar(7);

    expect(Documento.findByPk).toHaveBeenNthCalledWith(1, 7);
    expect(Documento.findByPk).toHaveBeenNthCalledWith(2, 7, { transaction: transacao, lock: "UPDATE" });
    expect(uploadArquivo.mock.invocationCallOrder[0]).toBeLessThan(
      sequelize.transaction.mock.invocationCallOrder[0]
    );
    expect(uploadArquivo.mock.calls[0][0].conteudo.subarray(0, 5).toString()).toBe("%PDF-");
    expect(Visita.update).toHaveBeenCalledWith(
      { status: "concluida" },
      { where: { id: 10, status: "em_andamento" }, transaction: transacao }
    );
    expect(travado.update).toHaveBeenCalledWith(
      expect.objectContaining({ url_arquivo_pdf: arquivoPdf.path }),
      { transaction: transacao }
    );
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(enviarDocumentoVisita).not.toHaveBeenCalled();
    expect(resultado).toEqual({
      situacao: "finalizado",
      documento_id: 7,
      pendentes: [],
      pdf_gerado: true,
      enviado_email: false,
      email_pendente: true,
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

  it("lista o que falta sem gerar PDF nem abrir transação", async () => {
    Assinatura.findAll.mockResolvedValue([assinaturaFiscal]);

    expect(await documentoService.finalizar(7)).toEqual({
      situacao: "pendente",
      documento_id: 7,
      pendentes: ["Assinatura ou recusa do responsável"],
    });
    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("não finaliza visita sem fiscalizadores", async () => {
    visita.getFiscalizadores.mockResolvedValue([]);
    Assinatura.findAll.mockResolvedValue([responsavel]);

    expect((await documentoService.finalizar(7)).pendentes).toEqual([
      "Nenhum fiscalizador vinculado à visita",
    ]);
  });

  it("aceita a recusa do responsável sem baixar imagem dele", async () => {
    Assinatura.findAll.mockResolvedValue([
      assinaturaFiscal,
      { ...responsavel, recusou: true, imagem_assinatura_url: null, assinante_email: null },
    ]);

    const resultado = await documentoService.finalizar(7);

    expect(baixarArquivo).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ situacao: "finalizado", email_pendente: false });
  });

  it("não gera de novo quando o PDF já existe", async () => {
    Documento.findByPk.mockReset().mockResolvedValue(novoDocumento({ url_arquivo_pdf: arquivoPdf.path }));

    const resultado = await documentoService.finalizar(7);

    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(resultado).toMatchObject({ situacao: "finalizado", pdf_gerado: false, email_pendente: true });
  });

  it("apaga o próprio PDF quando outro pedido gravou primeiro", async () => {
    travado.url_arquivo_pdf = "visitas/10/documentos/outro.pdf";

    const resultado = await documentoService.finalizar(7);

    expect(removerArquivo).toHaveBeenCalledWith(arquivoPdf);
    expect(Visita.update).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(resultado.pdf_gerado).toBe(false);
  });

  it("não grava se as assinaturas mudaram durante a geração", async () => {
    Assinatura.findAll
      .mockResolvedValueOnce([assinaturaFiscal, responsavel])
      .mockResolvedValueOnce([{ id: 1 }]);

    await expect(documentoService.finalizar(7)).rejects.toThrow("As assinaturas mudaram");
    expect(removerArquivo).toHaveBeenCalledWith(arquivoPdf);
    expect(travado.update).not.toHaveBeenCalled();
  });

  it("não grava se a visita deixou de estar em andamento", async () => {
    Visita.update.mockResolvedValue([0]);

    await expect(documentoService.finalizar(7)).rejects.toThrow(
      "Só é possível finalizar documentos de visitas em andamento"
    );
    expect(removerArquivo).toHaveBeenCalledWith(arquivoPdf);
    expect(travado.update).not.toHaveBeenCalled();
  });

  it("aponta a assinatura ilegível sem enviar PDF", async () => {
    baixarArquivo.mockResolvedValue(Buffer.from("nao-e-png"));

    const erro = await documentoService.finalizar(7).catch((e) => e);

    expect(erro).toMatchObject({ name: "ValidacaoError", assinatura_id: 1 });
    expect(erro.message).toContain("do fiscalizador Ana");
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it("trata arquivo de assinatura sumido como assinatura a coletar de novo", async () => {
    baixarArquivo.mockRejectedValue(
      Object.assign(new Error("x"), { name: "StorageError", codigo: "STORAGE_ARQUIVO_NAO_ENCONTRADO" })
    );

    await expect(documentoService.finalizar(7)).rejects.toMatchObject({
      name: "ValidacaoError",
      assinatura_id: 1,
      message: expect.stringContaining("Apague essa assinatura"),
    });
  });

  it("não culpa a assinatura por falha de rede no download", async () => {
    baixarArquivo.mockRejectedValue(
      Object.assign(new Error("x"), { name: "StorageError", codigo: "STORAGE_DOWNLOAD_FALHOU" })
    );

    const erro = await documentoService.finalizar(7).catch((falha) => falha);

    expect(erro).toMatchObject({ name: "StorageError", codigo: "STORAGE_DOWNLOAD_FALHOU" });
    expect(erro.assinatura_id).toBeUndefined();
  });

  it("repassa o Storage indisponível sem culpar a assinatura", async () => {
    baixarArquivo.mockRejectedValue(
      Object.assign(new Error("x"), { name: "StorageError", codigo: "STORAGE_BUCKET_INDISPONIVEL" })
    );

    await expect(documentoService.finalizar(7)).rejects.toMatchObject({ name: "StorageError" });
  });

  it("apaga o PDF e desfaz quando a gravação falha", async () => {
    travado.update.mockRejectedValue(new Error("falha no banco"));

    await expect(documentoService.finalizar(7)).rejects.toThrow("falha no banco");
    expect(removerArquivo).toHaveBeenCalledWith(arquivoPdf);
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("rejeita visita que não está em andamento e sem PDF", async () => {
    visita.status = "concluida";

    await expect(documentoService.finalizar(7)).rejects.toThrow(
      "Só é possível finalizar documentos de visitas em andamento"
    );
  });

  it("retorna null para fiscal sem acesso, sem gerar o PDF", async () => {
    expect(await documentoService.finalizar(7, { usuario: { id: 99, role: "fiscalizador" } })).toBeNull();
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it("finaliza para o fiscal da visita", async () => {
    const resultado = await documentoService.finalizar(7, { usuario: { id: 5, role: "fiscalizador" } });

    expect(resultado.situacao).toBe("finalizado");
  });

  it("retorna null quando o documento não existe", async () => {
    Documento.findByPk.mockReset().mockResolvedValue(null);

    expect(await documentoService.finalizar(99)).toBeNull();
  });
});

describe("enviar e-mail do documento", () => {
  const reserva = () => Documento.update.mock.calls[0];

  beforeEach(() => {
    Documento.findByPk.mockReset().mockResolvedValue(novoDocumento({ url_arquivo_pdf: arquivoPdf.path }));
    Documento.update.mockReset().mockResolvedValue([1]);
  });

  it("reserva o envio, envia ao responsável e só então marca como enviado", async () => {
    expect(await documentoService.enviarEmail(7)).toBe("enviado");

    const [dados, { where }] = reserva();
    expect(dados).toEqual({ email_enviando_em: expect.any(Date) });
    expect(where).toMatchObject({ id: 7, enviado_email: false });
    expect(baixarArquivo).toHaveBeenCalledWith(arquivoPdf);
    expect(enviarDocumentoVisita).toHaveBeenCalledWith(
      expect.objectContaining({ para: "carlos@loja.com", numero: 7, estabelecimento: "Bom Preço", pdf: png })
    );
    expect(Documento.update).toHaveBeenLastCalledWith(
      { enviado_email: true, email_enviando_em: null },
      { where: { id: 7 } }
    );
    expect(Documento.update).toHaveBeenCalledTimes(2);
  });

  it("aceita reserva vazia ou vencida há mais de 10 minutos", async () => {
    await documentoService.enviarEmail(7);

    const [{ email_enviando_em: reservadoEm }, { where }] = reserva();
    const condicoes = Object.getOwnPropertySymbols(where).map((simbolo) => where[simbolo])[0];
    const limite = Object.getOwnPropertySymbols(condicoes[1].email_enviando_em)
      .map((simbolo) => condicoes[1].email_enviando_em[simbolo])[0];

    expect(condicoes[0]).toEqual({ email_enviando_em: null });
    expect(reservadoEm.getTime() - limite.getTime()).toBe(10 * 60 * 1000);
  });

  it("responde em andamento se outro pedido está enviando", async () => {
    Documento.update.mockResolvedValue([0]);
    Documento.findByPk
      .mockResolvedValueOnce(novoDocumento({ url_arquivo_pdf: arquivoPdf.path }))
      .mockResolvedValueOnce(novoDocumento({ url_arquivo_pdf: arquivoPdf.path, email_enviando_em: new Date() }));

    expect(await documentoService.enviarEmail(7)).toBe("em_andamento");
    expect(enviarDocumentoVisita).not.toHaveBeenCalled();
  });

  it("responde enviado se outro pedido concluiu o envio", async () => {
    Documento.update.mockResolvedValue([0]);
    Documento.findByPk
      .mockResolvedValueOnce(novoDocumento({ url_arquivo_pdf: arquivoPdf.path }))
      .mockResolvedValueOnce(novoDocumento({ url_arquivo_pdf: arquivoPdf.path, enviado_email: true }));

    expect(await documentoService.enviarEmail(7)).toBe("enviado");
    expect(enviarDocumentoVisita).not.toHaveBeenCalled();
  });

  it("não envia o que já foi enviado", async () => {
    Documento.findByPk.mockResolvedValue(novoDocumento({ url_arquivo_pdf: arquivoPdf.path, enviado_email: true }));

    expect(await documentoService.enviarEmail(7)).toBe("enviado");
    expect(Documento.update).not.toHaveBeenCalled();
  });

  it("não envia sem e-mail do responsável", async () => {
    Assinatura.findAll.mockResolvedValue([assinaturaFiscal, { ...responsavel, assinante_email: null }]);

    expect(await documentoService.enviarEmail(7)).toBe("nao_enviado");
    expect(Documento.update).not.toHaveBeenCalled();
  });

  it("não envia antes do PDF existir", async () => {
    Documento.findByPk.mockResolvedValue(novoDocumento());

    expect(await documentoService.enviarEmail(7)).toBe("nao_enviado");
  });

  it("libera só a própria reserva quando o envio falha e registra a causa", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    enviarDocumentoVisita.mockRejectedValue(
      Object.assign(new Error("Não foi possível enviar o e-mail."), { codigo: "EMAIL_ENVIO_FALHOU" })
    );

    expect(await documentoService.enviarEmail(7)).toBe("nao_enviado");

    const reservadoEm = reserva()[0].email_enviando_em;
    expect(Documento.update).toHaveBeenLastCalledWith(
      { email_enviando_em: null },
      { where: { id: 7, email_enviando_em: reservadoEm } }
    );
    expect(Documento.update).not.toHaveBeenCalledWith(expect.objectContaining({ enviado_email: true }), expect.anything());
    expect(consoleError).toHaveBeenCalledWith(
      "Falha ao enviar o documento por e-mail:",
      "EMAIL_ENVIO_FALHOU",
      "Não foi possível enviar o e-mail."
    );
    consoleError.mockRestore();
  });

  it("não marca como enviado o e-mail desviado para teste", async () => {
    enviarDocumentoVisita.mockResolvedValue({ redirecionado: true });

    expect(await documentoService.enviarEmail(7)).toBe("nao_enviado");
    expect(Documento.update).toHaveBeenLastCalledWith(
      { email_enviando_em: null },
      expect.objectContaining({ where: expect.objectContaining({ id: 7 }) })
    );
  });

  it("não quebra se liberar a reserva falhar; a reserva vence sozinha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    enviarDocumentoVisita.mockRejectedValue(new Error("smtp"));
    Documento.update.mockResolvedValueOnce([1]).mockRejectedValueOnce(new Error("banco fora"));

    expect(await documentoService.enviarEmail(7)).toBe("nao_enviado");
    expect(consoleError).toHaveBeenCalledWith("Falha ao liberar a reserva do e-mail:", 7, "banco fora");
    consoleError.mockRestore();
  });

  it("responde enviado e registra no log se gravar o envio falhar", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    Documento.update.mockResolvedValueOnce([1]).mockRejectedValueOnce(new Error("banco fora"));

    expect(await documentoService.enviarEmail(7)).toBe("enviado");
    expect(consoleError).toHaveBeenCalledWith(
      "E-mail enviado, mas não foi possível registrar o envio:",
      7,
      "banco fora"
    );
    consoleError.mockRestore();
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
