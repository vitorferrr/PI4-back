import { Router } from "express";
import visitaController from "../controllers/visitaController.js";
import questionarioController from "../controllers/questionarioController.js";
import documentoController from "../controllers/documentoController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId, { validarParametroId } from "../middlewares/validarIdMiddleware.js";
import {
  validarAtualizacaoVisita,
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

router.put(
  "/:id",
  autenticar,
  autorizar("admin", "gestor"),
  validarId,
  validarAtualizacaoVisita,
  visitaController.atualizar
);

router.delete(
  "/:id",
  autenticar,
  autorizar("admin", "gestor"),
  validarId,
  visitaController.remover
);

router.get(
  "/:id/fiscalizadores",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  visitaController.listarFiscalizadores
);

router.post(
  "/:id/fiscalizadores",
  autenticar,
  autorizar("admin", "gestor"),
  validarId,
  visitaController.adicionarFiscalizador
);

router.put(
  "/:id/fiscalizadores",
  autenticar,
  autorizar("admin", "gestor"),
  validarId,
  visitaController.substituirFiscalizadores
);

router.delete(
  "/:id/fiscalizadores/:fiscalizadorId",
  autenticar,
  autorizar("admin", "gestor"),
  validarId,
  validarParametroId("fiscalizadorId"),
  visitaController.removerFiscalizador
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

router.post(
  "/:id/documento",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  documentoController.gerar
);

export default router;