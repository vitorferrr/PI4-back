import { visitaService } from "../services/index.js";
import { AppError, podeAcessarVisita, podeGerenciarVisita } from "../utils/index.js";


const verificarVisita = (podeUsar, mensagem) => async (req, res, next) => {
  try {
    const usuario = req.usuario;
    if (!usuario) {
      return next(new AppError("Usuário não autenticado", 401));
    }

    const visita = await visitaService.buscarParaAcesso(req.params.id);
    if (!visita) {
      return next(new AppError("Visita não encontrada", 404));
    }

    if (!podeUsar(usuario, visita)) {
      return next(new AppError(mensagem, 403));
    }

    req.visita = visita;
    return next();
  } catch (err) {
    return next(err);
  }
};


export const verificarAcessoVisita = verificarVisita(
  podeAcessarVisita,
  "Você não tem permissão para acessar esta visita."
);

export const verificarGestorVisita = verificarVisita(
  podeGerenciarVisita,
  "Você não tem permissão para alterar uma visita de outro gestor."
);

export default {
  verificarAcessoVisita,
  verificarGestorVisita,
};
