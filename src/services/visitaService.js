import models, { sequelize } from "../models/index.js";
import erroValidacao from "../utils/erroValidacao.js";

const { Visita, Usuario, Documento, RespostaQuestionario } = models;

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

const QUANTIDADE_FISCALIZADORES = 1;

const CAMPOS_ESTABELECIMENTO = [
  "razao_social",
  "nome_fantasia",
  "endereco",
  "bairro",
  "cep",
  "telefone",
  "cnpj_cpf",
  "atividade",
];

const escolherCampos = (dados, campos) =>
  Object.fromEntries(
    campos.filter((campo) => dados[campo] !== undefined).map((campo) => [campo, dados[campo]])
  );

const validarFiscalizadores = (fiscalizadoresIds) => {
  if (!Array.isArray(fiscalizadoresIds) || new Set(fiscalizadoresIds).size !== QUANTIDADE_FISCALIZADORES) {
    throw erroValidacao("A visita deve ter exatamente um agente fiscalizador");
  }
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

  validarFiscalizadores(fiscalizadoresIds);

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
        ...escolherCampos(dados, CAMPOS_ESTABELECIMENTO),
      },
      { transaction }
    );

    await novaVisita.setFiscalizadores([...new Set(fiscalizadoresIds)], { transaction });

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

const buscarParaAcesso = async (id) =>
  await Visita.findByPk(id, {
    attributes: ["id", "status"],
    include: [{ ...includeFiscalizadoresPadrao, attributes: ["id"] }],
  });

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

const CAMPOS_EDITAVEIS = [
  "denunciado",
  "gestor_id",
  "status",
  "latitude",
  "longitude",
  "data_agendada",
  "data_realizacao",
  "observacoes_livres",
  ...CAMPOS_ESTABELECIMENTO,
];

const atualizar = async (id, dados, fiscalizadoresIds) => {
  if (fiscalizadoresIds !== undefined) validarFiscalizadores(fiscalizadoresIds);

  const dadosAtualizados = escolherCampos(dados, CAMPOS_EDITAVEIS);

  const transaction = await sequelize.transaction();

  try {
    const visita = await Visita.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });

    if (!visita) {
      await transaction.rollback();
      return null;
    }

    const documento = await Documento.findOne({
      attributes: ["id"],
      where: { visita_id: id },
      transaction,
    });

    if (documento) {
      throw erroValidacao("O documento da visita já foi gerado; a visita não pode mais ser editada");
    }

    await visita.update(dadosAtualizados, { transaction });

    if (fiscalizadoresIds !== undefined) {
      await visita.setFiscalizadores([...new Set(fiscalizadoresIds)], { transaction });
    }

    await transaction.commit();
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }

  return await buscarPorId(id);
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
    throw erroValidacao(erros[0], erros);
  }

  return { latitude, longitude };
};

const MENSAGEM_SO_AGENDADAS = "Somente visitas agendadas podem ser iniciadas";

const iniciar = async (id, coordenadas) => {
  const visita = await Visita.findByPk(id, { attributes: ["id", "status"] });

  if (!visita) {
    return null;
  }

  if (visita.status !== "agendada") {
    throw erroValidacao(MENSAGEM_SO_AGENDADAS);
  }

  const { latitude, longitude } = validarCoordenadas(coordenadas);

  return await transicionarStatus(
    id,
    "agendada",
    { status: "em_andamento", data_realizacao: new Date(), latitude, longitude },
    MENSAGEM_SO_AGENDADAS
  );
};

const concluir = async (id) => {
  const transaction = await sequelize.transaction();

  try {
    const visita = await Visita.findByPk(id, {
      attributes: ["id", "status"],
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!visita) {
      await transaction.rollback();
      return null;
    }

    if (visita.status !== "em_andamento") {
      throw erroValidacao("Somente visitas em andamento podem ser concluídas");
    }

    const documento = await Documento.findOne({
      attributes: ["id"],
      where: { visita_id: id },
      transaction,
    });

    if (!documento) {
      throw erroValidacao("Gere o documento da visita antes de concluí-la");
    }

    await Visita.update({ status: "concluida" }, { where: { id }, transaction });
    await transaction.commit();
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }

  return await buscarPorId(id);
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
  buscarParaAcesso,
  atualizar,
  iniciar,
  concluir,
  remover,
};