import { beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import { PNG } from "pngjs";
import models, { sequelize } from "../models/index.js";
import assinaturaService from "../services/assinaturaService.js";
import { removerArquivo, uploadArquivo } from "../services/storageService.js";
import getAssinaturaModel from "../models/assinatura.js";

vi.mock("../models/index.js", () => {
  const transacao = { commit: vi.fn(), rollback: vi.fn(), LOCK: { UPDATE: "UPDATE" } };

  return {
    sequelize: {
      transaction: vi.fn(async () => transacao),
      transacao,
    },
    default: {
      Assinatura: { create: vi.fn(), findOne: vi.fn() },
      Documento: { findByPk: vi.fn() },
      Usuario: {},
      Visita: { findByPk: vi.fn() },
    },
  };
});

vi.mock("../services/storageService.js", () => ({
  uploadArquivo: vi.fn(),
  removerArquivo: vi.fn(),
}));

const { Assinatura, Documento, Visita } = models;
const { transacao } = sequelize;

const gerarPng = () => {
  const imagem = new PNG({ width: 4, height: 2 });
  imagem.data.fill(255);
  return PNG.sync.write(imagem);
};
const png = gerarPng();
const imagem = `data:image/png;base64,${png.toString("base64")}`;

const documentoAberto = { id: 7, visita_id: 10, url_arquivo_pdf: null };
const visitaEmAndamento = {
  id: 10,
  status: "em_andamento",
  fiscalizadores: [
    { id: 5, nome: "Ana Fiscal" },
    { id: 6, nome: "Bruno Fiscal" },
  ],
};
const arquivo = { bucket: "documentos", path: "visitas/10/assinaturas/uuid.png" };

const assinaturaFiscal = { assinante_tipo: "fiscalizador", usuario_id: 6, imagem };
const assinaturaResponsavel = {
  assinante_tipo: "denunciado",
  assinante_nome: "  Carlos Responsável  ",
  assinante_documento: "123.456.789-00",
  assinante_email: "carlos@loja.com",
  imagem,
};

beforeEach(() => {
  vi.clearAllMocks();
  delete transacao.finished;
  Documento.findByPk.mockResolvedValue(documentoAberto);
  Visita.findByPk.mockResolvedValue(visitaEmAndamento);
  Assinatura.findOne.mockResolvedValue(null);
  Assinatura.create.mockImplementation(async (dados) => ({ id: 1, ...dados }));
  uploadArquivo.mockResolvedValue(arquivo);
  removerArquivo.mockResolvedValue();
});

describe("registrar assinatura do fiscalizador", () => {
  it("trava o documento, sobe a imagem e grava com o nome do cadastro", async () => {
    const resultado = await assinaturaService.registrar(7, assinaturaFiscal);

    expect(Documento.findByPk).toHaveBeenCalledWith(7, {
      transaction: transacao,
      lock: transacao.LOCK.UPDATE,
    });
    expect(Assinatura.findOne).toHaveBeenCalledWith({
      attributes: ["id"],
      where: { documento_id: 7, usuario_id: 6 },
      transaction: transacao,
    });
    expect(uploadArquivo).toHaveBeenCalledWith({
      conteudo: png,
      contentType: "image/png",
      diretorio: "visitas/10/assinaturas",
    });
    expect(Assinatura.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documento_id: 7,
        usuario_id: 6,
        assinante_nome: "Bruno Fiscal",
        assinante_tipo: "fiscalizador",
        recusou: false,
        imagem_assinatura_url: arquivo.path,
      }),
      { transaction: transacao }
    );
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ id: 1, usuario_id: 6 });
  });

  it("aceita a imagem em base64 puro, sem o prefixo data URL", async () => {
    await assinaturaService.registrar(7, { ...assinaturaFiscal, imagem: png.toString("base64") });

    expect(uploadArquivo).toHaveBeenCalledWith(expect.objectContaining({ conteudo: png }));
  });

  it("rejeita fiscalizador que não faz parte da visita, sem subir imagem", async () => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaFiscal, usuario_id: 9 })
    ).rejects.toThrow("O fiscalizador informado não faz parte da visita");
    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("rejeita segunda assinatura do mesmo fiscalizador", async () => {
    Assinatura.findOne.mockResolvedValue({ id: 3 });

    await expect(assinaturaService.registrar(7, assinaturaFiscal)).rejects.toThrow(
      "Este fiscalizador já assinou o documento"
    );
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it.each([undefined, "6", 0, 1.5])("rejeita usuario_id inválido (%s) sem abrir transação", async (usuarioId) => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaFiscal, usuario_id: usuarioId })
    ).rejects.toThrow("Informe o fiscalizador que está assinando");
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("não deixa o fiscalizador recusar", async () => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaFiscal, recusou: true })
    ).rejects.toThrow("Somente o responsável pelo estabelecimento pode recusar");
  });
});

