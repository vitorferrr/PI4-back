import models, { sequelize } from "../models/index.js";
import { validarListaRespostas } from "../utils/validarRespostas.js";
import erroValidacao from "../utils/erroValidacao.js";

const { Documento, PerguntaQuestionario, RespostaQuestionario, Visita } = models;

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

const conferirFormatos = (respostas, perguntasPorId) => {
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

const validarRespostas = async (respostas, transaction) => {
  validarLista(respostas);

  const perguntas = await PerguntaQuestionario.findAll({
    where: { id: respostas.map((item) => item.pergunta_id) },
    transaction,
  });

  conferirFormatos(respostas, new Map(perguntas.map((pergunta) => [pergunta.id, pergunta])));
};

const travarVisitaEditavel = async (visitaId, transaction) => {
  const visita = await Visita.findByPk(visitaId, {
    attributes: ["id", "status"],
    transaction,
    lock: transaction.LOCK.UPDATE,
  });

  if (!visita) {
    return null;
  }

  if (visita.status !== "em_andamento") {
    throw erroValidacao("Só é possível responder o questionário de visitas em andamento");
  }

  const documento = await Documento.findOne({
    attributes: ["id"],
    where: { visita_id: visitaId },
    transaction,
  });

  if (documento) {
    throw erroValidacao(
      "O documento da visita já foi gerado; as respostas não podem mais ser alteradas"
    );
  }

  return visita;
};

const salvarRespostas = async (visitaId, respostas) => {
  const transaction = await sequelize.transaction();

  try {
    const visita = await travarVisitaEditavel(visitaId, transaction);

    if (!visita) {
      await transaction.rollback();
      return null;
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

const includePergunta = {
  model: PerguntaQuestionario,
  as: "pergunta",
  attributes: ["id", "texto", "tipo_resposta", "ordem"],
};

const listarDaVisita = async (visitaId) =>
  await RespostaQuestionario.findAll({
    where: { visita_id: visitaId },
    include: [includePergunta],
    order: [[includePergunta, "ordem", "ASC"]],
  });

const buscarDaVisita = async (visitaId, respostaId, transaction) =>
  await RespostaQuestionario.findOne({
    where: { id: respostaId, visita_id: visitaId },
    include: [includePergunta],
    transaction,
  });

const alterarDaVisita = async (visitaId, respostaId, alteracao) => {
  const transaction = await sequelize.transaction();

  try {
    const visita = await travarVisitaEditavel(visitaId, transaction);
    const resposta = visita && (await buscarDaVisita(visitaId, respostaId, transaction));

    if (!resposta) {
      await transaction.rollback();
      return null;
    }

    const resultado = await alteracao(resposta, transaction);
    await transaction.commit();

    return resultado;
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

const atualizarDaVisita = async (visitaId, respostaId, valor) =>
  await alterarDaVisita(visitaId, respostaId, async (resposta, transaction) => {
    const item = { pergunta_id: resposta.pergunta_id, resposta: valor };

    validarLista([item]);
    conferirFormatos([item], new Map([[resposta.pergunta_id, resposta.pergunta]]));

    await resposta.update({ resposta: valor.trim() }, { transaction });

    return resposta;
  });

const removerDaVisita = async (visitaId, respostaId) =>
  await alterarDaVisita(visitaId, respostaId, async (resposta, transaction) => {
    await resposta.destroy({ transaction });

    return true;
  });

export default {
  listar,
  salvarRespostas,
  listarDaVisita,
  buscarDaVisita,
  atualizarDaVisita,
  removerDaVisita,
};