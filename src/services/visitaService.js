import models, { sequelize } from "../models/index.js";
import erroValidacao from "../utils/erroValidacao.js";

const { Assinatura, Visita, Usuario, Documento, RespostaQuestionario } = models;

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

// Só o necessário para o app saber quem já assinou e sincronizar os cartões (DT-47).
// Ficam de fora o CPF, o e-mail do responsável e o caminho da imagem no storage.
const ATRIBUTOS_ASSINATURA = [
  "id",
  "documento_id",
  "usuario_id",
  "assinante_tipo",
  "assinante_nome",
  "recusou",
  "data_assinatura",
];

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

const validarFiscalizadores = async (fiscalizadoresIds) => {
  if (!Array.isArray(fiscalizadoresIds) || new Set(fiscalizadoresIds).size !== QUANTIDADE_FISCALIZADORES) {
    throw erroValidacao("A visita deve ter exatamente um agente fiscalizador");
  }

  const [id] = fiscalizadoresIds;
  const fiscal = Number.isInteger(id) && id > 0
    ? await Usuario.findByPk(id, { attributes: ["id", "role", "aprovado"] })
    : null;

  if (fiscal?.role !== "fiscalizador") {
    throw erroValidacao("O usuário informado não é um fiscalizador cadastrado");
  }

  if (fiscal.aprovado === false) {
    throw erroValidacao("O fiscalizador informado ainda não foi aprovado");
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

  await validarFiscalizadores(fiscalizadoresIds);

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
        include: [
          {
            model: Assinatura,
            as: "assinaturas",
            attributes: ATRIBUTOS_ASSINATURA,
          },
        ],
      },
      {
        model: RespostaQuestionario,
        as: "respostas",
      },
    ],
    order: [
      [
        { model: Documento, as: "documentos" },
        { model: Assinatura, as: "assinaturas" },
        "data_assinatura",
        "ASC",
      ],
    ],
  });

  return visita;
};

const CAMPOS_EDITAVEIS = [
  "denunciado",
  "gestor_id",
  "data_agendada",
  "observacoes_livres",
  ...CAMPOS_ESTABELECIMENTO,
];

const validarGestor = async (gestorId, transaction) => {
  const gestor = Number.isInteger(gestorId) && gestorId > 0
    ? await Usuario.findByPk(gestorId, {
        attributes: ["id", "role"],
        transaction,
      })
    : null;

  if (gestor?.role !== "gestor") {
    throw erroValidacao("O gestor informado não existe ou não possui perfil de gestor");
  }
};

const atualizar = async (id, dados, fiscalizadoresIds) => {
  if (fiscalizadoresIds !== undefined) await validarFiscalizadores(fiscalizadoresIds);

  const dadosAtualizados = escolherCampos(dados, CAMPOS_EDITAVEIS);

  if (dados.status !== undefined) {
    if (dados.status !== "cancelada") {
      throw erroValidacao(
        "Na edição da visita, o único status permitido é 'cancelada'"
      );
    }
    dadosAtualizados.status = "cancelada";
  }

  const transaction = await sequelize.transaction();

  try {
    const visita = await Visita.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });

    if (!visita) {
      await transaction.rollback();
      return null;
    }

    if (dadosAtualizados.gestor_id !== undefined) {
      await validarGestor(dadosAtualizados.gestor_id, transaction);
    }

    if (
      dadosAtualizados.status === "cancelada" &&
      !["agendada", "em_andamento"].includes(visita.status)
    ) {
      throw erroValidacao("Somente visitas agendadas ou em andamento podem ser canceladas");
    }

    if (fiscalizadoresIds !== undefined && visita.status !== "agendada") {
      throw erroValidacao("Só é possível alterar fiscalizadores de visitas agendadas");
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

    const documento = await Documento.findOne({
      attributes: ["id", "url_arquivo_pdf"],
      where: { visita_id: id },
      transaction,
    });

    if (visita.status === "concluida" && documento?.url_arquivo_pdf) {
      await transaction.commit();
      return await buscarPorId(id);
    }

    if (visita.status !== "em_andamento") {
      throw erroValidacao("Somente visitas em andamento podem ser concluídas");
    }

    if (!documento) {
      throw erroValidacao("Gere o documento da visita antes de concluí-la");
    }

    if (!documento.url_arquivo_pdf) {
      throw erroValidacao("Colete todas as assinaturas e gere o PDF antes de concluir a visita");
    }

    await Visita.update({ status: "concluida" }, { where: { id }, transaction });
    await transaction.commit();
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }

  return await buscarPorId(id);
};

