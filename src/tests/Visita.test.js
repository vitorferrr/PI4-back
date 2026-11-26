import { beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import models, { sequelize } from "../models/index.js";
import visitaService from "../services/visitaService.js";
import getVisitaModel from "../models/visita.js";

vi.mock("../models/index.js", () => {
  const transacao = { commit: vi.fn(), rollback: vi.fn(), LOCK: { UPDATE: "UPDATE" } };

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
      Usuario: {
        findByPk: vi.fn(),
      },
      Documento: {
        findOne: vi.fn(),
      },
      RespostaQuestionario: {},
    },
  };
});

const { Documento, Usuario, Visita } = models;
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
  status: "agendada",
  ...dados,
  getFiscalizadores: vi.fn(),
  addFiscalizador: vi.fn(),
  setFiscalizadores: vi.fn(),
  removeFiscalizador: vi.fn(),
  update: vi.fn(),
  destroy: vi.fn(),
});

beforeEach(() => {
  vi.clearAllMocks();
  Usuario.findByPk.mockReset().mockImplementation(async (id) => ({ id, role: "fiscalizador" }));
});

describe("criar visita", () => {
  it("cria a visita, associa os fiscalizadores e confirma a transação", async () => {
    const visitaCriada = criarVisitaFalsa(dadosVisita);
    Visita.create.mockResolvedValue(visitaCriada);
    Visita.findByPk.mockResolvedValue({ id: 10, ...dadosVisita });

    const resultado = await visitaService.criar(dadosVisita, [2]);

    expect(Visita.create).toHaveBeenCalledWith(
      expect.objectContaining(dadosVisita),
      { transaction: transacao }
    );
    expect(visitaCriada.setFiscalizadores).toHaveBeenCalledWith([2], {
      transaction: transacao,
    });
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(transacao.rollback).not.toHaveBeenCalled();
    expect(resultado.id).toBe(10);
  });

  it("grava os dados do estabelecimento informados pelo gestor", async () => {
    const estabelecimento = {
      razao_social: "Bom Preço Comércio de Alimentos LTDA",
      nome_fantasia: "Mercado Bom Preço",
      endereco: "Av. Barreto de Menezes, 100",
      bairro: "Prazeres",
      cep: "54310-000",
      telefone: "(81) 3333-4444",
      cnpj_cpf: "12.345.678/0001-90",
      atividade: "Supermercado",
    };
    Visita.create.mockResolvedValue(criarVisitaFalsa(dadosVisita));
    Visita.findByPk.mockResolvedValue({ id: 10 });

    await visitaService.criar({ ...dadosVisita, ...estabelecimento, campoInvalido: "x" }, [2]);

    const dadosSalvos = Visita.create.mock.calls[0][0];
    expect(dadosSalvos).toMatchObject(estabelecimento);
    expect(dadosSalvos).not.toHaveProperty("campoInvalido");
  });

  it("não envia ao banco campos do estabelecimento que não foram informados", async () => {
    Visita.create.mockResolvedValue(criarVisitaFalsa(dadosVisita));
    Visita.findByPk.mockResolvedValue({ id: 10 });

    await visitaService.criar({ ...dadosVisita, nome_fantasia: "Mercado Bom Preço" }, [2]);

    const dadosSalvos = Visita.create.mock.calls[0][0];
    expect(dadosSalvos.nome_fantasia).toBe("Mercado Bom Preço");
    expect(dadosSalvos).not.toHaveProperty("razao_social");
  });

  it.each([[undefined], [[]], [5], [[2, 3]], [[2, 3, 4, 5]]])(
    "rejeita visita sem exatamente um fiscalizador (%o), sem abrir transação",
    async (ids) => {
      await expect(visitaService.criar(dadosVisita, ids)).rejects.toMatchObject({
        name: "ValidacaoError",
        message: "A visita deve ter exatamente um agente fiscalizador",
      });
      expect(sequelize.transaction).not.toHaveBeenCalled();
      expect(Visita.create).not.toHaveBeenCalled();
    }
  );

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

  it("confere que o fiscalizador existe e tem o papel certo", async () => {
    Visita.create.mockResolvedValue(criarVisitaFalsa(dadosVisita));
    Visita.findByPk.mockResolvedValue({ id: 10 });

    await visitaService.criar(dadosVisita, [2]);

    expect(Usuario.findByPk).toHaveBeenCalledWith(2, { attributes: ["id", "role", "aprovado"] });
  });

  it.each([
    ["gestor", { id: 3, role: "gestor" }],
    ["admin", { id: 3, role: "admin" }],
    ["inexistente", null],
  ])("rejeita fiscalizador %s sem abrir transação", async (_, usuario) => {
    Usuario.findByPk.mockResolvedValue(usuario);

    await expect(visitaService.criar(dadosVisita, [3])).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "O usuário informado não é um fiscalizador cadastrado",
    });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("rejeita fiscalizador com cadastro ainda não aprovado", async () => {
    Usuario.findByPk.mockResolvedValue({ id: 3, role: "fiscalizador", aprovado: false });

    await expect(visitaService.criar(dadosVisita, [3])).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "O fiscalizador informado ainda não foi aprovado",
    });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it.each([["3"], [0], [-1]])("rejeita id de fiscalizador inválido (%o) sem consultar o banco", async (id) => {
    await expect(visitaService.criar(dadosVisita, [id])).rejects.toThrow(
      "O usuário informado não é um fiscalizador cadastrado"
    );
    expect(Usuario.findByPk).not.toHaveBeenCalled();
  });

  it("conta o fiscalizador repetido uma vez só", async () => {
    const visitaCriada = criarVisitaFalsa(dadosVisita);
    Visita.create.mockResolvedValue(visitaCriada);
    Visita.findByPk.mockResolvedValue({ id: 10 });

    await visitaService.criar(dadosVisita, [2, 2]);

    expect(visitaCriada.setFiscalizadores).toHaveBeenCalledWith([2], { transaction: transacao });
    expect(transacao.commit).toHaveBeenCalledTimes(1);
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

describe("buscar visita para checar acesso", () => {
  it("busca só o id, o status e os ids dos fiscalizadores", async () => {
    Visita.findByPk.mockResolvedValue({ id: 10 });

    const resultado = await visitaService.buscarParaAcesso(10);

    expect(Visita.findByPk).toHaveBeenCalledWith(10, {
      attributes: ["id", "status"],
      include: [
        expect.objectContaining({
          as: "fiscalizadores",
          attributes: ["id"],
          through: { attributes: [] },
        }),
      ],
    });
    expect(resultado).toEqual({ id: 10 });
  });
});

describe("atualizar visita", () => {
  beforeEach(() => {
    Documento.findOne.mockResolvedValue(null);
  });

  it("trava a visita, atualiza só os campos permitidos e troca os fiscalizadores", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValueOnce(visita).mockResolvedValueOnce({ id: 10 });

    const resultado = await visitaService.atualizar(
      10,
      {
        denunciado: "Novo Mercado",
        data_realizacao: "2026-10-21T10:00:00Z",
        latitude: -23.5,
        longitude: -46.6,
        campoInvalido: "x",
      },
      [4]
    );

    expect(Visita.findByPk).toHaveBeenNthCalledWith(1, 10, {
      transaction: transacao,
      lock: transacao.LOCK.UPDATE,
    });
    expect(Documento.findOne).toHaveBeenCalledWith({
      attributes: ["id"],
      where: { visita_id: 10 },
      transaction: transacao,
    });
    expect(visita.update).toHaveBeenCalledWith(
      { denunciado: "Novo Mercado" },
      { transaction: transacao }
    );
    expect(visita.setFiscalizadores).toHaveBeenCalledWith([4], {
      transaction: transacao,
    });
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ id: 10 });
  });

  it("permite corrigir os dados do estabelecimento antes do documento", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValueOnce(visita).mockResolvedValueOnce({ id: 10 });

    await visitaService.atualizar(10, { cnpj_cpf: "12.345.678/0001-90", bairro: "Piedade" });

    expect(visita.update).toHaveBeenCalledWith(
      { cnpj_cpf: "12.345.678/0001-90", bairro: "Piedade" },
      { transaction: transacao }
    );
  });

  it("rejeita trocar para um usuário que não é fiscalizador", async () => {
    Usuario.findByPk.mockResolvedValue({ id: 3, role: "gestor" });

    await expect(visitaService.atualizar(10, {}, [3])).rejects.toThrow(
      "O usuário informado não é um fiscalizador cadastrado"
    );
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("não mexe nos fiscalizadores quando a lista não é enviada", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValueOnce(visita).mockResolvedValueOnce({ id: 10 });

    await visitaService.atualizar(10, { observacoes_livres: "ok" });

    expect(visita.setFiscalizadores).not.toHaveBeenCalled();
  });

  it("rejeita editar a visita depois que o documento foi gerado", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValue(visita);
    Documento.findOne.mockResolvedValue({ id: 7 });

    await expect(visitaService.atualizar(10, { denunciado: "Outro" }, [4])).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "O documento da visita já foi gerado; a visita não pode mais ser editada",
    });
    expect(visita.update).not.toHaveBeenCalled();
    expect(visita.setFiscalizadores).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it.each([[[]], [[2, 3]]])("rejeita trocar para %o fiscalizadores sem abrir transação", async (ids) => {
    await expect(visitaService.atualizar(10, {}, ids)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "A visita deve ter exatamente um agente fiscalizador",
    });
    expect(sequelize.transaction).not.toHaveBeenCalled();
    expect(Visita.findByPk).not.toHaveBeenCalled();
  });

  it("desfaz a transação quando a atualização falha", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    visita.update.mockRejectedValue(new Error("erro"));
    Visita.findByPk.mockResolvedValue(visita);

    await expect(visitaService.atualizar(10, { denunciado: "Novo Nome" })).rejects.toThrow();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(transacao.commit).not.toHaveBeenCalled();
  });

  it("retorna null e desfaz a transação quando a visita não existe", async () => {
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.atualizar(99, { denunciado: "Novo Nome" })).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(Documento.findOne).not.toHaveBeenCalled();
  });
});

