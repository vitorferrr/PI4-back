import adminService from "../services/adminService.js";

const dadosGerais = async (req, res) => {
  const dados = await adminService.obterDadosGerais();
  return res.status(200).json(dados);
};

const exportar = async (req, res) => {
  const filtros = {
    status: req.query.status,
    gestor_id: req.query.gestor_id,
    fiscalizador_id: req.query.fiscalizador_id,
    limit: req.query.limit,
    offset: req.query.offset,
  };

  const { csv, total, truncado } = await adminService.exportarVisitasCsv(
    filtros
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="visitas.csv"');
  res.setHeader("X-Total-Count", String(total));
  res.setHeader("X-Truncated", String(truncado));

  return res.status(200).send(csv);
};

export default {
  dadosGerais,
  exportar,
};
