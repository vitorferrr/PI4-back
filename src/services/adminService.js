import { col, fn, Op } from "sequelize";
import models from "../models/index.js";

const { Usuario, Visita, VisitaFiscalizador, Documento, Assinatura } = models;

const STATUS_VISITAS = ["agendada", "em_andamento", "concluida", "cancelada"];
const ROLES_USUARIOS = ["admin", "gestor", "fiscalizador"];
const MAX_EXPORTACAO = 5000;

const agruparContagem = async (Model, campo, valores) => {
  const linhas = await Model.findAll({
    attributes: [campo, [fn("COUNT", col("id")), "total"]],
    group: [campo],
    raw: true,
  });

  const mapa = valores.reduce((acc, valor) => {
    acc[valor] = 0;
    return acc;
  }, {});

  for (const linha of linhas) {
    if (linha[campo] in mapa) {
      mapa[linha[campo]] = Number(linha.total) || 0;
    }
  }

  return mapa;
};

const somarValores = (objeto) =>
  Object.values(objeto).reduce((total, qtd) => total + qtd, 0);

const obterDadosGerais = async () => {
  const [visitasPorStatus, usuariosPorRole, totalDocumentos, totalAssinaturas] =
    await Promise.all([
      agruparContagem(Visita, "status", STATUS_VISITAS),
      agruparContagem(Usuario, "role", ROLES_USUARIOS),
      Documento.count(),
      Assinatura.count(),
    ]);

  return {
    visitas: {
      total: somarValores(visitasPorStatus),
      por_status: visitasPorStatus,
    },
    usuarios: {
      total: somarValores(usuariosPorRole),
      por_role: usuariosPorRole,
    },
    documentos: {
      total: totalDocumentos,
    },
    assinaturas: {
      total: totalAssinaturas,
    },
  };
};

const CABECALHO_CSV = [
  "id",
  "denunciado",
  "status",
  "gestor",
  "fiscalizadores",
  "data_agendada",
  "data_realizacao",
  "latitude",
  "longitude",
  "observacoes_livres",
];

const FORMULA_PERIGOSA_REGEX = /^[=+\-@\t\r]/;
const NUMERO_NEGATIVO_SIMPLES_REGEX = /^-\d+(\.\d+)?$/;

const neutralizarFormulaCsv = (texto) => {
  if (
    FORMULA_PERIGOSA_REGEX.test(texto) &&
    !NUMERO_NEGATIVO_SIMPLES_REGEX.test(texto)
  ) {
    return `'${texto}`;
  }
  return texto;
};

const escaparCsv = (valor) => {
  if (valor === null || valor === undefined) return "";

  const textoBruto = valor instanceof Date ? valor.toISOString() : String(valor);
  const texto = neutralizarFormulaCsv(textoBruto);

  if (/[",\r\n]/.test(texto)) {
    return `"${texto.replaceAll('"', '""')}"`;
  }

  return texto;
};

const normalizarLimite = (limit) => {
  const numero = Number(limit);
  if (!Number.isInteger(numero) || numero < 1) {
    return MAX_EXPORTACAO;
  }
  return Math.min(numero, MAX_EXPORTACAO);
};

const normalizarOffset = (offset) => {
  const numero = Number(offset);
  if (!Number.isInteger(numero) || numero < 0) {
    return 0;
  }
  return numero;
};

const buscarVisitasParaExportacao = async (filtros = {}) => {
  const { status, gestor_id, fiscalizador_id, limit, offset } = filtros;
  const where = {};

  if (status) where.status = status;
  if (gestor_id) where.gestor_id = gestor_id;

  const limite = normalizarLimite(limit);
  const deslocamento = normalizarOffset(offset);

  if (fiscalizador_id) {
    const vinculos = await VisitaFiscalizador.findAll({
      where: { fiscalizador_id },
      attributes: ["visita_id"],
      raw: true,
    });

    const visitaIds = vinculos.map((v) => v.visita_id);
    if (visitaIds.length === 0) {
      return { rows: [], count: 0, limit: limite, offset: deslocamento };
    }

    where.id = { [Op.in]: visitaIds };
  }

  const { rows, count } = await Visita.findAndCountAll({
    where,
    include: [
      {
        model: Usuario,
        as: "gestor",
        attributes: ["id", "nome", "email", "role"],
      },
      {
        model: Usuario,
        as: "fiscalizadores",
        attributes: ["id", "nome", "email", "role"],
        through: { attributes: [] },
      },
    ],
    order: [["data_agendada", "ASC"]],
    distinct: true,
    limit: limite,
    offset: deslocamento,
  });

  return { rows, count, limit: limite, offset: deslocamento };
};

const exportarVisitasCsv = async (filtros = {}) => {
  const { rows: visitas, count, offset } = await buscarVisitasParaExportacao(
    filtros
  );

  const linhas = visitas.map((visita) => {
    const fiscalizadores = (visita.fiscalizadores ?? [])
      .map((f) => f.nome)
      .join("; ");

    return [
      visita.id,
      visita.denunciado,
      visita.status,
      visita.gestor?.nome ?? "",
      fiscalizadores,
      visita.data_agendada,
      visita.data_realizacao,
      visita.latitude,
      visita.longitude,
      visita.observacoes_livres,
    ]
      .map(escaparCsv)
      .join(",");
  });

  return {
    csv: `\uFEFF${[CABECALHO_CSV.join(","), ...linhas].join("\r\n")}`,
    total: count,
    truncado: offset + visitas.length < count,
  };
};

export default {
  obterDadosGerais,
  exportarVisitasCsv,
};
