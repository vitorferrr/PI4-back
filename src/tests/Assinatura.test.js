import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import { PNG } from "pngjs";
import models, { sequelize } from "../models/index.js";
import assinaturaService from "../services/assinaturaService.js";
import { removerArquivo, uploadArquivo } from "../services/storageService.js";
import getAssinaturaModel from "../models/assinatura.js";
import emailValido from "../utils/emailValido.js";

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

vi.mock("../config/supabase.js", () => ({ getStorageContext: () => ({ bucket: "documentos" }) }));

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

const usuario = { id: 5, role: "fiscalizador" };
const documentoAberto = { id: 7, visita_id: 10, url_arquivo_pdf: null };
const visitaEmAndamento = {
  id: 10,
  status: "em_andamento",
  fiscalizadores: [{ id: 5, nome: "Ana Fiscal" }],
};
const arquivo = { bucket: "documentos", path: "visitas/10/assinaturas/uuid.png" };

const assinaturaFiscal = { assinante_tipo: "fiscalizador", imagem };
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
  transacao.rollback.mockReset();
  transacao.commit.mockReset();
  Documento.findByPk.mockReset().mockResolvedValue(documentoAberto);
  Visita.findByPk.mockReset().mockResolvedValue(visitaEmAndamento);
  Assinatura.findOne.mockReset().mockResolvedValue(null);
  Assinatura.create.mockReset().mockImplementation(async (dados) => ({ id: 1, ...dados }));
  uploadArquivo.mockReset().mockResolvedValue(arquivo);
  removerArquivo.mockReset().mockResolvedValue();
});

