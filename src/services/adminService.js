import models from "../models/index.js";

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

export default {
  obterDadosGerais,
};
