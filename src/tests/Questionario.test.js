import { beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import models from "../models/index.js";
import questionarioService from "../services/questionarioService.js";
import questionarioController from "../controllers/questionarioController.js";
import getPerguntaQuestionarioModel from "../models/perguntaQuestionario.js";

vi.mock("../models/index.js", () => ({
  default: {
    PerguntaQuestionario: {
      findAll: vi.fn(),
    },
  },
}));

const { PerguntaQuestionario } = models;

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