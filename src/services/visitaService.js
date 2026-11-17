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

// O status esperado faz parte do WHERE para que a checagem e a escrita sejam uma
// única operação atômica: entre requisições simultâneas, apenas uma altera a linha.
const transicionarStatus = async (id, statusEsperado, novosDados, mensagemErro) => {
  const [afetadas] = await Visita.update(novosDados, {
    where: { id, status: statusEsperado },
  });

  if (afetadas === 0) {
    const visita = await Visita.findByPk(id);

    if (!visita) {
      return null;
    }

    throw erroValidacao(mensagemErro);
  }

  return await buscarPorId(id);
};

const coordenadaValida = (valor, limite) =>
  typeof valor === "number" && Number.isFinite(valor) && Math.abs(valor) <= limite;

const validarCoordenadas = ({ latitude, longitude } = {}) => {
  const erros = [];

  if (!coordenadaValida(latitude, 90)) {
    erros.push("A latitude deve ser um número entre -90 e 90");
  }

  if (!coordenadaValida(longitude, 180)) {
    erros.push("A longitude deve ser um número entre -180 e 180");
  }

  if (erros.length > 0) {
    const erro = erroValidacao(erros[0]);
    erro.errors = erros.map((message) => ({ message }));
    throw erro;
  }

  return { latitude, longitude };
};

const iniciar = async (id, coordenadas) => {
  const { latitude, longitude } = validarCoordenadas(coordenadas);

  return await transicionarStatus(
    id,
    "agendada",
    { status: "em_andamento", data_realizacao: new Date(), latitude, longitude },
    "Somente visitas agendadas podem ser iniciadas"
  );
};

const concluir = async (id) =>
  await transicionarStatus(
    id,
    "em_andamento",
    { status: "concluida" },
    "Somente visitas em andamento podem ser concluídas"
  );

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