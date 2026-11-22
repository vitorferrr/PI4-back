import { Router } from "express";
import adminController from "../controllers/adminController.js";
import autenticar from "../middlewares/authMiddleware.js";
import autorizar from "../middlewares/roleMiddleware.js";
import { validarListagemVisitas } from "../middlewares/validationMiddleware.js";

const router = Router();

router.get(
  "/dados-gerais",
  autenticar,
  autorizar("admin"),
  adminController.dadosGerais
);

router.get(
  "/exportar",
  autenticar,
  autorizar("admin"),
  validarListagemVisitas,
  adminController.exportar
);

export default router;
