import { beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import models from "../models/index.js";
import questionarioService from "../services/questionarioService.js";
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

beforeEach(() => {
  vi.clearAllMocks();
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
