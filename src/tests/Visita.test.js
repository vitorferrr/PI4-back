import { beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import models, { sequelize } from "../models/index.js";
import visitaService from "../services/visitaService.js";
import getVisitaModel from "../models/visita.js";

vi.mock("../models/index.js", () => {
  const transacao = { commit: vi.fn(), rollback: vi.fn() };

  return {
    sequelize: {
      transaction: vi.fn(async () => transacao),
      transacao,
    },
    default: {
      Visita: {
        create: vi.fn(),
        findAll: vi.fn(),
        findByPk: vi.fn(),
        update: vi.fn(),
      },
      Usuario: {},
      Documento: {},
      RespostaQuestionario: {},
    },
  };
});

const { Visita } = models;
const { transacao } = sequelize;

const sequelizeTeste = new Sequelize("postgres://teste:teste@localhost:5432/teste", {
  dialect: "postgres",
  dialectModule: pg,
  logging: false,
});
const VisitaModelo = getVisitaModel(sequelizeTeste, Sequelize);

const dadosVisita = {
  denunciado: "Mercado Bom Preço",
  gestor_id: 1,
  data_agendada: "2026-10-20T10:00:00Z",
};

const criarVisitaFalsa = (dados = {}) => ({
  id: 10,
  ...dados,
  setFiscalizadores: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("criar visita", () => {
  it("cria a visita, associa os fiscalizadores e confirma a transação", async () => {
    const visitaCriada = criarVisitaFalsa(dadosVisita);
    Visita.create.mockResolvedValue(visitaCriada);
    Visita.findByPk.mockResolvedValue({ id: 10, ...dadosVisita });

    const resultado = await visitaService.criar(dadosVisita, [2, 3]);

    expect(Visita.create).toHaveBeenCalledWith(
      expect.objectContaining(dadosVisita),
      { transaction: transacao }
    );
    expect(visitaCriada.setFiscalizadores).toHaveBeenCalledWith([2, 3], {
      transaction: transacao,
    });
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(transacao.rollback).not.toHaveBeenCalled();
    expect(resultado.id).toBe(10);
  });

  it("não associa fiscalizadores quando a lista está vazia", async () => {
    const visitaCriada = criarVisitaFalsa(dadosVisita);
    Visita.create.mockResolvedValue(visitaCriada);
    Visita.findByPk.mockResolvedValue({ id: 10 });

    await visitaService.criar(dadosVisita);

    expect(visitaCriada.setFiscalizadores).not.toHaveBeenCalled();
    expect(transacao.commit).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["denunciado", "O campo denunciado é obrigatório"],
    ["gestor_id", "O gestor responsável é obrigatório"],
    ["data_agendada", "A data agendada é obrigatória"],
  ])("rejeita visita sem %s", async (campo, mensagem) => {
    const dados = { ...dadosVisita };
    delete dados[campo];

    await expect(visitaService.criar(dados)).rejects.toThrow(mensagem);
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(Visita.create).not.toHaveBeenCalled();
  });

  it("desfaz a transação quando ocorre erro ao salvar", async () => {
    Visita.create.mockRejectedValue(new Error("falha no banco"));

    await expect(visitaService.criar(dadosVisita, [2])).rejects.toThrow(
      "falha no banco"
    );
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(transacao.commit).not.toHaveBeenCalled();
  });
});

describe("listar visitas", () => {
  it("lista sem filtros, ordenando pela data agendada", async () => {
    Visita.findAll.mockResolvedValue([]);

    await visitaService.listar();
    const opcoes = Visita.findAll.mock.calls[0][0];

    expect(opcoes.where).toEqual({});
    expect(opcoes.order).toEqual([["data_agendada", "ASC"]]);
  });

  it("aplica filtros de status e gestor", async () => {
    Visita.findAll.mockResolvedValue([]);

    await visitaService.listar({ status: "agendada", gestor_id: 1 });

    expect(Visita.findAll.mock.calls[0][0].where).toEqual({
      status: "agendada",
      gestor_id: 1,
    });
  });

  it("filtra pelo fiscalizador exigindo a associação", async () => {
    Visita.findAll.mockResolvedValue([]);

    await visitaService.listar({ fiscalizador_id: 5 });
    const includeFiscalizadores = Visita.findAll.mock.calls[0][0].include.find(
      (inc) => inc.as === "fiscalizadores"
    );

    expect(includeFiscalizadores.where).toEqual({ id: 5 });
    expect(includeFiscalizadores.required).toBe(true);
  });
});

describe("buscar visita por id", () => {
  it("retorna a visita com gestor, fiscalizadores, documentos e respostas", async () => {
    Visita.findByPk.mockResolvedValue({ id: 10 });

    const resultado = await visitaService.buscarPorId(10);
    const aliases = Visita.findByPk.mock.calls[0][1].include.map((inc) => inc.as);

    expect(resultado).toEqual({ id: 10 });
    expect(aliases).toEqual(["gestor", "fiscalizadores", "documentos", "respostas"]);
  });

  it("retorna null quando a visita não existe", async () => {
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.buscarPorId(99)).toBeNull();
  });
});

describe("atualizar visita", () => {
  it("atualiza só os campos permitidos e troca os fiscalizadores", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValueOnce(visita).mockResolvedValueOnce({ id: 10 });

    await visitaService.atualizar(
      10,
      { status: "em_andamento", campoInvalido: "x" },
      [4]
    );

    expect(visita.update).toHaveBeenCalledWith(
      { status: "em_andamento" },
      { transaction: transacao }
    );
    expect(visita.setFiscalizadores).toHaveBeenCalledWith([4], {
      transaction: transacao,
    });
    expect(transacao.commit).toHaveBeenCalledTimes(1);
  });

  it("não mexe nos fiscalizadores quando a lista não é enviada", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValueOnce(visita).mockResolvedValueOnce({ id: 10 });

    await visitaService.atualizar(10, { observacoes_livres: "ok" });

    expect(visita.setFiscalizadores).not.toHaveBeenCalled();
  });

  it("desfaz a transação quando a atualização falha", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    visita.update.mockRejectedValue(new Error("erro"));
    Visita.findByPk.mockResolvedValue(visita);

    await expect(visitaService.atualizar(10, { status: "concluida" })).rejects.toThrow();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("retorna null quando a visita não existe", async () => {
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.atualizar(99, { status: "concluida" })).toBeNull();
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });
});

