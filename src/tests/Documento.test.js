import { beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import models, { sequelize } from "../models/index.js";
import documentoService from "../services/documentoService.js";
import documentoController from "../controllers/documentoController.js";
import visitaService from "../services/visitaService.js";
import getDocumentoModel from "../models/documento.js";

vi.mock("../models/index.js", () => {
  const transacao = { commit: vi.fn(), rollback: vi.fn(), LOCK: { UPDATE: "UPDATE" } };

  return {
    sequelize: {
      transaction: vi.fn(async () => transacao),
      transacao,
    },
    default: {
      Documento: {
        findOne: vi.fn(),
        create: vi.fn(),
      },
      PerguntaQuestionario: {
        findAll: vi.fn(),
      },
      RespostaQuestionario: {
        findAll: vi.fn(),
      },
      Visita: {
        findByPk: vi.fn(),
      },
    },
  };
});

vi.mock("../services/visitaService.js", () => ({
  default: {
    buscarParaAcesso: vi.fn(),
  },
}));

const { Documento, PerguntaQuestionario, RespostaQuestionario, Visita } = models;
const { transacao } = sequelize;

const sequelizeTeste = new Sequelize("postgres://teste:teste@localhost:5432/teste", {
  dialect: "postgres",
  dialectModule: pg,
  logging: false,
});
const DocumentoModelo = getDocumentoModel(sequelizeTeste, Sequelize);

const criarRes = () => {
  const res = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("modelo Documento", () => {
  it("aceita documento ainda sem PDF", async () => {
    await expect(
      DocumentoModelo.build({ visita_id: 10, url_arquivo_pdf: null }).validate()
    ).resolves.toBeDefined();
  });

  it("rejeita URL do PDF vazia", async () => {
    await expect(
      DocumentoModelo.build({ visita_id: 10, url_arquivo_pdf: "" }).validate()
    ).rejects.toMatchObject({ name: "SequelizeValidationError" });
  });

  it("permite um único documento por visita", () => {
    expect(DocumentoModelo.options.indexes).toEqual(
      expect.arrayContaining([expect.objectContaining({ unique: true, fields: ["visita_id"] })])
    );
  });
});

describe("gerar documento da visita", () => {
  const perguntas = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const respostas = [{ pergunta_id: 1 }, { pergunta_id: 2 }, { pergunta_id: 3 }];

  beforeEach(() => {
    Visita.findByPk.mockResolvedValue({ id: 10, status: "em_andamento" });
    Documento.findOne.mockResolvedValue(null);
    PerguntaQuestionario.findAll.mockResolvedValue(perguntas);
    RespostaQuestionario.findAll.mockResolvedValue(respostas);
  });

  it("trava a visita, confere as respostas e cria o documento sem PDF", async () => {
    Documento.create.mockResolvedValue({ id: 7, visita_id: 10 });

    const resultado = await documentoService.gerar(10);

    expect(Visita.findByPk).toHaveBeenCalledWith(10, {
      attributes: ["id", "status"],
      transaction: transacao,
      lock: transacao.LOCK.UPDATE,
    });
    expect(RespostaQuestionario.findAll).toHaveBeenCalledWith({
      attributes: ["pergunta_id"],
      where: { visita_id: 10 },
      transaction: transacao,
    });
    expect(Documento.create).toHaveBeenCalledWith(
      {
        visita_id: 10,
        url_arquivo_pdf: null,
        data_geracao: expect.any(Date),
        enviado_email: false,
      },
      { transaction: transacao }
    );
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ documento: { id: 7, visita_id: 10 }, criado: true });
  });

  it("devolve o documento que já existe sem criar outro", async () => {
    Documento.findOne.mockResolvedValue({ id: 7, visita_id: 10 });

    const resultado = await documentoService.gerar(10);

    expect(resultado).toEqual({ documento: { id: 7, visita_id: 10 }, criado: false });
    expect(Documento.create).not.toHaveBeenCalled();
    expect(transacao.commit).toHaveBeenCalledTimes(1);
  });

  it("devolve null e desfaz a transação quando a visita não existe", async () => {
    Visita.findByPk.mockResolvedValue(null);

    expect(await documentoService.gerar(99)).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(Documento.findOne).not.toHaveBeenCalled();
  });

  it.each(["agendada", "concluida", "cancelada"])(
    "rejeita visita %s que ainda não tem documento",
    async (status) => {
      Visita.findByPk.mockResolvedValue({ id: 10, status });

      await expect(documentoService.gerar(10)).rejects.toMatchObject({
        name: "ValidacaoError",
        message: "Só é possível gerar o documento de visitas em andamento",
      });
      expect(Documento.create).not.toHaveBeenCalled();
      expect(transacao.rollback).toHaveBeenCalledTimes(1);
    }
  );

  it("lista as perguntas sem resposta e não cria o documento", async () => {
    RespostaQuestionario.findAll.mockResolvedValue([{ pergunta_id: 2 }]);

    await expect(documentoService.gerar(10)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Responda todas as perguntas antes de gerar o documento",
      errors: [
        { message: "A pergunta 1 não foi respondida" },
        { message: "A pergunta 3 não foi respondida" },
      ],
    });
    expect(Documento.create).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("desfaz a transação quando a gravação falha", async () => {
    Documento.create.mockRejectedValue(new Error("falha no banco"));

    await expect(documentoService.gerar(10)).rejects.toThrow("falha no banco");
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(transacao.commit).not.toHaveBeenCalled();
  });
});

describe("documentoController.gerar", () => {
  const visita = { id: 10, status: "em_andamento", fiscalizadores: [{ id: 5 }] };
  const requisicao = (id = 5) => ({ params: { id: "10" }, usuario: { id, role: "fiscalizador" } });

  it("responde 201 quando cria o documento", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visita);
    vi.spyOn(documentoService, "gerar").mockResolvedValueOnce({
      documento: { id: 7 },
      criado: true,
    });
    const res = criarRes();

    await documentoController.gerar(requisicao(), res);

    expect(documentoService.gerar).toHaveBeenCalledWith(10);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 7 });
  });

  it("responde 200 quando o documento já existia", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visita);
    vi.spyOn(documentoService, "gerar").mockResolvedValueOnce({
      documento: { id: 7 },
      criado: false,
    });
    const res = criarRes();

    await documentoController.gerar(requisicao(), res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("responde 404 para fiscalizador que não está na visita", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visita);
    const gerar = vi.spyOn(documentoService, "gerar");
    const res = criarRes();

    await expect(documentoController.gerar(requisicao(6), res)).rejects.toMatchObject({
      statusCode: 404,
      message: "Visita não encontrada",
    });
    expect(res.status).not.toHaveBeenCalled();
    expect(gerar).not.toHaveBeenCalled();
  });

  it("responde 404 quando a visita some antes de gerar", async () => {
    visitaService.buscarParaAcesso.mockResolvedValue(visita);
    vi.spyOn(documentoService, "gerar").mockResolvedValueOnce(null);
    const res = criarRes();

    await expect(documentoController.gerar(requisicao(), res)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});