describe("registrar assinatura do fiscalizador", () => {
  it("usa o usuário logado, sobe a imagem e grava com o documento travado", async () => {
    const resultado = await assinaturaService.registrar(7, assinaturaFiscal, usuario);

    expect(uploadArquivo).toHaveBeenCalledWith({
      conteudo: png,
      contentType: "image/png",
      diretorio: "visitas/10/assinaturas",
    });
    expect(Documento.findByPk).toHaveBeenLastCalledWith(7, {
      transaction: transacao,
      lock: transacao.LOCK.UPDATE,
    });
    expect(Assinatura.findOne).toHaveBeenLastCalledWith({
      attributes: ["id"],
      where: { documento_id: 7, usuario_id: 5 },
      transaction: transacao,
    });
    expect(Assinatura.create).toHaveBeenCalledWith(
      expect.objectContaining({
        documento_id: 7,
        usuario_id: 5,
        assinante_nome: "Ana Fiscal",
        assinante_tipo: "fiscalizador",
        recusou: false,
        imagem_assinatura_url: arquivo.path,
      }),
      { transaction: transacao }
    );
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(resultado).toMatchObject({ id: 1, usuario_id: 5 });
  });

  it("ignora o usuario_id enviado no corpo: ninguém assina por outro fiscal", async () => {
    const visita = {
      ...visitaEmAndamento,
      fiscalizadores: [
        { id: 5, nome: "Ana Fiscal" },
        { id: 6, nome: "Bruno Fiscal" },
      ],
    };
    Visita.findByPk.mockResolvedValue(visita);

    await assinaturaService.registrar(7, { ...assinaturaFiscal, usuario_id: 6 }, usuario);

    expect(Assinatura.create).toHaveBeenCalledWith(
      expect.objectContaining({ usuario_id: 5, assinante_nome: "Ana Fiscal" }),
      { transaction: transacao }
    );
  });

  it("faz o upload antes de abrir a transação", async () => {
    await assinaturaService.registrar(7, assinaturaFiscal, usuario);

    expect(uploadArquivo.mock.invocationCallOrder[0]).toBeLessThan(
      sequelize.transaction.mock.invocationCallOrder[0]
    );
  });

  it("aceita a imagem em base64 puro, sem o prefixo data URL", async () => {
    await assinaturaService.registrar(7, { ...assinaturaFiscal, imagem: png.toString("base64") }, usuario);

    expect(uploadArquivo).toHaveBeenCalledWith(expect.objectContaining({ conteudo: png }));
  });

  it("retorna null para fiscalizador que não é da visita, sem subir imagem", async () => {
    const resultado = await assinaturaService.registrar(7, assinaturaFiscal, { id: 9, role: "fiscalizador" });

    expect(resultado).toBeNull();
    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("rejeita usuário sem papel de fiscal da visita", async () => {
    await expect(
      assinaturaService.registrar(7, assinaturaFiscal, { id: 1, role: "gestor" })
    ).rejects.toThrow("O usuário logado não é fiscalizador desta visita");
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it("rejeita segunda assinatura do mesmo fiscalizador sem subir imagem", async () => {
    Assinatura.findOne.mockResolvedValue({ id: 3 });

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow(
      "Este fiscalizador já assinou o documento"
    );
    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("não deixa o fiscalizador recusar", async () => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaFiscal, recusou: true }, usuario)
    ).rejects.toThrow("Somente o responsável pelo estabelecimento pode recusar");
  });
});

describe("registrar assinatura do responsável", () => {
  it("grava nome, documento e e-mail informados com a imagem", async () => {
    await assinaturaService.registrar(7, assinaturaResponsavel, usuario);

    expect(Assinatura.findOne).toHaveBeenLastCalledWith(
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

    await assinaturaService.registrar(7, { ...semImagem, recusou: true }, usuario);

    expect(uploadArquivo).not.toHaveBeenCalled();
    expect(Documento.findByPk).toHaveBeenCalledTimes(1);
    expect(Assinatura.create).toHaveBeenCalledWith(
      expect.objectContaining({ recusou: true, imagem_assinatura_url: null }),
      { transaction: transacao }
    );
  });

  it("aceita responsável sem documento e sem e-mail", async () => {
    await assinaturaService.registrar(
      7,
      { assinante_tipo: "denunciado", assinante_nome: "Carlos", imagem },
      usuario
    );

    expect(Assinatura.create).toHaveBeenCalledWith(
      expect.objectContaining({ assinante_documento: null, assinante_email: null }),
      { transaction: transacao }
    );
  });

  it("rejeita segunda assinatura ou recusa do responsável", async () => {
    Assinatura.findOne.mockResolvedValue({ id: 3 });

    await expect(assinaturaService.registrar(7, assinaturaResponsavel, usuario)).rejects.toThrow(
      "O responsável já assinou ou recusou o documento"
    );
  });

  it.each([
    [{ assinante_nome: "  " }, "Informe o nome do responsável pelo estabelecimento"],
    [{ assinante_email: "sem-arroba" }, "Informe um e-mail válido para o responsável"],
    [{ assinante_email: "a,b@loja.com" }, "Informe um e-mail válido para o responsável"],
    [{ recusou: true }, "Não envie a imagem quando o responsável recusar a assinatura"],
    [{ recusou: "true" }, "O campo recusou deve ser verdadeiro ou falso"],
    [{ assinante_nome: "a".repeat(256) }, "Nome, documento e e-mail do responsável devem ter no máximo 255 caracteres"],
    [{ assinante_documento: "1".repeat(256) }, "Nome, documento e e-mail do responsável devem ter no máximo 255 caracteres"],
    [{ assinante_email: `${"a".repeat(250)}@loja.com` }, "Nome, documento e e-mail do responsável devem ter no máximo 255 caracteres"],
  ])("rejeita dados inválidos sem acessar o banco (%o)", async (alteracao, mensagem) => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaResponsavel, ...alteracao }, usuario)
    ).rejects.toThrow(mensagem);
    expect(Documento.findByPk).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
});

describe("regras do documento", () => {
  it.each([[{ assinante_tipo: "testemunha" }], [{ assinante_tipo: undefined }]])(
    "rejeita tipo de assinante não suportado (%o)",
    async (alteracao) => {
      await expect(
        assinaturaService.registrar(7, { ...assinaturaFiscal, ...alteracao }, usuario)
      ).rejects.toThrow("O tipo de assinante deve ser fiscalizador ou denunciado");
    }
  );

  it("rejeita imagem que não é PNG válido sem acessar o banco", async () => {
    await expect(
      assinaturaService.registrar(7, { ...assinaturaFiscal, imagem: "bm90LXBuZw==" }, usuario)
    ).rejects.toMatchObject({ name: "ValidacaoError" });
    expect(Documento.findByPk).not.toHaveBeenCalled();
  });

  it("retorna null quando o documento não existe", async () => {
    Documento.findByPk.mockResolvedValue(null);

    expect(await assinaturaService.registrar(99, assinaturaFiscal, usuario)).toBeNull();
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it("bloqueia assinatura depois que o PDF foi gerado", async () => {
    Documento.findByPk.mockResolvedValue({ ...documentoAberto, url_arquivo_pdf: "pdfs/doc.pdf" });

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow(
      "O PDF do documento já foi gerado; não é possível assinar"
    );
    expect(uploadArquivo).not.toHaveBeenCalled();
  });

  it("bloqueia assinatura quando a visita não está em andamento", async () => {
    Visita.findByPk.mockResolvedValue({ ...visitaEmAndamento, status: "concluida" });

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow(
      "Só é possível assinar documentos de visitas em andamento"
    );
  });

  it("apaga a imagem se outra assinatura chegou durante o upload", async () => {
    Assinatura.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 3 });

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow(
      "Este fiscalizador já assinou o documento"
    );
    expect(Assinatura.create).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(removerArquivo).toHaveBeenCalledWith(arquivo);
  });

  it("apaga a imagem se o documento sumiu durante o upload", async () => {
    Documento.findByPk.mockResolvedValueOnce(documentoAberto).mockResolvedValueOnce(null);

    expect(await assinaturaService.registrar(7, assinaturaFiscal, usuario)).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(removerArquivo).toHaveBeenCalledWith(arquivo);
  });

  it("apaga a imagem enviada quando a gravação falha", async () => {
    Assinatura.create.mockRejectedValue(new Error("falha no banco"));

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow("falha no banco");
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(removerArquivo).toHaveBeenCalledWith(arquivo);
  });

  it("apaga a imagem quando não consegue abrir a transação", async () => {
    sequelize.transaction.mockRejectedValueOnce(new Error("sem conexão"));

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow("sem conexão");
    expect(removerArquivo).toHaveBeenCalledWith(arquivo);
  });

  it("apaga a imagem quando o commit falha, sem rollback de transação encerrada", async () => {
    transacao.commit.mockImplementationOnce(async () => {
      transacao.finished = "commit";
      throw new Error("conexão perdida");
    });

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow("conexão perdida");
    expect(transacao.rollback).not.toHaveBeenCalled();
    expect(removerArquivo).toHaveBeenCalledWith(arquivo);
  });

  it("registra caminho e causa quando a remoção da imagem também falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    Assinatura.create.mockRejectedValue(new Error("falha no banco"));
    removerArquivo.mockRejectedValue(new Error("rede fora"));

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow("falha no banco");
    expect(consoleError).toHaveBeenCalledWith(
      "Falha ao remover imagem de assinatura órfã:",
      arquivo.path,
      "rede fora"
    );
    consoleError.mockRestore();
  });

  it("mantém o erro original quando o rollback também falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    Assinatura.create.mockRejectedValue(new Error("falha no banco"));
    transacao.rollback.mockRejectedValue(new Error("conexão perdida"));

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow("falha no banco");
    expect(consoleError).toHaveBeenCalledWith(
      "Falha ao desfazer a transação da assinatura:",
      "conexão perdida"
    );
    expect(removerArquivo).toHaveBeenCalledWith(arquivo);
    consoleError.mockRestore();
  });

  it("não grava a assinatura quando o upload falha", async () => {
    uploadArquivo.mockRejectedValue(new Error("Storage fora"));

    await expect(assinaturaService.registrar(7, assinaturaFiscal, usuario)).rejects.toThrow("Storage fora");
    expect(Assinatura.create).not.toHaveBeenCalled();
    expect(removerArquivo).not.toHaveBeenCalled();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
});

describe("remover assinatura", () => {
  const assinaturaSalva = (dados = {}) => ({
    id: 3,
    imagem_assinatura_url: "visitas/10/assinaturas/3.png",
    destroy: vi.fn(),
    ...dados,
  });
  let consoleInfo;

  beforeEach(() => {
    consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {});
  });

  afterEach(() => consoleInfo.mockRestore());

  it("registra no log quem removeu a assinatura", async () => {
    Assinatura.findOne.mockResolvedValue(assinaturaSalva({ assinante_tipo: "denunciado" }));

    await assinaturaService.remover(7, 3, usuario);

    expect(consoleInfo).toHaveBeenCalledWith("Assinatura removida:", {
      documento_id: 7,
      assinatura_id: 3,
      assinante_tipo: "denunciado",
      removida_por: usuario.id,
      removida_em: expect.any(String),
    });
  });

  it("não registra remoção quando a assinatura não existe", async () => {
    Assinatura.findOne.mockResolvedValue(null);

    expect(await assinaturaService.remover(7, 3, usuario)).toBeNull();
    expect(consoleInfo).not.toHaveBeenCalled();
  });

  it("apaga a assinatura com o documento travado e depois remove a imagem", async () => {
    const assinatura = assinaturaSalva();
    Assinatura.findOne.mockResolvedValue(assinatura);

    expect(await assinaturaService.remover(7, 3, usuario)).toBe(true);

    expect(Documento.findByPk).toHaveBeenCalledWith(7, { transaction: transacao, lock: "UPDATE" });
    expect(Assinatura.findOne).toHaveBeenCalledWith({
      where: { id: 3, documento_id: 7 },
      transaction: transacao,
    });
    expect(assinatura.destroy).toHaveBeenCalledWith({ transaction: transacao });
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(removerArquivo).toHaveBeenCalledWith({
      bucket: "documentos",
      path: "visitas/10/assinaturas/3.png",
    });
    expect(removerArquivo.mock.invocationCallOrder[0]).toBeGreaterThan(
      transacao.commit.mock.invocationCallOrder[0]
    );
  });

  it("remove a recusa, que não tem imagem", async () => {
    Assinatura.findOne.mockResolvedValue(assinaturaSalva({ imagem_assinatura_url: null }));

    expect(await assinaturaService.remover(7, 3, usuario)).toBe(true);
    expect(removerArquivo).not.toHaveBeenCalled();
  });

  it.each([
    ["documento inexistente", () => Documento.findByPk.mockResolvedValue(null)],
    ["fiscal de outra visita", () => {}],
    ["assinatura de outro documento", () => Assinatura.findOne.mockResolvedValue(null)],
  ])("retorna null para %s", async (caso, preparar) => {
    preparar();
    const quem = caso === "fiscal de outra visita" ? { id: 9, role: "fiscalizador" } : usuario;

    expect(await assinaturaService.remover(7, 3, quem)).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(removerArquivo).not.toHaveBeenCalled();
  });

  it("não remove depois que o PDF foi gerado", async () => {
    Documento.findByPk.mockResolvedValue({ ...documentoAberto, url_arquivo_pdf: "pdfs/doc.pdf" });

    await expect(assinaturaService.remover(7, 3, usuario)).rejects.toThrow(
      "O PDF do documento já foi gerado; a assinatura não pode ser removida"
    );
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("não remove de visita que não está em andamento", async () => {
    Visita.findByPk.mockResolvedValue({ ...visitaEmAndamento, status: "concluida" });

    await expect(assinaturaService.remover(7, 3, usuario)).rejects.toThrow(
      "Só é possível remover assinaturas de visitas em andamento"
    );
  });

  it("mantém a remoção quando apagar a imagem falha", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    Assinatura.findOne.mockResolvedValue(assinaturaSalva());
    removerArquivo.mockRejectedValue(new Error("rede fora"));

    expect(await assinaturaService.remover(7, 3, usuario)).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      "Falha ao remover imagem de assinatura órfã:",
      "visitas/10/assinaturas/3.png",
      "rede fora"
    );
    consoleError.mockRestore();
  });
});

