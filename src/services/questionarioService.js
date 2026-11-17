import models, { sequelize } from "../models/index.js";

const { PerguntaQuestionario, RespostaQuestionario } = models;

const erroValidacao = (mensagem, erros = [mensagem]) => {
  const erro = new Error(mensagem);
  erro.name = "ValidacaoError";
  erro.errors = erros.map((message) => ({ message }));

  return erro;
};

const FORMATOS = {
  sim_nao: {
    valido: (valor) => valor === "Sim" || valor === "Não",
    mensagem: 'deve ser "Sim" ou "Não"',
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
  if (!Array.isArray(respostas) || respostas.length === 0) {
    throw erroValidacao("Envie ao menos uma resposta em 'respostas'");
  }

  const ids = new Set();

  respostas.forEach((item, indice) => {
    const posicao = `Resposta ${indice + 1}`;

    if (!Number.isInteger(item?.pergunta_id) || item.pergunta_id < 1) {
      throw erroValidacao(`${posicao}: pergunta_id deve ser um número inteiro positivo`);
    }

    if (typeof item.resposta !== "string" || item.resposta.trim() === "") {
      throw erroValidacao(`${posicao}: a resposta deve ser um texto preenchido`);
    }

    if (ids.has(item.pergunta_id)) {
      throw erroValidacao(`A pergunta ${item.pergunta_id} foi enviada mais de uma vez`);
    }

    ids.add(item.pergunta_id);
  });
};

const salvarRespostas = async (visita, respostas) => {
  if (visita.status !== "em_andamento") {
    throw erroValidacao("Só é possível responder o questionário de visitas em andamento");
  }

  validarLista(respostas);

  const perguntas = await PerguntaQuestionario.findAll({
    where: { id: respostas.map((item) => item.pergunta_id) },
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

  const transaction = await sequelize.transaction();

  try {
    for (const item of respostas) {
      await RespostaQuestionario.upsert(
        {
          visita_id: visita.id,
          pergunta_id: item.pergunta_id,
          resposta: item.resposta.trim(),
        },
        { transaction, conflictFields: ["visita_id", "pergunta_id"] }
      );
    }

    await transaction.commit();
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }

  return await RespostaQuestionario.findAll({
    where: { visita_id: visita.id },
    order: [["pergunta_id", "ASC"]],
  });
};

export default {
  listar,
  salvarRespostas,
};