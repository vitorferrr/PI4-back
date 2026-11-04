import models, { sequelize } from "../models/index.js";

const { Visita, Usuario, Documento, RespostaQuestionario } = models;

const erroValidacao = (mensagem) => {
  const erro = new Error(mensagem);
  erro.name = "ValidacaoError";

  return erro;
};

const includeGestor = {
  model: Usuario,
  as: "gestor",
  attributes: {
    exclude: ["senha_hash"],
  },
};

const includeFiscalizadoresPadrao = {
  model: Usuario,
  as: "fiscalizadores",
  attributes: {
    exclude: ["senha_hash"],
  },
  through: { attributes: [] },
};

const criar = async (dados, fiscalizadoresIds = []) => {
  const {
    denunciado,
    gestor_id,
    status,
    latitude,
    longitude,
    data_agendada,
    data_realizacao,
    observacoes_livres,
  } = dados;

  if (!denunciado) {
    throw erroValidacao("O campo denunciado é obrigatório");
  }

  if (!gestor_id) {
    throw erroValidacao("O gestor responsável é obrigatório");
  }

  if (!data_agendada) {
    throw erroValidacao("A data agendada é obrigatória");
  }

  const transaction = await sequelize.transaction();

  try {
    const novaVisita = await Visita.create(
      {
        denunciado,
        gestor_id,
        status,
        latitude,
        longitude,
        data_agendada,
        data_realizacao,
        observacoes_livres,
      },
      { transaction }
    );

    if (Array.isArray(fiscalizadoresIds) && fiscalizadoresIds.length > 0) {
      await novaVisita.setFiscalizadores(fiscalizadoresIds, { transaction });
    }

    await transaction.commit();

    return await buscarPorId(novaVisita.id);
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

const listar = async (filtros = {}) => {
  const { status, gestor_id, fiscalizador_id } = filtros;
  const where = {};

  if (status) where.status = status;
  if (gestor_id) where.gestor_id = gestor_id;

  const includeFiscalizadores = {
    ...includeFiscalizadoresPadrao,
  };

  if (fiscalizador_id) {
    includeFiscalizadores.where = { id: fiscalizador_id };
    includeFiscalizadores.required = true;
  }

  return await Visita.findAll({
    where,
    include: [includeGestor, includeFiscalizadores],
    order: [["data_agendada", "ASC"]],
  });
};

const buscarPorId = async (id) => {
  const visita = await Visita.findByPk(id, {
    include: [
      includeGestor,
      includeFiscalizadoresPadrao,
      {
        model: Documento,
        as: "documentos",
      },
      {
        model: RespostaQuestionario,
        as: "respostas",
      },
    ],
  });

  return visita;
};

const atualizar = async (id, dados, fiscalizadoresIds) => {
  const visita = await Visita.findByPk(id);

  if (!visita) {
    return null;
  }

  const dadosAtualizados = {};
  [
    "denunciado",
    "gestor_id",
    "status",
    "latitude",
    "longitude",
    "data_agendada",
    "data_realizacao",
    "observacoes_livres",
  ].forEach((campo) => {
    if (dados[campo] !== undefined) {
      dadosAtualizados[campo] = dados[campo];
    }
  });

  const transaction = await sequelize.transaction();

  try {
    await visita.update(dadosAtualizados, { transaction });

    if (Array.isArray(fiscalizadoresIds)) {
      await visita.setFiscalizadores(fiscalizadoresIds, { transaction });
    }

    await transaction.commit();

    return await buscarPorId(id);
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

const iniciar = async (id) => {
  const visita = await Visita.findByPk(id);

  if (!visita) {
    return null;
  }

  if (visita.status !== "agendada") {
    throw erroValidacao("Somente visitas agendadas podem ser iniciadas");
  }

  const transaction = await sequelize.transaction();

  try {
    await visita.update(
      { status: "em_andamento", data_realizacao: new Date() },
      { transaction }
    );

    await transaction.commit();

    return await buscarPorId(id);
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

const concluir = async (id) => {
  const visita = await Visita.findByPk(id);

  if (!visita) {
    return null;
  }

  if (visita.status !== "em_andamento") {
    throw erroValidacao("Somente visitas em andamento podem ser concluídas");
  }

  const transaction = await sequelize.transaction();

  try {
    await visita.update({ status: "concluida" }, { transaction });

    await transaction.commit();

    return await buscarPorId(id);
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

const remover = async (id) => {
  const visita = await Visita.findByPk(id);

  if (!visita) {
    return null;
  }

  await visita.destroy();

  return visita;
};

export default {
  criar,
  listar,
  buscarPorId,
  atualizar,
  iniciar,
  concluir,
  remover,
};