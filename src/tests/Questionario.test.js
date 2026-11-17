import { beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import models, { sequelize } from "../models/index.js";
import questionarioService from "../services/questionarioService.js";
import questionarioController from "../controllers/questionarioController.js";
import visitaService from "../services/visitaService.js";
import getPerguntaQuestionarioModel from "../models/perguntaQuestionario.js";

vi.mock("../models/index.js", () => {
  const transacao = { commit: vi.fn(), rollback: vi.fn() };

  return {
    sequelize: {
      transaction: vi.fn(async () => transacao),
      transacao,
    },
    default: {
      PerguntaQuestionario: {
        findAll: vi.fn(),
      },
      RespostaQuestionario: {
        upsert: vi.fn(),
        findAll: vi.fn(),
      },
    },
  };
});

const { PerguntaQuestionario, RespostaQuestionario } = models;
const { transacao } = sequelize;

const sequelizeTeste = new Sequelize("postgres://teste:teste@localhost:5432/teste", {
  dialect: "postgres",
  dialectModule: pg,
  logging: false,
});
const PerguntaQuestionarioModelo = getPerguntaQuestionarioModel(sequelizeTeste, Sequelize);

const dadosPergunta = {
  texto: "O estabelecimento possui alvará?",
  tipo_resposta: "sim_nao",
  ordem: 1,
};

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

describe("listar questionário", () => {
  it("lista as perguntas ordenadas pelo campo ordem", async () => {
    const perguntas = [{ id: 1, ordem: 1 }, { id: 2, ordem: 2 }];
    PerguntaQuestionario.findAll.mockResolvedValue(perguntas);

    const resultado = await questionarioService.listar();

    expect(PerguntaQuestionario.findAll).toHaveBeenCalledWith({
      order: [["ordem", "ASC"]],
    });
    expect(resultado).toEqual(perguntas);
  });
});

describe("questionarioController.listar", () => {
  it("retorna 200 e a lista de perguntas quando bem-sucedido", async () => {
    const req = {};
    const res = criarRes();
    const perguntas = [{ id: 1, texto: "Pergunta 1", ordem: 1 }];

    vi.spyOn(questionarioService, "listar").mockResolvedValueOnce(perguntas);

    await questionarioController.listar(req, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(perguntas);
  });

  it("retorna 500 quando ocorre um erro ao listar", async () => {
    const req = {};
    const res = criarRes();

    vi.spyOn(questionarioService, "listar").mockRejectedValueOnce(new Error("Erro de banco"));

    await questionarioController.listar(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      mensagem: "Erro ao listar questionário",
    });
  });
});

describe("validações do modelo PerguntaQuestionario", () => {
  it("aceita uma pergunta válida e usa 'texto' como tipo padrão", async () => {
    const pergunta = PerguntaQuestionarioModelo.build({
      texto: dadosPergunta.texto,
      ordem: dadosPergunta.ordem,
    });

    await expect(pergunta.validate()).resolves.toBeDefined();
    expect(pergunta.tipo_resposta).toBe("texto");
  });

  it("exige texto não vazio", async () => {
    await expect(
      PerguntaQuestionarioModelo.build({ ...dadosPergunta, texto: "" }).validate()
    ).rejects.toThrow();
  });

  it("exige ordem maior ou igual a 1", async () => {
    await expect(
      PerguntaQuestionarioModelo.build({ ...dadosPergunta, ordem: 0 }).validate()
    ).rejects.toThrow();
  });
});

describe("salvar respostas do questionário", () => {
  const visitaEmAndamento = { id: 10, status: "em_andamento" };
  const perguntas = [
    { id: 1, tipo_resposta: "sim_nao" },
    { id: 2, tipo_resposta: "numero" },
    { id: 3, tipo_resposta: "data" },
    { id: 4, tipo_resposta: "texto" },
  ];
  const respostasValidas = [
    { pergunta_id: 1, resposta: "Sim" },
    { pergunta_id: 2, resposta: "3,5" },
    { pergunta_id: 3, resposta: "29/02/2028" },
    { pergunta_id: 4, resposta: "  Produtos sem preço na vitrine  " },
  ];

  it("grava cada resposta com upsert na mesma transação e devolve as respostas da visita", async () => {
    PerguntaQuestionario.findAll.mockResolvedValue(perguntas);
    RespostaQuestionario.findAll.mockResolvedValue([{ pergunta_id: 1 }]);

    const resultado = await questionarioService.salvarRespostas(
      visitaEmAndamento,
      respostasValidas
    );

    expect(PerguntaQuestionario.findAll).toHaveBeenCalledWith({ where: { id: [1, 2, 3, 4] } });
    expect(RespostaQuestionario.upsert).toHaveBeenCalledTimes(4);
    expect(RespostaQuestionario.upsert).toHaveBeenCalledWith(
      { visita_id: 10, pergunta_id: 4, resposta: "Produtos sem preço na vitrine" },
      { transaction: transacao, conflictFields: ["visita_id", "pergunta_id"] }
    );
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(transacao.rollback).not.toHaveBeenCalled();
    expect(RespostaQuestionario.findAll).toHaveBeenCalledWith({
      where: { visita_id: 10 },
      order: [["pergunta_id", "ASC"]],
    });
    expect(resultado).toEqual([{ pergunta_id: 1 }]);
  });

  it.each(["agendada", "concluida", "cancelada"])("rejeita visita com status %s", async (status) => {
    await expect(
      questionarioService.salvarRespostas({ id: 10, status }, respostasValidas)
    ).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "Só é possível responder o questionário de visitas em andamento",
    });
    expect(RespostaQuestionario.upsert).not.toHaveBeenCalled();
  });

  it.each([
    ["lista ausente", undefined],
    ["lista vazia", []],
    ["pergunta_id ausente", [{ resposta: "Sim" }]],
    ["pergunta_id não inteiro", [{ pergunta_id: "1", resposta: "Sim" }]],
    ["resposta vazia", [{ pergunta_id: 1, resposta: "   " }]],
    ["resposta que não é texto", [{ pergunta_id: 1, resposta: 5 }]],
    [
      "pergunta repetida",
      [
        { pergunta_id: 1, resposta: "Sim" },
        { pergunta_id: 1, resposta: "Não" },
      ],
    ],
  ])("rejeita %s sem consultar o banco", async (_caso, respostas) => {
    await expect(
      questionarioService.salvarRespostas(visitaEmAndamento, respostas)
    ).rejects.toMatchObject({ name: "ValidacaoError" });
    expect(PerguntaQuestionario.findAll).not.toHaveBeenCalled();
  });

  it("lista todas as respostas inválidas e perguntas inexistentes de uma vez", async () => {
    PerguntaQuestionario.findAll.mockResolvedValue(perguntas);

    await expect(
      questionarioService.salvarRespostas(visitaEmAndamento, [
        { pergunta_id: 1, resposta: "Talvez" },
        { pergunta_id: 2, resposta: "doze" },
        { pergunta_id: 3, resposta: "31/02/2026" },
        { pergunta_id: 99, resposta: "Sim" },
      ])
    ).rejects.toMatchObject({
      message: "Há respostas inválidas",
      errors: [
        { message: 'Resposta da pergunta 1 deve ser "Sim" ou "Não"' },
        { message: "Resposta da pergunta 2 deve ser um número" },
        { message: "Resposta da pergunta 3 deve ser uma data válida no formato DD/MM/AAAA" },
        { message: "A pergunta 99 não existe" },
      ],
    });
    expect(sequelize.transaction).not.toHaveBeenCalled();
  });

  it("desfaz a transação quando uma gravação falha", async () => {
    PerguntaQuestionario.findAll.mockResolvedValue(perguntas);
    RespostaQuestionario.upsert
      .mockResolvedValueOnce([{}])
      .mockRejectedValueOnce(new Error("falha no banco"));

    await expect(
      questionarioService.salvarRespostas(visitaEmAndamento, respostasValidas)
    ).rejects.toThrow("falha no banco");
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(transacao.commit).not.toHaveBeenCalled();
  });
});

describe("questionarioController.salvarRespostas", () => {
  it("responde 404 quando a visita não pertence ao fiscalizador", async () => {
    const req = { params: { id: "10" }, usuario: { id: 6 }, body: { respostas: [] } };
    const res = criarRes();
    vi.spyOn(visitaService, "buscarPorId").mockResolvedValueOnce({
      id: 10,
      fiscalizadores: [{ id: 5 }],
    });
    const salvar = vi.spyOn(questionarioService, "salvarRespostas");

    await questionarioController.salvarRespostas(req, res);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(salvar).not.toHaveBeenCalled();
  });
});