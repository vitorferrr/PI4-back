import documentoService from "../services/documentoService.js";
import visitaService from "../services/visitaService.js";
import AppError from "../utils/appError.js";
import { podeAcessarVisita, erroVisitaNaoEncontrada } from "../utils/acessoVisita.js";

const gerar = async (req, res) => {
  const visita = await visitaService.buscarParaAcesso(req.params.id);

  if (!visita || !podeAcessarVisita(req.usuario, visita)) {
    throw erroVisitaNaoEncontrada();
  }

  const resultado = await documentoService.gerar(visita.id);

  if (!resultado) {
    throw erroVisitaNaoEncontrada();
  }

  return res.status(resultado.criado ? 201 : 200).json(resultado.documento);
};

const linkPdf = async (req, res) => {
  const resultado = await documentoService.gerarLinkPdf(req.params.id);

  if (!resultado) {
    throw new AppError("Documento não encontrado", 404);
  }

  if (!resultado.gerado) {
    throw new AppError("O PDF deste documento ainda não foi gerado", 409);
  }

  return res.status(200).json({ url: resultado.url, expira_em: resultado.expira_em });
};

export default {
  gerar,
  linkPdf,
};
