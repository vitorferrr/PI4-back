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

const TIPOS_RESPOSTA_VALIDOS = Object.keys(FORMATOS);

const validarDadosPergunta = (dados, { parcial = false } = {}) => {
  if (!dados || typeof dados !== "object" || Array.isArray(dados)) {
    throw erroValidacao("Dados da pergunta inválidos");
  }

  const { texto, tipo_resposta, ordem } = dados;
  const erros = [];
  const validado = {};

  if (!parcial || texto !== undefined) {
    if (typeof texto !== "string" || texto.trim() === "") {
      erros.push("O texto da pergunta é obrigatório");
    } else {
      validado.texto = texto.trim();
    }
  }

  if (!parcial || tipo_resposta !== undefined) {
    if (!TIPOS_RESPOSTA_VALIDOS.includes(tipo_resposta)) {
      erros.push(
        `tipo_resposta deve ser um dos valores: ${TIPOS_RESPOSTA_VALIDOS.join(", ")}`
      );
    } else {
      validado.tipo_resposta = tipo_resposta;
    }
  }

  if (!parcial || ordem !== undefined) {
    if (!Number.isInteger(ordem) || ordem < 1) {
      erros.push("ordem deve ser um número inteiro positivo");
    } else {
      validado.ordem = ordem;
    }
  }

  if (parcial && Object.keys(validado).length === 0 && erros.length === 0) {
    erros.push("Informe ao menos um campo para atualizar");
  }

  if (erros.length > 0) {
    throw erroValidacao(erros[0], erros);
  }

  return validado;
};

const buscarPorId = async (id) => {
  return await PerguntaQuestionario.findByPk(id);
};

const criar = async (dados) => {
  const validado = validarDadosPergunta(dados);
  return await PerguntaQuestionario.create(validado);
};

const atualizar = async (id, dados) => {
  const pergunta = await PerguntaQuestionario.findByPk(id);
  if (!pergunta) {
    return null;
  }

  const validado = validarDadosPergunta(dados, { parcial: true });

  if (
    validado.tipo_resposta !== undefined &&
    validado.tipo_resposta !== pergunta.tipo_resposta
  ) {
    const respostaExistente = await RespostaQuestionario.findOne({
      attributes: ["id"],
      where: { pergunta_id: id },
    });

    if (respostaExistente) {
      throw erroValidacao(
        "Pergunta já respondida em visitas; o tipo_resposta não pode ser alterado"
      );
    }
  }

  return await pergunta.update(validado);
};

const remover = async (id) => {
  const pergunta = await PerguntaQuestionario.findByPk(id);
  if (!pergunta) {
    return null;
  }

  const respostaExistente = await RespostaQuestionario.findOne({
    attributes: ["id"],
    where: { pergunta_id: id },
  });

  if (respostaExistente) {
    throw erroValidacao("Pergunta já respondida em visitas; não pode ser apagada");
  }

  await pergunta.destroy();
  return pergunta;
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
  buscarPorId,
  criar,
  atualizar,
  remover,
  salvarRespostas,
};