describe("registrar assinatura do responsável", () => {
  it("grava nome, documento e e-mail informados com a imagem", async () => {
    await assinaturaService.registrar(7, assinaturaResponsavel);

    expect(Assinatura.findOne).toHaveBeenCalledWith(
      expect.objectContaining({ where: { documento_id: 7, assinante_tipo: "denunciado" } })
    );
    expect(Assinatura.create).toHaveBeenCalledWith(
      expect.objectContaining({
        usuario_id: null,
        assinante_nome: "Carlos Responsável",
        assinante_documento: "123.456.789-00",
        assinante_email: "carlos@loja.com",
        assinante_tipo: "denunciado",
        recusou: false,
        imagem_assinatura_url: arquivo.path,
      }),
      { transaction: transacao }
    );
  });

  it("registra a recusa sem imagem e sem acessar o Storage", async () => {
    const { imagem: _, ...semImagem } = assinaturaResponsavel;

    await assinaturaService.registrar(7, { ...semImagem, recusou: true });

    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(Assinatura.create).toHaveBeenCalledWith(
      expect.objectContaining({ recusou: true, imagem_assinatura_url: null }),
      { transaction: transacao }
    );
  });

  it("aceita responsável sem documento e sem e-mail", async () => {
    await assinaturaService.registrar(7, {
      assinante_tipo: "denunciado",
      assinante_nome: "Carlos",
      imagem,
    });

    expect(Assinatura.create).toHaveBeenCalledWith(
      expect.objectContaining({ assinante_documento: null, assinante_email: null }),
      { transaction: transacao }
    );
  });

  it("rejeita segunda assinatura ou recusa do responsável", async () => {
    Assinatura.findOne.mockResolvedValue({ id: 3 });

    await expect(assinaturaService.registrar(7, assinaturaResponsavel)).rejects.toThrow(
      "O responsável já assinou ou recusou o documento"
    );
  });

  it.each([
    [{ assinante_nome: "  " }, "Informe o nome do responsável pelo estabelecimento"],
    [{ assinante_email: "sem-arroba" }, "Informe um e-mail válido para o responsável"],
    [{ recusou: true }, "Não envie a imagem quando o responsável recusar a assinatura"],
    [{ recusou: "true" }, "O campo recusou deve ser verdadeiro ou falso"],
    [{ assinante_nome: "a".repeat(256) }, "Nome, documento e e-mail do responsável devem ter no máximo 255 caracteres"],
    [{ assinante_documento: "1".repeat(256) }, "Nome, documento e e-mail do responsável devem ter no máximo 255 caracteres"],
    [{ assinante_email: `${"a".repeat(250)}@loja.com` }, "Nome, documento e e-mail do responsável devem ter no máximo 255 caracteres"],
  ])("rejeita dados inválidos sem abrir transação (%o)", async (alteracao, mensagem) => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaResponsavel, ...alteracao })
    ).rejects.toThrow(mensagem);
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
});

