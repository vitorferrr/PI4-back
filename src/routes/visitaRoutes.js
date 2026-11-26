import { Router } from "express";
import visitaController from "../controllers/visitaController.js";
import questionarioController from "../controllers/questionarioController.js";
import documentoController from "../controllers/documentoController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId, { validarIdParametro } from "../middlewares/validarIdMiddleware.js";
import {
  validarAtualizacaoResposta,
  validarCriacaoVisita,
  validarListagemVisitas,
  validarRespostasQuestionario,
} from "../middlewares/validationMiddleware.js";

const router = Router();

router.post(
  "/",
  autenticar,
  autorizar("admin", "gestor"),
  validarCriacaoVisita,
  visitaController.criar
);

router.get(
  "/",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarListagemVisitas,
  visitaController.listar
);

router.get(
  "/:id",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  visitaController.buscarPorId
);

router.patch(
  "/:id/iniciar",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  visitaController.iniciar
);

router.patch(
  "/:id/concluir",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  visitaController.concluir
);

router.post(
  "/:id/respostas",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  validarRespostasQuestionario,
  questionarioController.salvarRespostas
);

router.get(
  "/:id/respostas",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  questionarioController.listarRespostas
);

router.get(
  "/:id/respostas/:respostaId",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  validarIdParametro("respostaId"),
  questionarioController.buscarResposta
);

router.put(
  "/:id/respostas/:respostaId",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  validarIdParametro("respostaId"),
  validarAtualizacaoResposta,
  questionarioController.atualizarResposta
);

router.delete(
  "/:id/respostas/:respostaId",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  validarIdParametro("respostaId"),
  questionarioController.removerResposta
);

router.post(
  "/:id/documento",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  documentoController.gerar
);

export default router;