describe("iniciar visita", () => {
  const coordenadas = { latitude: -8.1127, longitude: -35.0147 };
  const visitaAgendada = { id: 10, status: "agendada" };

  it("confere o status, grava a data e a localização condicionando ao status agendada", async () => {
    Visita.findByPk
      .mockResolvedValueOnce(visitaAgendada)
      .mockResolvedValueOnce({ id: 10, status: "em_andamento" });
    Visita.update.mockResolvedValue([1]);

    const resultado = await visitaService.iniciar(10, coordenadas);

    expect(Visita.findByPk).toHaveBeenNthCalledWith(1, 10, { attributes: ["id", "status"] });
    expect(Visita.update).toHaveBeenCalledWith(
      {
        status: "em_andamento",
        data_realizacao: expect.any(Date),
        latitude: -8.1127,
        longitude: -35.0147,
      },
      { where: { id: 10, status: "agendada" } }
    );
    expect(resultado).toEqual({ id: 10, status: "em_andamento" });
  });

  it("aceita os limites extremos das coordenadas", async () => {
    Visita.findByPk.mockResolvedValue(visitaAgendada);
    Visita.update.mockResolvedValue([1]);

    await visitaService.iniciar(10, { latitude: -90, longitude: 180 });

    expect(Visita.update).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: -90, longitude: 180 }),
      expect.anything()
    );
  });

  it.each([
    ["sem corpo", undefined],
    ["sem latitude", { longitude: -35 }],
    ["sem longitude", { latitude: -8 }],
    ["latitude como texto", { latitude: "-8.1", longitude: -35 }],
    ["latitude acima de 90", { latitude: 90.5, longitude: -35 }],
    ["longitude abaixo de -180", { latitude: -8, longitude: -180.1 }],
    ["valor não finito", { latitude: Number.NaN, longitude: -35 }],
  ])("rejeita coordenadas inválidas (%s) sem alterar a visita", async (_caso, dados) => {
    Visita.findByPk.mockResolvedValue(visitaAgendada);

    await expect(visitaService.iniciar(10, dados)).rejects.toMatchObject({
      name: "ValidacaoError",
    });
    expect(Visita.update).not.toHaveBeenCalled();
  });

  it("lista os dois erros quando latitude e longitude são inválidas", async () => {
    Visita.findByPk.mockResolvedValue(visitaAgendada);

    await expect(visitaService.iniciar(10, {})).rejects.toMatchObject({
      errors: [
        { message: "A latitude deve ser um número entre -90 e 90" },
        { message: "A longitude deve ser um número entre -180 e 180" },
      ],
    });
  });

  it.each(["em_andamento", "concluida", "cancelada"])(
    "responde o erro de status, e não o de localização, para visita %s",
    async (status) => {
      Visita.findByPk.mockResolvedValue({ id: 10, status });

      await expect(visitaService.iniciar(10, undefined)).rejects.toMatchObject({
        name: "ValidacaoError",
        message: "Somente visitas agendadas podem ser iniciadas",
      });
      expect(Visita.update).not.toHaveBeenCalled();
    }
  );

  it("retorna null quando a visita não existe, sem validar a localização", async () => {
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.iniciar(99, undefined)).toBeNull();
    expect(Visita.update).not.toHaveBeenCalled();
  });

  it("rejeita quando nenhuma linha é alterada e a visita existe, como em requisição simultânea", async () => {
    Visita.findByPk
      .mockResolvedValueOnce(visitaAgendada)
      .mockResolvedValueOnce({ id: 10, status: "em_andamento" });
    Visita.update.mockResolvedValue([0]);

    await expect(visitaService.iniciar(10, coordenadas)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Somente visitas agendadas podem ser iniciadas",
    });
  });

  it("propaga o erro quando a atualização falha", async () => {
    Visita.findByPk.mockResolvedValue(visitaAgendada);
    Visita.update.mockRejectedValue(new Error("falha no banco"));

    await expect(visitaService.iniciar(10, coordenadas)).rejects.toThrow("falha no banco");
  });
});

