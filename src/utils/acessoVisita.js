import AppError from "./appError.js";

export const podeAcessarVisita = (usuario, visita) =>
  usuario?.role !== "fiscalizador" ||
  visita.fiscalizadores?.some((fiscalizador) => fiscalizador.id === usuario.id);

export const podeGerenciarVisita = (usuario, visita) =>
  usuario?.role === "admin" || visita.gestor_id === usuario?.id;

export const erroVisitaNaoEncontrada = () =>
  new AppError("Visita não encontrada", 404);
