import adminService from "../services/adminService.js";
import tratarErro from "../utils/tratarErro.js";

const dadosGerais = async (req, res) => {
  try {
    const dados = await adminService.obterDadosGerais();
    return res.status(200).json(dados);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao obter dados gerais");
  }
};

const exportar = async (req, res) => {
  try {
    const filtros = {
      status: req.query.status,
      gestor_id: req.query.gestor_id,
      fiscalizador_id: req.query.fiscalizador_id,
      limit: req.query.limit,
      offset: req.query.offset,
    };

    const csv = await adminService.exportarVisitasCsv(filtros);

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="visitas.csv"');

    return res.status(200).send(csv);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao exportar visitas");
  }
};

export default {
  dadosGerais,
  exportar,
};
