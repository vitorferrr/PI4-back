import { beforeEach, describe, expect, it, vi } from "vitest";
import Sequelize from "sequelize";
import pg from "pg";
import models, { sequelize } from "../models/index.js";
import questionarioService from "../services/questionarioService.js";
import questionarioController from "../controllers/questionarioController.js";
import getPerguntaQuestionarioModel from "../models/perguntaQuestionario.js";

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
      },
      PerguntaQuestionario: {
        findAll: vi.fn(),
        findByPk: vi.fn(),
        create: vi.fn(),
      },
      RespostaQuestionario: {
        bulkCreate: vi.fn(),
        findAll: vi.fn(),
        findOne: vi.fn(),
      },
      Visita: {
        findByPk: vi.fn(),
      },
    },
  };
});

const { Documento, PerguntaQuestionario, RespostaQuestionario, Visita } = models;
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

  it("deixa o erro do service subir para o middleware global de erro", async () => {
    const req = {};
    const res = criarRes();
    const erro = new Error("Erro de banco");

    vi.spyOn(questionarioService, "listar").mockRejectedValueOnce(erro);

    await expect(questionarioController.listar(req, res)).rejects.toBe(erro);
    expect(res.status).not.toHaveBeenCalled();
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
  const opcoesBulkCreate = {
    transaction: transacao,
    updateOnDuplicate: ["resposta", "updatedAt"],
    conflictAttributes: ["visita_id", "pergunta_id"],
  };

  beforeEach(() => {
    Visita.findByPk.mockResolvedValue({ id: 10, status: "em_andamento" });
    Documento.findOne.mockResolvedValue(null);
    PerguntaQuestionario.findAll.mockResolvedValue(perguntas);
  });

  it("trava a visita, grava tudo em uma consulta e devolve as respostas da visita", async () => {
    RespostaQuestionario.findAll.mockResolvedValue([{ pergunta_id: 1 }]);

    const resultado = await questionarioService.salvarRespostas(10, respostasValidas);

    expect(Visita.findByPk).toHaveBeenCalledWith(10, {
      attributes: ["id", "status"],
      transaction: transacao,
      lock: transacao.LOCK.UPDATE,
    });
    expect(PerguntaQuestionario.findAll).toHaveBeenCalledWith({
      where: { id: [1, 2, 3, 4] },
      transaction: transacao,
    });
    expect(RespostaQuestionario.bulkCreate).toHaveBeenCalledTimes(1);
    expect(RespostaQuestionario.bulkCreate).toHaveBeenCalledWith(
      [
        { visita_id: 10, pergunta_id: 1, resposta: "Sim" },
        { visita_id: 10, pergunta_id: 2, resposta: "3,5" },
        { visita_id: 10, pergunta_id: 3, resposta: "29/02/2028" },
        { visita_id: 10, pergunta_id: 4, resposta: "Produtos sem preço na vitrine" },
      ],
      opcoesBulkCreate
    );
    expect(transacao.commit).toHaveBeenCalledTimes(1);
    expect(transacao.rollback).not.toHaveBeenCalled();
    expect(RespostaQuestionario.findAll).toHaveBeenCalledWith({
      where: { visita_id: 10 },
      include: [
        {
          model: PerguntaQuestionario,
          as: "pergunta",
          attributes: ["id", "texto", "tipo_resposta", "ordem"],
        },
      ],
      order: [
        [
          {
            model: PerguntaQuestionario,
            as: "pergunta",
            attributes: ["id", "texto", "tipo_resposta", "ordem"],
          },
          "ordem",
          "ASC",
        ],
      ],
    });
    expect(RespostaQuestionario.findAll.mock.invocationCallOrder[0]).toBeGreaterThan(
      transacao.commit.mock.invocationCallOrder[0]
    );
    expect(resultado).toEqual([{ pergunta_id: 1 }]);
  });

  it("devolve null e desfaz a transação quando a visita não existe mais", async () => {
    Visita.findByPk.mockResolvedValue(null);

    expect(await questionarioService.salvarRespostas(10, respostasValidas)).toBeNull();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(RespostaQuestionario.bulkCreate).not.toHaveBeenCalled();
  });

  it.each(["agendada", "concluida", "cancelada"])(
    "rejeita visita com status %s, conferido com a linha travada",
    async (status) => {
      Visita.findByPk.mockResolvedValue({ id: 10, status });

      await expect(
        questionarioService.salvarRespostas(10, respostasValidas)
      ).rejects.toMatchObject({
        name: "ValidacaoError",
        message: "As respostas só podem ser alteradas em visitas em andamento",
      });
      expect(RespostaQuestionario.bulkCreate).not.toHaveBeenCalled();
      expect(transacao.rollback).toHaveBeenCalledTimes(1);
    }
  );

  it("rejeita alterar as respostas depois que o documento foi gerado", async () => {
    Documento.findOne.mockResolvedValue({ id: 7 });

    await expect(
      questionarioService.salvarRespostas(10, respostasValidas)
    ).rejects.toMatchObject({
      name: "ValidacaoError",
      message: "O documento da visita já foi gerado; as respostas não podem mais ser alteradas",
    });
    expect(Documento.findOne).toHaveBeenCalledWith({
      attributes: ["id"],
      where: { visita_id: 10 },
      transaction: transacao,
    });
    expect(RespostaQuestionario.bulkCreate).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("confere o status antes de validar as respostas", async () => {
    Visita.findByPk.mockResolvedValue({ id: 10, status: "concluida" });

    await expect(questionarioService.salvarRespostas(10, [])).rejects.toMatchObject({
      message: "As respostas só podem ser alteradas em visitas em andamento",
    });
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
  ])("rejeita %s sem consultar as perguntas", async (_caso, respostas) => {
    await expect(questionarioService.salvarRespostas(10, respostas)).rejects.toMatchObject({
      name: "ValidacaoError",
    });
    expect(PerguntaQuestionario.findAll).not.toHaveBeenCalled();
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
  });

  it("lista todas as respostas inválidas e perguntas inexistentes de uma vez", async () => {
    await expect(
      questionarioService.salvarRespostas(10, [
        { pergunta_id: 1, resposta: "Talvez" },
        { pergunta_id: 2, resposta: "doze" },
        { pergunta_id: 3, resposta: "31/02/2026" },
        { pergunta_id: 99, resposta: "Sim" },
      ])
    ).rejects.toMatchObject({
      message: "Há respostas inválidas",
      errors: [
        { message: 'Resposta da pergunta 1 deve ser "Sim", "Não" ou "Não se aplica"' },
        { message: "Resposta da pergunta 2 deve ser um número" },
        { message: "Resposta da pergunta 3 deve ser uma data válida no formato DD/MM/AAAA" },
        { message: "A pergunta 99 não existe" },
      ],
    });
    expect(RespostaQuestionario.bulkCreate).not.toHaveBeenCalled();
  });

  it.each(["01/01/0050", "31/12/1899"])("rejeita a data %s, com ano anterior a 1900", async (data) => {
    await expect(
      questionarioService.salvarRespostas(10, [{ pergunta_id: 3, resposta: data }])
    ).rejects.toMatchObject({
      errors: [{ message: "Resposta da pergunta 3 deve ser uma data válida no formato DD/MM/AAAA" }],
    });
  });

  it('aceita "Não se aplica" nas perguntas de sim ou não', async () => {
    RespostaQuestionario.findAll.mockResolvedValue([]);

    await questionarioService.salvarRespostas(10, [{ pergunta_id: 1, resposta: "Não se aplica" }]);

    expect(RespostaQuestionario.bulkCreate).toHaveBeenCalledWith(
      [{ visita_id: 10, pergunta_id: 1, resposta: "Não se aplica" }],
      opcoesBulkCreate
    );
  });

  it("desfaz a transação quando a gravação falha", async () => {
    RespostaQuestionario.bulkCreate.mockRejectedValueOnce(new Error("falha no banco"));

    await expect(questionarioService.salvarRespostas(10, respostasValidas)).rejects.toThrow(
      "falha no banco"
    );
    expect(transacao.rollback).toHaveBeenCalledTimes(1);
    expect(transacao.commit).not.toHaveBeenCalled();
  });
});

describe("questionarioController.salvarRespostas", () => {
  // Quem barra o fiscal de outra visita é o ownershipMiddleware (403); aqui a
  // visita já chega conferida em req.visita.
  it("responde 404 quando a visita some antes de gravar", async () => {
    const req = {
      params: { id: "10" },
      usuario: { id: 5, role: "fiscalizador" },
      visita: { id: 10, fiscalizadores: [{ id: 5 }] },
      body: { respostas: [] },
    };
    const res = criarRes();
    vi.spyOn(questionarioService, "salvarRespostas").mockResolvedValueOnce(null);

    await expect(questionarioController.salvarRespostas(req, res)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("CRUD de perguntas (questionarioService)", () => {
  it("busca pergunta por id", async () => {
    const pergunta = { id: 1, texto: "Tem alvará?", tipo_resposta: "sim_nao", ordem: 1 };
    models.PerguntaQuestionario.findByPk.mockResolvedValueOnce(pergunta);

    const resultado = await questionarioService.buscarPorId(1);

    expect(resultado).toEqual(pergunta);
    expect(models.PerguntaQuestionario.findByPk).toHaveBeenCalledWith(1);
  });

  it("cria pergunta válida com texto normalizado", async () => {
    const criada = { id: 2, texto: "Possui validade?", tipo_resposta: "sim_nao", ordem: 2 };
    models.PerguntaQuestionario.create.mockResolvedValueOnce(criada);

    const resultado = await questionarioService.criar({
      texto: "  Possui validade?  ",
      tipo_resposta: "sim_nao",
      ordem: 2,
    });

    expect(models.PerguntaQuestionario.create).toHaveBeenCalledWith({
      texto: "Possui validade?",
      tipo_resposta: "sim_nao",
      ordem: 2,
    });
    expect(resultado).toEqual(criada);
  });

  it("rejeita criação com texto vazio, tipo_resposta inválido ou ordem não inteira", async () => {
    await expect(
      questionarioService.criar({
        texto: "  ",
        tipo_resposta: "multipla_escolha",
        ordem: 0,
      })
    ).rejects.toMatchObject({
      name: "ValidacaoError",
      errors: [
        { message: "O texto da pergunta é obrigatório" },
        {
          message:
            "tipo_resposta deve ser um dos valores: sim_nao, numero, data, texto",
        },
        { message: "ordem deve ser um número inteiro positivo" },
      ],
    });
  });

  it("atualiza pergunta existente e retorna null se não existir", async () => {
    const update = vi.fn().mockResolvedValueOnce({ id: 1, texto: "Editada", ordem: 3 });
    models.PerguntaQuestionario.findByPk
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 1, update });

    expect(await questionarioService.atualizar(99, { texto: "Editada" })).toBeNull();

    const atualizada = await questionarioService.atualizar(1, {
      texto: " Editada ",
      ordem: 3,
    });

    expect(update).toHaveBeenCalledWith({ texto: "Editada", ordem: 3 });
    expect(atualizada).toEqual({ id: 1, texto: "Editada", ordem: 3 });
  });

  it("remove pergunta sem respostas vinculadas", async () => {
    const destroy = vi.fn().mockResolvedValueOnce();
    const pergunta = { id: 1, destroy };
    models.PerguntaQuestionario.findByPk.mockResolvedValueOnce(pergunta);
    models.RespostaQuestionario.findOne.mockResolvedValueOnce(null);

    const removida = await questionarioService.remover(1);

    expect(destroy).toHaveBeenCalledTimes(1);
    expect(removida).toBe(pergunta);
  });

  it("recusa remoção quando a pergunta já foi respondida em visitas", async () => {
    const destroy = vi.fn();
    models.PerguntaQuestionario.findByPk.mockResolvedValueOnce({ id: 1, destroy });
    models.RespostaQuestionario.findOne.mockResolvedValueOnce({ id: 42 });

    await expect(questionarioService.remover(1)).rejects.toThrow(
      "Pergunta já respondida em visitas; não pode ser apagada"
    );
    expect(destroy).not.toHaveBeenCalled();
  });

  it("recusa alterar tipo_resposta quando a pergunta já foi respondida em visitas", async () => {
    const update = vi.fn();
    models.PerguntaQuestionario.findByPk.mockResolvedValueOnce({
      id: 1,
      tipo_resposta: "sim_nao",
      update,
    });
    models.RespostaQuestionario.findOne.mockResolvedValueOnce({ id: 42 });

    await expect(
      questionarioService.atualizar(1, { tipo_resposta: "numero" })
    ).rejects.toThrow(
      "Pergunta já respondida em visitas; o tipo_resposta não pode ser alterado"
    );
    expect(update).not.toHaveBeenCalled();
  });
});

describe("respostas de uma visita (URL composta)", () => {
  const includePergunta = {
    model: PerguntaQuestionario,
    as: "pergunta",
    attributes: ["id", "texto", "tipo_resposta", "ordem"],
  };

  const respostaFalsa = (tipo_resposta, dados = {}) => ({
    id: 3,
    visita_id: 10,
    pergunta_id: 2,
    resposta: "antiga",
    pergunta: { id: 2, tipo_resposta },
    update: vi.fn(async function (novos) {
      Object.assign(this, novos);
    }),
    destroy: vi.fn(),
    ...dados,
  });

  beforeEach(() => {
    Visita.findByPk.mockResolvedValue({ id: 10, status: "em_andamento" });
    Documento.findOne.mockResolvedValue(null);
  });

  it("lista as respostas da visita com a pergunta, na ordem do questionário", async () => {
    RespostaQuestionario.findAll.mockResolvedValue([{ id: 1 }]);

    expect(await questionarioService.listarDaVisita(10)).toEqual([{ id: 1 }]);
    expect(RespostaQuestionario.findAll).toHaveBeenCalledWith({
      where: { visita_id: 10 },
      include: [includePergunta],
      order: [[includePergunta, "ordem", "ASC"]],
    });
  });

  it("busca a resposta só dentro da visita da URL", async () => {
    RespostaQuestionario.findOne.mockResolvedValue(null);

    expect(await questionarioService.buscarDaVisita(10, 3)).toBeNull();
    expect(RespostaQuestionario.findOne).toHaveBeenCalledWith({
      where: { id: 3, visita_id: 10 },
      include: [includePergunta],
      transaction: undefined,
    });
  });

  describe("atualizar", () => {
    it("trava a visita, valida pelo tipo da pergunta e grava sem espaços nas pontas", async () => {
      const resposta = respostaFalsa("numero");
      RespostaQuestionario.findOne.mockResolvedValue(resposta);

      const resultado = await questionarioService.atualizarDaVisita(10, 3, " 4,5 ");

      expect(Visita.findByPk).toHaveBeenCalledWith(10, {
        attributes: ["id", "status"],
        transaction: transacao,
        lock: transacao.LOCK.UPDATE,
      });
      expect(RespostaQuestionario.findOne).toHaveBeenCalledWith({
        where: { id: 3, visita_id: 10 },
        include: [includePergunta],
        transaction: transacao,
      });
      expect(resposta.update).toHaveBeenCalledWith({ resposta: "4,5" }, { transaction: transacao });
      expect(transacao.commit).toHaveBeenCalledTimes(1);
      expect(resultado.resposta).toBe("4,5");
    });

    it.each([
      ["sim_nao", "Talvez", 'Resposta da pergunta 2 deve ser "Sim", "Não" ou "Não se aplica"'],
      ["numero", "dez", "Resposta da pergunta 2 deve ser um número"],
      ["data", "31/02/2026", "Resposta da pergunta 2 deve ser uma data válida no formato DD/MM/AAAA"],
    ])("rejeita resposta fora do formato %s, com a mesma regra do POST", async (tipo, valor, mensagem) => {
      const resposta = respostaFalsa(tipo);
      RespostaQuestionario.findOne.mockResolvedValue(resposta);

      await expect(questionarioService.atualizarDaVisita(10, 3, valor)).rejects.toMatchObject({
        name: "ValidacaoError",
        message: "Há respostas inválidas",
        errors: [{ message: mensagem }],
      });
      expect(resposta.update).not.toHaveBeenCalled();
      expect(transacao.rollback).toHaveBeenCalledTimes(1);
    });

    it.each([[undefined], [""], ["   "], [5]])(
      "rejeita resposta vazia ou que não é texto (%o) sem gravar",
      async (valor) => {
        const resposta = respostaFalsa("texto");
        RespostaQuestionario.findOne.mockResolvedValue(resposta);

        await expect(questionarioService.atualizarDaVisita(10, 3, valor)).rejects.toMatchObject({
          name: "ValidacaoError",
          message: "Resposta 1: a resposta deve ser um texto preenchido",
        });
        expect(resposta.update).not.toHaveBeenCalled();
        expect(transacao.rollback).toHaveBeenCalledTimes(1);
      }
    );

    it("confere se a resposta existe antes de olhar o valor", async () => {
      RespostaQuestionario.findOne.mockResolvedValue(null);

      expect(await questionarioService.atualizarDaVisita(10, 3, "")).toBeNull();
    });

    it("confere a situação da visita antes de olhar o valor", async () => {
      Visita.findByPk.mockResolvedValue({ id: 10, status: "concluida" });

      await expect(questionarioService.atualizarDaVisita(10, 3, "")).rejects.toMatchObject({
        name: "ValidacaoError",
      });
      expect(RespostaQuestionario.findOne).not.toHaveBeenCalled();
    });

    it("rejeita depois que o documento foi gerado", async () => {
      Documento.findOne.mockResolvedValue({ id: 7 });

      await expect(questionarioService.atualizarDaVisita(10, 3, "Sim")).rejects.toMatchObject({
        message: "O documento da visita já foi gerado; as respostas não podem mais ser alteradas",
      });
      expect(RespostaQuestionario.findOne).not.toHaveBeenCalled();
      expect(transacao.rollback).toHaveBeenCalledTimes(1);
    });

    it.each(["agendada", "concluida", "cancelada"])("rejeita visita %s", async (status) => {
      Visita.findByPk.mockResolvedValue({ id: 10, status });

      await expect(questionarioService.atualizarDaVisita(10, 3, "Sim")).rejects.toMatchObject({
        message: "As respostas só podem ser alteradas em visitas em andamento",
      });
    });

    it("devolve null quando a resposta não é da visita", async () => {
      RespostaQuestionario.findOne.mockResolvedValue(null);

      expect(await questionarioService.atualizarDaVisita(10, 3, "Sim")).toBeNull();
      expect(transacao.rollback).toHaveBeenCalledTimes(1);
      expect(transacao.commit).not.toHaveBeenCalled();
    });

    it("devolve null quando a visita sumiu", async () => {
      Visita.findByPk.mockResolvedValue(null);

      expect(await questionarioService.atualizarDaVisita(10, 3, "Sim")).toBeNull();
      expect(RespostaQuestionario.findOne).not.toHaveBeenCalled();
    });

    it("desfaz a transação quando a gravação falha", async () => {
      const resposta = respostaFalsa("texto");
      resposta.update.mockRejectedValue(new Error("falha"));
      RespostaQuestionario.findOne.mockResolvedValue(resposta);

      await expect(questionarioService.atualizarDaVisita(10, 3, "ok")).rejects.toThrow("falha");
      expect(transacao.rollback).toHaveBeenCalledTimes(1);
    });
  });

  describe("remover", () => {
    it("apaga a resposta da visita dentro da transação", async () => {
      const resposta = respostaFalsa("texto");
      RespostaQuestionario.findOne.mockResolvedValue(resposta);

      expect(await questionarioService.removerDaVisita(10, 3)).toBe(true);
      expect(resposta.destroy).toHaveBeenCalledWith({ transaction: transacao });
      expect(transacao.commit).toHaveBeenCalledTimes(1);
    });

    it("rejeita depois que o documento foi gerado", async () => {
      Documento.findOne.mockResolvedValue({ id: 7 });

      await expect(questionarioService.removerDaVisita(10, 3)).rejects.toMatchObject({
        name: "ValidacaoError",
      });
    });

    it("devolve null quando a resposta não é da visita", async () => {
      RespostaQuestionario.findOne.mockResolvedValue(null);

      expect(await questionarioService.removerDaVisita(10, 3)).toBeNull();
    });
  });
});