describe("regras do documento", () => {
  it.each([
    [{ assinante_tipo: "testemunha" }],
    [{ assinante_tipo: undefined }],
  ])("rejeita tipo de assinante não suportado (%o)", async (alteracao) => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaFiscal, ...alteracao })
    ).rejects.toThrow("O tipo de assinante deve ser fiscalizador ou denunciado");
  });

  it("rejeita imagem que não é PNG válido sem abrir transação", async () => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaFiscal, imagem: "bm90LXBuZw==" })
    ).rejects.toMatchObject({ name: "ValidacaoError" });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("retorna null quando o documento não existe", async () => {
    Documento.findByPk.mockResolvedValue(null);

    expect(await assinaturaService.registrar(99, assinaturaFiscal)).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it("bloqueia assinatura depois que o PDF foi gerado", async () => {
    Documento.findByPk.mockResolvedValue({ ...documentoAberto, url_arquivo_pdf: "pdfs/doc.pdf" });

    await expect(assinaturaService.registrar(7, assinaturaFiscal)).rejects.toThrow(
      "O PDF do documento já foi gerado; não é possível assinar"
    );
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it("bloqueia assinatura quando a visita não está em andamento", async () => {
    Visita.findByPk.mockResolvedValue({ ...visitaEmAndamento, status: "concluida" });

    await expect(assinaturaService.registrar(7, assinaturaFiscal)).rejects.toThrow(
      "Só é possível assinar documentos de visitas em andamento"
    );
  });

  it("apaga a imagem enviada quando a gravação falha", async () => {
    Assinatura.create.mockRejectedValue(new Error("falha no banco"));

    await expect(assinaturaService.registrar(7, assinaturaFiscal)).rejects.toThrow("falha no banco");
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(removerArquivo).toHaveBeenCalledWith(arquivo);
  });

  it("apaga a imagem quando o commit falha, sem tentar rollback de transação encerrada", async () => {
    transacao.commit.mockImplementationOnce(async () => {
      transacao.finished = "commit";
      throw new Error("conexão perdida");
    });

    await expect(assinaturaService.registrar(7, assinaturaFiscal)).rejects.toThrow("conexão perdida");
    expect(transacao.rollback).not.toHaveBeenCalled();
    expect(removerArquivo).toHaveBeenCalledWith(arquivo);
  });

  it("mantém o erro original quando a remoção da imagem também falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    Assinatura.create.mockRejectedValue(new Error("falha no banco"));
    removerArquivo.mockRejectedValue(Object.assign(new Error("x"), { codigo: "STORAGE_REMOCAO_FALHOU" }));

    await expect(assinaturaService.registrar(7, assinaturaFiscal)).rejects.toThrow("falha no banco");
    expect(consoleError).toHaveBeenCalledWith(
      "Falha ao remover imagem de assinatura órfã:",
      "STORAGE_REMOCAO_FALHOU"
    );
    consoleError.mockRestore();
  });

  it("não grava a assinatura quando o upload falha", async () => {
    uploadArquivo.mockRejectedValue(new Error("Storage fora"));

    await expect(assinaturaService.registrar(7, assinaturaFiscal)).rejects.toThrow("Storage fora");
    expect(Assinatura.create).not.toHaveBeenCalled();
    expect(removerArquivo).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });
});

describe("modelo Assinatura", () => {
  const sequelizeTeste = new Sequelize("postgres://teste:teste@localhost:5432/teste", {
    dialect: "postgres",
    dialectModule: pg,
    logging: false,
  });
  const AssinaturaModelo = getAssinaturaModel(sequelizeTeste, Sequelize);
  const base = { documento_id: 7, assinante_nome: "Ana", assinante_tipo: "fiscalizador" };

  it("aceita assinatura com imagem", async () => {
    await expect(
      AssinaturaModelo.build({ ...base, imagem_assinatura_url: "visitas/10/a.png" }).validate()
    ).resolves.toBeDefined();
  });

  it("aceita recusa sem imagem", async () => {
    await expect(
      AssinaturaModelo.build({ ...base, assinante_tipo: "denunciado", recusou: true }).validate()
    ).resolves.toBeDefined();
  });

  it.each([
    [{}],
    [{ recusou: true, imagem_assinatura_url: "visitas/10/a.png" }],
  ])("exige imagem ou recusa, nunca as duas (%o)", async (alteracao) => {
    await expect(AssinaturaModelo.build({ ...base, ...alteracao }).validate()).rejects.toThrow(
      "Informe a imagem da assinatura ou a recusa, nunca as duas"
    );
  });

  it("rejeita e-mail inválido do responsável", async () => {
    await expect(
      AssinaturaModelo.build({
        ...base,
        imagem_assinatura_url: "visitas/10/a.png",
        assinante_email: "invalido",
      }).validate()
    ).rejects.toThrow();
  });

  it("impede apagar um fiscal que já assinou", () => {
    const Usuario = sequelizeTeste.define("usuario", {}, { tableName: "usuarios" });
    const Documento = sequelizeTeste.define("documento", {}, { tableName: "documentos" });

    AssinaturaModelo.associate({ Usuario, Documento });

    expect(AssinaturaModelo.getAttributes().usuario_id.onDelete).toBe("RESTRICT");
  });

  it("garante uma assinatura por fiscal e uma do responsável por documento", () => {
    const indices = AssinaturaModelo.options.indexes.map(({ name, unique, fields }) => ({
      name,
      unique,
      fields,
    }));

    expect(indices).toEqual([
      { name: "assinaturas_documento_fiscal", unique: true, fields: ["documento_id", "usuario_id"] },
      { name: "assinaturas_documento_responsavel", unique: true, fields: ["documento_id"] },
    ]);
  });
});
