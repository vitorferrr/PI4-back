import models, { sequelize } from "../models/index.js";
import erroValidacao from "../utils/erroValidacao.js";

const { Documento, PerguntaQuestionario, RespostaQuestionario, Visita } = models;

const buscarPerguntasSemResposta = async (visitaId, transaction) => {
  const perguntas = await PerguntaQuestionario.findAll({
    attributes: ["id"],
    order: [["ordem", "ASC"]],
    transaction,
  });
  const respostas = await RespostaQuestionario.findAll({
    attributes: ["pergunta_id"],
    where: { visita_id: visitaId },
    transaction,
  });
  const respondidas = new Set(respostas.map((resposta) => resposta.pergunta_id));

  return perguntas
    .filter((pergunta) => !respondidas.has(pergunta.id))
    .map((pergunta) => pergunta.id);
};

const gerar = async (visitaId) => {
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

    const existente = await Documento.findOne({ where: { visita_id: visitaId }, transaction });

    if (existente) {
      await transaction.commit();
      return { documento: existente, criado: false };
    }

    if (visita.status !== "em_andamento") {
      throw erroValidacao("Só é possível gerar o documento de visitas em andamento");
    }

    const pendentes = await buscarPerguntasSemResposta(visitaId, transaction);

    if (pendentes.length > 0) {
      throw erroValidacao(
        "Responda todas as perguntas antes de gerar o documento",
        pendentes.map((id) => `A pergunta ${id} não foi respondida`)
      );
    }

    const documento = await Documento.create(
      {
        visita_id: visitaId,
        url_arquivo_pdf: null,
        data_geracao: new Date(),
        enviado_email: false,
      },
      { transaction }
    );

    await transaction.commit();

    return { documento, criado: true };
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

export default {
  gerar,
};
