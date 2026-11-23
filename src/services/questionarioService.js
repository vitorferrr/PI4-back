import models, { sequelize } from "../models/index.js";
import { validarListaRespostas } from "../middlewares/validationMiddleware.js";

const { PerguntaQuestionario, RespostaQuestionario, Visita } = models;

const erroValidacao = (mensagem, erros = [mensagem]) => {
  const erro = new Error(mensagem);
  erro.name = "ValidacaoError";
  erro.errors = erros.map((message) => ({ message }));

  return erro;
};

const FORMATOS = {
  sim_nao: {
    valido: (valor) => ["Sim", "Não", "Não se aplica"].includes(valor),
    mensagem: 'deve ser "Sim", "Não" ou "Não se aplica"',
  },
  numero: {
    valido: (valor) => /^-?\d+([.,]\d+)?$/.test(valor),
    mensagem: "deve ser um número",
  },
  data: {
    valido: (valor) => {
      const partes = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor);
      if (!partes) return false;

      const [, dia, mes, ano] = partes.map(Number);

      if (ano < 1900) return false;

      const data = new Date(Date.UTC(ano, mes - 1, dia));

      return data.getUTCDate() === dia && data.getUTCMonth() === mes - 1;
    },
    mensagem: "deve ser uma data válida no formato DD/MM/AAAA",
  },
  texto: {
    valido: () => true,
    mensagem: "",
  },
};

const listar = async () => {
  return await PerguntaQuestionario.findAll({
    order: [["ordem", "ASC"]],
  });
};

const validarLista = (respostas) => {
  const erros = validarListaRespostas(respostas);
  if (erros.length > 0) {
    throw erroValidacao(erros[0], erros);
  }
};

const validarRespostas = async (respostas, transaction) => {
  validarLista(respostas);

  const perguntas = await PerguntaQuestionario.findAll({
    where: { id: respostas.map((item) => item.pergunta_id) },
    transaction,
  });
  const perguntasPorId = new Map(perguntas.map((pergunta) => [pergunta.id, pergunta]));

  const erros = [];

  respostas.forEach((item) => {
    const pergunta = perguntasPorId.get(item.pergunta_id);

    if (!pergunta) {
      erros.push(`A pergunta ${item.pergunta_id} não existe`);
      return;
    }

    const formato = FORMATOS[pergunta.tipo_resposta];
    if (!formato.valido(item.resposta.trim())) {
      erros.push(`Resposta da pergunta ${item.pergunta_id} ${formato.mensagem}`);
    }
  });

  if (erros.length > 0) {
    throw erroValidacao("Há respostas inválidas", erros);
  }
};

const salvarRespostas = async (visitaId, respostas) => {
  const transaction = await sequelize.transaction();

  try {
    const visita = await Visita.findByPk(visitaId, {
      attributes: ["id", "status"],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!visita) {
      await transaction.rollback();
      return null;
    }

    if (visita.status !== "em_andamento") {
      throw erroValidacao("Só é possível responder o questionário de visitas em andamento");
    }

    await validarRespostas(respostas, transaction);

    await RespostaQuestionario.bulkCreate(
      respostas.map((item) => ({
        visita_id: visitaId,
        pergunta_id: item.pergunta_id,
        resposta: item.resposta.trim(),
      })),
      {
        transaction,
        updateOnDuplicate: ["resposta", "updatedAt"],
        conflictAttributes: ["visita_id", "pergunta_id"],
      }
    );

    await transaction.commit();
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }

  return await RespostaQuestionario.findAll({
    where: { visita_id: visitaId },
    order: [["pergunta_id", "ASC"]],
  });
};

export default {
  listar,
  salvarRespostas,
};