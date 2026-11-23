import assinaturaService from "../services/assinaturaService.js";
import tratarErro from "../utils/tratarErro.js";

const registrar = async (req, res) => {
  try {
    const assinatura = await assinaturaService.registrar(req.params.id, req.body, req.usuario);

    if (!assinatura) {
      return res.status(404).json({
        mensagem: "Documento não encontrado",
      });
    }

    return res.status(201).json(assinatura);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao registrar assinatura");
  }
};

export default {
  registrar,
};
