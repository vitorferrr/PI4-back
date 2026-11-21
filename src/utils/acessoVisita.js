export const podeAcessarVisita = (usuario, visita) =>
  usuario?.role !== "fiscalizador" ||
  visita.fiscalizadores?.some((fiscalizador) => fiscalizador.id === usuario.id);

export const responderNaoEncontrada = (res) =>
  res.status(404).json({
    mensagem: "Visita não encontrada",
  });