// DT-48: o app envia as observações antes do POST /visitas/:id/documento, para que
// elas entrem no PDF. Depois que o documento existe, o texto do PDF não pode mudar.
const salvarObservacoes = async (id, observacoes) => {
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
      throw erroValidacao("Só é possível registrar observações de visitas em andamento");
    }

    const documento = await Documento.findOne({
      attributes: ["id"],
      where: { visita_id: id },
      transaction,
    });

    if (documento) {
      throw erroValidacao(
        "O documento da visita já foi gerado; as observações não podem mais ser alteradas"
      );
    }

    const texto = typeof observacoes === "string" ? observacoes.trim() : "";

    await Visita.update(
      { observacoes_livres: texto || null },
      { where: { id }, transaction }
    );
    await transaction.commit();
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }

  return await buscarPorId(id);
};

const remover = async (id) => {
  const transaction = await sequelize.transaction();

  try {
    const visita = await Visita.findByPk(id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });

    if (!visita) {
      await transaction.rollback();
      return null;
    }

    if (visita.status !== "agendada") {
      throw erroValidacao("Somente visitas agendadas podem ser apagadas");
    }

    const documento = await Documento.findOne({
      attributes: ["id"],
      where: { visita_id: id },
      transaction,
    });

    if (documento) {
      throw erroValidacao(
        "O documento da visita já foi gerado; a visita não pode mais ser apagada"
      );
    }

    await visita.destroy({ transaction });
    await transaction.commit();

    return visita;
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

const garantirDocumentoNaoGerado = async (visita, transaction) => {
  if (visita.status !== "agendada") {
    throw erroValidacao(
      "Só é possível alterar fiscalizadores de visitas agendadas"
    );
  }

  const documento = await Documento.findOne({
    attributes: ["id"],
    where: { visita_id: visita.id },
    transaction,
  });

  if (documento) {
    throw erroValidacao(
      "O documento da visita já foi gerado; os fiscalizadores não podem mais ser alterados"
    );
  }
};

const listarFiscalizadores = async (visitaId) => {
  const visita = await Visita.findByPk(visitaId, { attributes: ["id"] });

  if (!visita) {
    return null;
  }

  return await visita.getFiscalizadores({
    attributes: { exclude: ["senha_hash"] },
    joinTableAttributes: [],
  });
};

const adicionarFiscalizador = async (visitaId, fiscalizadorId) => {
  await validarFiscalizadores([fiscalizadorId]);

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

    await garantirDocumentoNaoGerado(visita, transaction);

    const atuais = await visita.getFiscalizadores({
      attributes: ["id"],
      joinTableAttributes: [],
      transaction,
    });

    if (atuais.length >= QUANTIDADE_FISCALIZADORES) {
      throw erroValidacao(
        "A visita já possui fiscalizador vinculado; utilize PUT para substituí-lo"
      );
    }

    await visita.addFiscalizador(fiscalizadorId, { transaction });
    await transaction.commit();
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }

  return await listarFiscalizadores(visitaId);
};

const substituirFiscalizadores = async (visitaId, fiscalizadoresIds) => {
  await validarFiscalizadores(fiscalizadoresIds);

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

    await garantirDocumentoNaoGerado(visita, transaction);

    await visita.setFiscalizadores([...new Set(fiscalizadoresIds)], {
      transaction,
    });
    await transaction.commit();
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }

  return await listarFiscalizadores(visitaId);
};

const removerFiscalizador = async (visitaId, fiscalizadorId) => {
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

    await garantirDocumentoNaoGerado(visita, transaction);

    const idFiscalizador = Number(fiscalizadorId);
    const vinculados = await visita.getFiscalizadores({
      attributes: ["id"],
      where: { id: idFiscalizador },
      joinTableAttributes: [],
      transaction,
    });

    if (vinculados.length === 0) {
      await transaction.rollback();
      return { naoVinculado: true };
    }

    await visita.removeFiscalizador(idFiscalizador, { transaction });
    await transaction.commit();

    return { removido: true };
  } catch (erro) {
    await transaction.rollback();
    throw erro;
  }
};

export default {
  criar,
  listar,
  buscarPorId,
  buscarParaAcesso,
  atualizar,
  iniciar,
  concluir,
  salvarObservacoes,
  remover,
  listarFiscalizadores,
  adicionarFiscalizador,
  substituirFiscalizadores,
  removerFiscalizador,
};