describe("regra de e-mail", () => {
  it.each(["a@b.co", "nome.sobrenome+tag@loja.com.br"])("aceita %s", (email) => {
    expect(emailValido(email)).toBe(true);
  });

  it.each(["sem-arroba", "a,b@loja.com", "a;b@loja.com", "x<outro@loja.com>", '"a"@loja.com', "a b@loja.com", null])(
    "recusa %s",
    (email) => {
      expect(emailValido(email)).toBe(false);
    }
  );
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

  it.each([[{}], [{ recusou: true, imagem_assinatura_url: "visitas/10/a.png" }]])(
    "exige imagem ou recusa, nunca as duas (%o)",
    async (alteracao) => {
      await expect(AssinaturaModelo.build({ ...base, ...alteracao }).validate()).rejects.toThrow(
        "Informe a imagem da assinatura ou a recusa, nunca as duas"
      );
    }
  );

  it.each(["invalido", "a,b@loja.com", '"a"@loja.com'])("rejeita e-mail inválido do responsável (%s)", async (email) => {
    await expect(
      AssinaturaModelo.build({
        ...base,
        imagem_assinatura_url: "visitas/10/a.png",
        assinante_email: email,
      }).validate()
    ).rejects.toThrow("E-mail do responsável inválido");
  });

  it("aceita responsável sem e-mail", async () => {
    await expect(
      AssinaturaModelo.build({
        ...base,
        imagem_assinatura_url: "visitas/10/a.png",
        assinante_email: null,
      }).validate()
    ).resolves.toBeDefined();
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