describe("concluir visita", () => {
  beforeEach(() => {
    Visita.findByPk.mockResolvedValueOnce({ id: 10, status: "em_andamento" });
    Documento.findOne.mockResolvedValue({ id: 7, url_arquivo_pdf: "visitas/10/documentos/a.pdf" });
  });

  it("trava a visita, confere o documento e conclui", async () => {
    Visita.update.mockResolvedValue([1]);
    Visita.findByPk.mockResolvedValueOnce({ id: 10, status: "concluida" });

    const resultado = await visitaService.concluir(10);

    expect(Visita.findByPk).toHaveBeenNthCalledWith(1, 10, {
      attributes: ["id", "status"],
      transaction: transacao,
      lock: transacao.LOCK.UPDATE,
    });
    expect(Documento.findOne).toHaveBeenCalledWith({
      attributes: ["id", "url_arquivo_pdf"],
      where: { visita_id: 10 },
      transaction: transacao,
    });
    expect(Visita.update).toHaveBeenCalledWith(
      { status: "concluida" },
      { where: { id: 10 }, transaction: transacao }
    );
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(resultado).toEqual({ id: 10, status: "concluida" });
  });

  it("rejeita concluir a visita sem documento gerado", async () => {
    Documento.findOne.mockResolvedValue(null);

    await expect(visitaService.concluir(10)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Gere o documento da visita antes de concluí-la",
    });
    expect(Visita.update).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("rejeita concluir a visita antes de o PDF ser gerado", async () => {
    Documento.findOne.mockResolvedValue({ id: 7, url_arquivo_pdf: null });

    await expect(visitaService.concluir(10)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Colete todas as assinaturas e gere o PDF antes de concluir a visita",
    });
    expect(Visita.update).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["agendada", { id: 7, url_arquivo_pdf: null }],
    ["cancelada", null],
    ["concluida", { id: 7, url_arquivo_pdf: null }],
  ])("rejeita visita com status %s", async (status, documento) => {
    Visita.findByPk.mockReset();
    Visita.findByPk.mockResolvedValue({ id: 10, status });
    Documento.findOne.mockResolvedValue(documento);

    await expect(visitaService.concluir(10)).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Somente visitas em andamento podem ser concluídas",
    });
    expect(Visita.update).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("responde com a visita quando ela já foi concluída pela geração do PDF", async () => {
    Visita.findByPk.mockReset();
    Visita.findByPk
      .mockResolvedValueOnce({ id: 10, status: "concluida" })
      .mockResolvedValueOnce({ id: 10, status: "concluida" });

    const resultado = await visitaService.concluir(10);

    expect(resultado).toEqual({ id: 10, status: "concluida" });
    expect(Visita.update).not.toHaveBeenCalled();
    expect(transacao.commit).toHaveBeenCalledTimes(1);
  });

  it("retorna null e desfaz a transação quando a visita não existe", async () => {
    Visita.findByPk.mockReset();
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.concluir(99)).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("desfaz a transação quando a atualização falha", async () => {
    Visita.update.mockRejectedValue(new Error("falha no banco"));

    await expect(visitaService.concluir(10)).rejects.toThrow("falha no banco");
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(transacao.commit).not.toHaveBeenCalled();
  });
});

describe("remover visita", () => {
  it("remove a visita encontrada", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValue(visita);
    Documento.findOne.mockResolvedValue(null);

    const resultado = await visitaService.remover(10);

    expect(visita.destroy).toHaveBeenCalledTimes(1);
    expect(resultado).toBe(visita);
  });

  it("retorna null quando a visita não existe", async () => {
    Visita.findByPk.mockResolvedValue(null);

    expect(await visitaService.remover(99)).toBeNull();
  });

  it("recusa a remoção quando o documento da visita já foi gerado", async () => {
    const visita = criarVisitaFalsa(dadosVisita);
    Visita.findByPk.mockResolvedValue(visita);
    Documento.findOne.mockResolvedValue({ id: 3 });

    await expect(visitaService.remover(10)).rejects.toThrow(
      "O documento da visita já foi gerado; a visita não pode mais ser apagada"
    );
    expect(visita.destroy).not.toHaveBeenCalled();
  });
});

