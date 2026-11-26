import { Router } from "express";
import visitaController from "../controllers/visitaController.js";
import questionarioController from "../controllers/questionarioController.js";
import documentoController from "../controllers/documentoController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import validarId, {
  validarIdParametro,
  validarParametroId,
} from "../middlewares/validarIdMiddleware.js";
import validate from "../middlewares/validate.js";
import {
  adicionarFiscalizadorSchema,
  atualizarRespostaSchema,
  atualizarVisitaSchema,
  criarVisitaSchema,
  iniciarVisitaSchema,
  listarVisitasSchema,
  observacoesVisitaSchema,
  salvarRespostasSchema,
  substituirFiscalizadoresSchema,
} from "../middlewares/validationSchemas.js";

const router = Router();

router.post(
  "/",
  autenticar,
  autorizar("admin", "gestor"),
  validate(criarVisitaSchema),
  visitaController.criar
);

router.get(
  "/",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validate(listarVisitasSchema),
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
  validate(atualizarVisitaSchema),
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
  validate(adicionarFiscalizadorSchema),
  visitaController.adicionarFiscalizador
);

router.put(
  "/:id/fiscalizadores",
  autenticar,
  autorizar("admin", "gestor"),
  validarId,
  validate(substituirFiscalizadoresSchema),
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
  validate(iniciarVisitaSchema),
  visitaController.iniciar
);

router.patch(
  "/:id/concluir",
  autenticar,
  autorizar("admin", "gestor", "fiscalizador"),
  validarId,
  visitaController.concluir
);

router.patch(
  "/:id/observacoes",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  validate(observacoesVisitaSchema),
  visitaController.salvarObservacoes
);

router.post(
  "/:id/respostas",
  autenticar,
  autorizar("fiscalizador"),
  validarId,
  validate(salvarRespostasSchema),
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
  validate(atualizarRespostaSchema),
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