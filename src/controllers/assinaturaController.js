import assinaturaService from "../services/assinaturaService.js";
import documentoService from "../services/documentoService.js";
import tratarErro from "../utils/tratarErro.js";

const finalizarDocumento = async (documentoId) => {
  try {
    return await documentoService.finalizar(documentoId);
  } catch (erro) {
    console.error("Falha ao finalizar o documento:", erro.codigo ?? erro.name);
    return { situacao: "erro", documento_id: documentoId };
  }
};

const registrar = async (req, res) => {
  try {
    const assinatura = await assinaturaService.registrar(req.params.id, req.body, req.usuario);

    if (!assinatura) {
      return res.status(404).json({
        mensagem: "Documento não encontrado",
      });
    }

    const finalizacao = await finalizarDocumento(assinatura.documento_id);
    const dados = assinatura.toJSON?.() ?? assinatura;

    return res.status(201).json({ ...dados, finalizacao });
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao registrar assinatura");
  }
};

const finalizar = async (req, res) => {
  try {
    const resultado = await documentoService.finalizar(Number(req.params.id), {
      reenviarEmail: true,
      usuario: req.usuario,
    });

    if (!resultado) {
      return res.status(404).json({
        mensagem: "Documento não encontrado",
      });
    }

    return res.status(200).json(resultado);
  } catch (erro) {
    return tratarErro(res, erro, "Erro ao finalizar documento");
  }
};

export default {
  registrar,
  finalizar,
};
