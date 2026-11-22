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

export default {
  dadosGerais,
};