describe("validações do modelo Visita", () => {
  it("aceita uma visita válida e usa 'agendada' como status padrão", async () => {
    const visita = VisitaModelo.build(dadosVisita);

    await expect(visita.validate()).resolves.toBeDefined();
    expect(visita.status).toBe("agendada");
  });

  it("tem os dados do estabelecimento como opcionais", () => {
    const atributos = VisitaModelo.getAttributes();

    for (const campo of ["razao_social", "nome_fantasia", "endereco", "bairro", "cep", "telefone", "cnpj_cpf", "atividade"]) {
      expect(atributos[campo].allowNull).toBe(true);
    }
  });

  it("remove espaços das pontas e grava texto vazio como null", () => {
    const visita = VisitaModelo.build({ ...dadosVisita, razao_social: "  Mercado LTDA  ", bairro: "   ", cep: "" });

    expect(visita.razao_social).toBe("Mercado LTDA");
    expect(visita.bairro).toBeNull();
    expect(visita.cep).toBeNull();
  });

  it.each(["razao_social", "nome_fantasia", "endereco", "bairro", "cep", "telefone", "cnpj_cpf", "atividade"])(
    "limita %s a 255 caracteres",
    async (campo) => {
      await expect(
        VisitaModelo.build({ ...dadosVisita, [campo]: "a".repeat(255) }).validate()
      ).resolves.toBeDefined();
      await expect(
        VisitaModelo.build({ ...dadosVisita, [campo]: "a".repeat(256) }).validate()
      ).rejects.toThrow("deve ter no máximo 255 caracteres");
    }
  );

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

describe("associações do modelo Visita", () => {
  it("configura as associações com Usuario, VisitaFiscalizador, RespostaQuestionario e Documento", () => {
    const modelsMock = {
      Usuario: { name: "Usuario" },
      VisitaFiscalizador: { name: "VisitaFiscalizador" },
      RespostaQuestionario: { name: "RespostaQuestionario" },
      Documento: { name: "Documento" },
    };

    const belongsToSpy = vi.spyOn(VisitaModelo, "belongsTo").mockImplementation(() => {});
    const belongsToManySpy = vi.spyOn(VisitaModelo, "belongsToMany").mockImplementation(() => {});
    const hasManySpy = vi.spyOn(VisitaModelo, "hasMany").mockImplementation(() => {});

    VisitaModelo.associate(modelsMock);

    expect(belongsToSpy).toHaveBeenCalledWith(modelsMock.Usuario, {
      foreignKey: "gestor_id",
      as: "gestor",
      onDelete: "RESTRICT",
    });

    expect(belongsToManySpy).toHaveBeenCalledWith(modelsMock.Usuario, {
      through: modelsMock.VisitaFiscalizador,
      foreignKey: "visita_id",
      otherKey: "fiscalizador_id",
      as: "fiscalizadores",
    });

    expect(hasManySpy).toHaveBeenCalledWith(modelsMock.RespostaQuestionario, {
      foreignKey: "visita_id",
      as: "respostas",
      onDelete: "CASCADE",
    });

    expect(hasManySpy).toHaveBeenCalledWith(modelsMock.Documento, {
      foreignKey: "visita_id",
      as: "documentos",
      onDelete: "CASCADE",
    });
  });
});

describe("relacionamento visita <-> fiscalizadores (DT-06)", () => {
  it("lista fiscalizadores da visita sem senha_hash", async () => {
    const visita = criarVisitaFalsa();
    const lista = [{ id: 5, nome: "Ana" }];
    visita.getFiscalizadores.mockResolvedValue(lista);
    Visita.findByPk.mockResolvedValue(visita);

    const resultado = await visitaService.listarFiscalizadores(10);

    expect(visita.getFiscalizadores).toHaveBeenCalledWith({
      attributes: { exclude: ["senha_hash"] },
      joinTableAttributes: [],
    });
    expect(resultado).toEqual(lista);
  });

  it("adiciona fiscalizador quando a visita ainda não possui vínculo", async () => {
    const visita = criarVisitaFalsa();
    visita.getFiscalizadores
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: 5, nome: "Ana" }]);
    Visita.findByPk.mockResolvedValue(visita);
    Documento.findOne.mockResolvedValue(null);

    const resultado = await visitaService.adicionarFiscalizador(10, 5);

    expect(visita.addFiscalizador).toHaveBeenCalledWith(5, {
      transaction: sequelize.transacao,
    });
    expect(resultado).toEqual([{ id: 5, nome: "Ana" }]);
  });

  it("recusa adicionar fiscalizador se a visita já possui um", async () => {
    const visita = criarVisitaFalsa();
    visita.getFiscalizadores.mockResolvedValueOnce([{ id: 5 }]);
    Visita.findByPk.mockResolvedValue(visita);
    Documento.findOne.mockResolvedValue(null);

    await expect(visitaService.adicionarFiscalizador(10, 6)).rejects.toThrow(
      "A visita já possui fiscalizador vinculado; utilize PUT para substituí-lo"
    );
    expect(visita.addFiscalizador).not.toHaveBeenCalled();
  });

  it("substitui fiscalizadores e bloqueia alteração após documento gerado", async () => {
    const visita = criarVisitaFalsa();
    visita.getFiscalizadores.mockResolvedValue([{ id: 7, nome: "Bruno" }]);
    Visita.findByPk.mockResolvedValue(visita);
    Documento.findOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 1 });

    const resultado = await visitaService.substituirFiscalizadores(10, [7]);
    expect(visita.setFiscalizadores).toHaveBeenCalledWith([7], {
      transaction: sequelize.transacao,
    });
    expect(resultado).toEqual([{ id: 7, nome: "Bruno" }]);

    await expect(visitaService.substituirFiscalizadores(10, [8])).rejects.toThrow(
      "O documento da visita já foi gerado; os fiscalizadores não podem mais ser alterados"
    );
  });

  it("remove fiscalizador vinculado e sinaliza naoVinculado se não estiver associado", async () => {
    const visita = criarVisitaFalsa();
    Visita.findByPk.mockResolvedValue(visita);
    Documento.findOne.mockResolvedValue(null);

    visita.getFiscalizadores.mockResolvedValueOnce([]);
    expect(await visitaService.removerFiscalizador(10, 99)).toEqual({
      naoVinculado: true,
    });

    visita.getFiscalizadores.mockResolvedValueOnce([]);
    expect(await visitaService.removerFiscalizador(10, 99)).toEqual({
      naoVinculado: true,
    });

    visita.getFiscalizadores.mockResolvedValueOnce([{ id: 5 }]);
    await expect(
      visitaService.removerFiscalizador(10, "5")
    ).resolves.toEqual({ removido: true });
    expect(visita.removeFiscalizador).toHaveBeenCalledWith(5, {
      transaction: sequelize.transacao,
    });
  });
});