describe("iniciar visita", () => {
  it("atualiza condicionando ao status agendada e define a data de realização", async () => {
    Visita.update.mockResolvedValue([1]);
    Visita.findByPk.mockResolvedValue({ id: 10, status: "em_andamento" });

    const resultado = await visitaService.iniciar(10);

    expect(Visita.update).toHaveBeenCalledWith(
      { status: "em_andamento", data_realizacao: expect.any(Date) },
      { where: { id: 10, status: "agendada" } }
    );
    expect(resultado).toEqual({ id: 10, status: "em_andamento" });
  });

  it("rejeita quando nenhuma linha é alterada e a visita existe, como em requisição simultânea", async () => {
    Visita.update.mockResolvedValue([0]);
    Visita.findByPk.mockResolvedValue({ id: 10, status: "em_andamento" });

    await expect(visitaService.iniciar(10)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Somente visitas agendadas podem ser iniciadas",
    });
  });

  it("retorna null quando a visita não existe", async () => {
    Visita.update.mockResolvedValue([0]);
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.iniciar(99)).toBeNull();
  });

  it("propaga o erro quando a atualização falha", async () => {
    Visita.update.mockRejectedValue(new Error("falha no banco"));

    await expect(visitaService.iniciar(10)).rejects.toThrow("falha no banco");
  });
});

describe("concluir visita", () => {
  it("atualiza condicionando ao status em_andamento", async () => {
    Visita.update.mockResolvedValue([1]);
    Visita.findByPk.mockResolvedValue({ id: 10, status: "concluida" });

    const resultado = await visitaService.concluir(10);

    expect(Visita.update).toHaveBeenCalledWith(
      { status: "concluida" },
      { where: { id: 10, status: "em_andamento" } }
    );
    expect(resultado).toEqual({ id: 10, status: "concluida" });
  });

  it("rejeita quando nenhuma linha é alterada e a visita existe, como em requisição simultânea", async () => {
    Visita.update.mockResolvedValue([0]);
    Visita.findByPk.mockResolvedValue({ id: 10, status: "agendada" });

    await expect(visitaService.concluir(10)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Somente visitas em andamento podem ser concluídas",
    });
  });

  it("retorna null quando a visita não existe", async () => {
    Visita.update.mockResolvedValue([0]);
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.concluir(99)).toBeNull();
  });

  it("propaga o erro quando a atualização falha", async () => {
    Visita.update.mockRejectedValue(new Error("falha no banco"));

    await expect(visitaService.concluir(10)).rejects.toThrow("falha no banco");
  });
});

describe("remover visita", () => {
  it("remove a visita encontrada", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValue(visita);

    const resultado = await visitaService.remover(10);

    expect(visita.destroy).toHaveBeenCalledTimes(1);
    expect(resultado).toBe(visita);
  });

  it("retorna null quando a visita não existe", async () => {
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.remover(99)).toBeNull();
  });
});

describe("validações do modelo Visita", () => {
  it("aceita uma visita válida e usa 'agendada' como status padrão", async () => {
    const visita = VisitaModelo.build(dadosVisita);

    await expect(visita.validate()).resolves.toBeDefined();
    expect(visita.status).toBe("agendada");
  });

  it("exige denunciado não vazio", async () => {
    await expect(
      VisitaModelo.build({ ...dadosVisita, denunciado: "" }).validate()
    ).rejects.toThrow();
  });

  it("exige data agendada", async () => {
    const { data_agendada, ...semData } = dadosVisita;
    await expect(VisitaModelo.build(semData).validate()).rejects.toThrow();
  });

  it("rejeita latitude fora de -90 a 90", async () => {
    await expect(
      VisitaModelo.build({ ...dadosVisita, latitude: 95 }).validate()
    ).rejects.toThrow();
  });

  it("rejeita longitude fora de -180 a 180", async () => {
    await expect(
      VisitaModelo.build({ ...dadosVisita, longitude: -200 }).validate()
    ).rejects.toThrow();
  });

  it("rejeita status fora da lista permitida", async () => {
    await expect(
      VisitaModelo.build({ ...dadosVisita, status: "pausada" }).validate()
    ).rejects.toThrow();
  });
});
