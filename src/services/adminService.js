import models from "../models/index.js";
import visitaService from "./visitaService.js";

const { Usuario, Visita, Documento, Assinatura } = models;

const STATUS_VISITAS = ["agendada", "em_andamento", "concluida", "cancelada"];
const ROLES_USUARIOS = ["admin", "gestor", "fiscalizador"];

const contarPorCampo = async (Model, campo, valores) => {
  const contagens = await Promise.all(
    valores.map((valor) => Model.count({ where: { [campo]: valor } }))
  );

  return valores.reduce((acc, valor, indice) => {
    acc[valor] = contagens[indice];
    return acc;
  }, {});
};

const somarValores = (objeto) =>
  Object.values(objeto).reduce((total, qtd) => total + qtd, 0);

const obterDadosGerais = async () => {
  const [visitasPorStatus, usuariosPorRole, totalDocumentos, totalAssinaturas] =
    await Promise.all([
      contarPorCampo(Visita, "status", STATUS_VISITAS),
      contarPorCampo(Usuario, "role", ROLES_USUARIOS),
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

const escaparCsv = (valor) => {
  if (valor === null || valor === undefined) return "";

  const texto = valor instanceof Date ? valor.toISOString() : String(valor);

  if (/[",\r\n]/.test(texto)) {
    return `"${texto.replaceAll('"', '""')}"`;
  }

  return texto;
};

const exportarVisitasCsv = async (filtros = {}) => {
  const visitas = await visitaService.listar(filtros);

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

  return `\uFEFF${[CABECALHO_CSV.join(","), ...linhas].join("\r\n")}`;
};

export default {
  obterDadosGerais,
  exportarVisitasCsv,
};