describe("regras de proteção na edição, remoção e vínculo (revisão PR #76)", () => {
  it("permite cancelar visita agendada ou em andamento no atualizar e recusa outros status", async () => {
    const visita = criarVisitaFalsa({ status: "agendada" });
    Visita.findByPk.mockResolvedValue(visita);
    Documento.findOne.mockResolvedValue(null);

    await visitaService.atualizar(10, { status: "cancelada" });
    expect(visita.update).toHaveBeenCalledWith(
      { status: "cancelada" },
      { transaction: sequelize.transacao }
    );

    await expect(
      visitaService.atualizar(10, { status: "concluida" })
    ).rejects.toThrow("Na edição da visita, o único status permitido é 'cancelada'");
  });

  it("recusa atualizar gestor_id para usuário sem perfil de gestor", async () => {
    const visita = criarVisitaFalsa({ status: "agendada" });
    Visita.findByPk.mockResolvedValue(visita);
    Usuario.findByPk.mockResolvedValueOnce({ id: 5, role: "fiscalizador" });

    await expect(
      visitaService.atualizar(10, { gestor_id: 5 })
    ).rejects.toThrow("O gestor informado não existe ou não possui perfil de gestor");
  });

  it("recusa remoção de visita e alteração de fiscalizadores quando a visita não está agendada", async () => {
    const visitaEmAndamento = criarVisitaFalsa({ status: "em_andamento" });
    Visita.findByPk.mockResolvedValue(visitaEmAndamento);

    await expect(visitaService.remover(10)).rejects.toThrow(
      "Somente visitas agendadas podem ser apagadas"
    );
    await expect(
      visitaService.substituirFiscalizadores(10, [5])
    ).rejects.toThrow(
      "Só é possível alterar fiscalizadores de visitas agendadas"
    );
  });
});