import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";
import pdfService from "../services/pdfService.js";

const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const contarFolhas = (pdf) => pdf.toString("latin1").match(/\/Type \/Page\b/g).length;

const dadosBase = () => ({
  numero: 3301,
  estabelecimento: {
    razao_social: "Mercado Bom Preço LTDA",
    bairro: "Piedade",
    cnpj_cpf: "12.345.678/0001-90",
  },
  dataRealizacao: "2026-11-20T13:12:00Z",
  itens: [
    { pergunta: "Os preços estão afixados?", resposta: "Não" },
    { pergunta: "Quantos produtos vencidos?", resposta: "  " },
  ],
  observacoes: "Notificado para regularizar em 48 horas.",
  fiscalizadores: [
    { nome: "Ana Paula Ferreira", matricula: "10234", assinatura: Buffer.from(PNG_1X1, "base64") },
    { nome: "João Victor Lima", matricula: "10567", assinatura: `data:image/png;base64,${PNG_1X1}` },
  ],
  recebimento: {
    nome: "Carlos Alberto da Silva",
    data: "2026-11-20T13:40:00Z",
    assinatura: PNG_1X1,
  },
});

describe("gerar PDF em memória", () => {
  it("devolve o PDF como Buffer", async () => {
    const pdf = await pdfService.gerarPdf((doc) => doc.text("Olá"));

    expect(Buffer.isBuffer(pdf)).toBe(true);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("rejeita quando o desenho falha", async () => {
    await expect(
      pdfService.gerarPdf(() => {
        throw new Error("falha no desenho");
      })
    ).rejects.toThrow("falha no desenho");
  });
});

describe("documento da visita no modelo do PROCON", () => {
  let textos;
  let imagem;

  beforeEach(() => {
    const textoOriginal = PDFDocument.prototype.text;
    textos = [];
    vi.spyOn(PDFDocument.prototype, "text").mockImplementation(function (conteudo, ...resto) {
      textos.push(String(conteudo));
      return textoOriginal.call(this, conteudo, ...resto);
    });
    imagem = vi.spyOn(PDFDocument.prototype, "image");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("gera um PDF de uma folha com cabeçalho, número e dados do estabelecimento", async () => {
    const pdf = await pdfService.gerarDocumentoVisita(dadosBase());

    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(contarFolhas(pdf)).toBe(1);
    expect(textos).toEqual(
      expect.arrayContaining([
        "DIRETORIA DE PROTEÇÃO E DEFESA DO CONSUMIDOR",
        "PROCON DO JABOATÃO DOS GUARARAPES",
        "RELATÓRIO DE VISITA",
        "Cont. Nº",
        "3301",
        "Mercado Bom Preço LTDA",
        "Piedade",
        "12.345.678/0001-90",
        "Jaboatão dos Guararapes/PE",
        "Complexo Administrativo",
      ])
    );
  });

  it("preenche a cominação legal com a data da visita no horário de Recife", async () => {
    await pdfService.gerarDocumentoVisita(dadosBase());

    expect(textos).toEqual(expect.arrayContaining(["10:12", "20", "novembro", "2026"]));
  });

  it("deixa os espaços da data em branco quando a visita não tem data de realização", async () => {
    await pdfService.gerarDocumentoVisita({ ...dadosBase(), dataRealizacao: null });

    expect(textos).toEqual(expect.arrayContaining(["____:____", "_________________"]));
  });

  it("lista as perguntas numeradas com as respostas e as observações", async () => {
    await pdfService.gerarDocumentoVisita(dadosBase());

    expect(textos).toEqual(
      expect.arrayContaining([
        "1. Os preços estão afixados? Resposta: Não",
        "2. Quantos produtos vencidos? Resposta: Sem resposta",
        "Observações: Notificado para regularizar em 48 horas.",
      ])
    );
  });

  it("assina cada fiscalizador com nome e matrícula e o responsável com a data de recebimento", async () => {
    await pdfService.gerarDocumentoVisita(dadosBase());

    expect(imagem).toHaveBeenCalledTimes(3);
    for (const [arquivo] of imagem.mock.calls) expect(Buffer.isBuffer(arquivo)).toBe(true);
    expect(textos).toEqual(
      expect.arrayContaining([
        "Ana Paula Ferreira",
        "Matrícula: 10234",
        "João Victor Lima",
        "Matrícula: 10567",
        "Carlos Alberto da Silva",
        "Recebido em: 20 / 11 / 2026",
      ])
    );
  });

  it("registra a recusa do responsável sem imagem de assinatura", async () => {
    const dados = dadosBase();
    dados.recebimento = { nome: "Carlos Alberto da Silva", recusou: true };

    await pdfService.gerarDocumentoVisita(dados);

    expect(imagem).toHaveBeenCalledTimes(2);
    expect(textos).toEqual(
      expect.arrayContaining(["Recusou-se a assinar", "Recebido em: _____/_____/______"])
    );
  });

  it("mantém o espaço do fiscalizador quando nenhum foi informado", async () => {
    await pdfService.gerarDocumentoVisita({ ...dadosBase(), fiscalizadores: [] });

    expect(textos).toEqual(
      expect.arrayContaining(["Matrícula: ________", "Agente fiscalizador / Matrícula"])
    );
  });

  it("cria folhas de continuação quando as linhas não cabem na primeira folha", async () => {
    const itens = Array.from({ length: 70 }, (_, indice) => ({
      pergunta: `Pergunta ${indice + 1}?`,
      resposta: "Sim",
    }));

    const pdf = await pdfService.gerarDocumentoVisita({ ...dadosBase(), itens });

    expect(contarFolhas(pdf)).toBe(3);
    expect(textos).toEqual(
      expect.arrayContaining([
        "FOLHA DE CONTINUAÇÃO",
        "Cont. Nº 3301  |  Folha 2 de 3",
        "Cont. Nº 3301  |  Folha 3 de 3",
        "18. Pergunta 18? Resposta: Sim",
        "19. Pergunta 19? Resposta: Sim",
        "70. Pergunta 70? Resposta: Sim",
      ])
    );
  });

  it("quebra textos longos em várias linhas sem perder conteúdo", async () => {
    const palavra = "A".repeat(400);
    const itens = [{ pergunta: "Descreva:", resposta: palavra }];

    await pdfService.gerarDocumentoVisita({ ...dadosBase(), itens, observacoes: "" });

    const pedacos = textos.filter((linha) => /^A+$/.test(linha));
    expect(textos).toContain("1. Descreva: Resposta:");
    expect(pedacos.length).toBeGreaterThan(1);
    expect(pedacos.join("")).toBe(palavra);
  });

  it("encurta valores que não cabem no campo", async () => {
    const dados = dadosBase();
    dados.estabelecimento.bairro = "Bairro com um nome muito comprido demais para o campo";

    await pdfService.gerarDocumentoVisita(dados);

    const bairro = textos.find((linha) => linha.startsWith("Bairro com"));
    expect(bairro).toMatch(/\.\.\.$/);
    expect(bairro.length).toBeLessThan(dados.estabelecimento.bairro.length);
  });

  it("rejeita tipo de documento desconhecido", async () => {
    await expect(
      pdfService.gerarDocumentoVisita({ ...dadosBase(), tipo: "multa" })
    ).rejects.toThrow("Tipo de documento inválido: multa");
  });
});
